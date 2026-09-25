/**
 * 出走表（race_entries）の複製汚染を、公式Bファイル（番組表）から復元するための純粋関数（BOA-422）
 *
 * 背景・監査結果: docs/issues/race-entries-duplicate-contamination-audit.md
 * 汚染された行は「別の選手の行」がまるごと入っているため、選手に紐づく列は全て誤りになる。
 *
 * 【列ごとの方針】クリーンな会場×日（選手が72/72一致する日）でBファイルとDBを突き合わせて決めた。
 * 「Bファイルにあるから書く」ではなく、「その列の定義と同じ量か」で判断している。
 *
 *   Bファイルから復元する
 *     racer_id / grade(class) / age / win_rate(national_win_rate) / global_2rate(national_2rate) /
 *     local_win_rate / local_2rate / motor_number / motor_2rate / boat_number_id(boat_id) / boat_2rate
 *
 *   racer_profiles から復元する（復元後の racer_id で引く）
 *     player_name / branch / hometown
 *     ※ Bファイルの name は詰めた表記（「荒井輝年」）で、DBの表記（「荒井　　輝年」）と異なる。
 *       DB内の正本である racer_profiles.name を使い、既存の他レースと表記を揃える
 *
 *   NULLにする（Bファイルから導けず、今入っている値は別の選手のもの）
 *     global_3rate / local_3rate / motor_3rate / boat_3rate / weight_kg / f_count / l_count / is_absent
 *     ※ weight_kg は、Bファイルの weight が「登録体重」（整数）で、この列が持つ発走前の体重
 *       （小数あり）とは別の量のため、書かずにNULLにする。クリーンな日で db=47.7 / b=49 のような
 *       系統的な差を確認済み
 *     ※ global_3rate を NULL にすると、N19（racelist-backfill）の対象（global_3rateがNULLの行を持つ
 *       レース）に自動的に入り、夜間ジョブが公式の出走表から3連率を埋め直す
 *
 *   触らない
 *     ai_score_standard / ai_score_safe_bet / ai_score_upset_focus
 *     ※ 当時のモデルの出力そのもので、選手の属性ではない。作り直すと履歴の書き換えになるため、
 *       この復元の対象外とし、影響は別途報告する（predictions も同じ理由で触らない）
 *
 * 【復元しても当時のスナップショットには戻らない点】
 * Bファイルは節の開始前に公開される。DBの値は発走60分前の出走表ページから取ったもののため、
 * local_win_rate・local_2rate 等は「節の途中までの更新」の分だけずれる（クリーンな日の実測で、
 * local_win_rate は 30〜60% の行が小数第2位で異なる）。別の選手の値が入っている現状よりは
 * 大幅に正しいが、完全な復元ではない。
 */

/** Bファイルから復元する列（race_entries の列名 → Bファイルの項目名） */
export const COLUMNS_FROM_B = Object.freeze({
  racer_id: "racer_id",
  grade: "class",
  age: "age",
  win_rate: "national_win_rate",
  global_2rate: "national_2rate",
  local_win_rate: "local_win_rate",
  local_2rate: "local_2rate",
  motor_number: "motor_number",
  motor_2rate: "motor_2rate",
  boat_number_id: "boat_id",
  boat_2rate: "boat_2rate",
});

/** racer_profiles から復元する列（race_entries の列名 → racer_profiles の列名） */
export const COLUMNS_FROM_PROFILE = Object.freeze({
  player_name: "name",
  branch: "branch",
  hometown: "hometown",
});

/** NULLにする列（Bファイルから導けず、今の値は別の選手のもの） */
export const COLUMNS_TO_NULL = Object.freeze([
  "global_3rate",
  "local_3rate",
  "motor_3rate",
  "boat_3rate",
  "weight_kg",
  "f_count",
  "l_count",
  "is_absent",
]);

/** race_id を組み立てる（DBの形式: YYYY-MM-DD-VV-RR、会場・レース番号とも2桁ゼロ埋め） */
export const buildRaceId = (date, venueCode, raceNumber) =>
  `${date}-${String(venueCode).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;

/**
 * 解析済みのK/B日データから、「race_id → (艇番 → Bファイルの出走表エントリ)」を作る。
 * @param {object} day kb-day/v1（kb-backfill.js の readParsedDay の戻り値）
 * @returns {Map<string, Map<number, object>>}
 */
export function indexBEntriesByRace(day) {
  const index = new Map();
  for (const venue of day?.b?.venues ?? []) {
    const venueCode = Number(venue.venue_code);
    for (const race of venue.races ?? []) {
      const raceId = buildRaceId(day.date, venueCode, race.race_number);
      const byBoat = new Map();
      for (const entry of race.entries ?? [])
        byBoat.set(entry.boat_number, entry);
      if (byBoat.size > 0) index.set(raceId, byBoat);
    }
  }
  return index;
}

/**
 * 1レース分の汚染判定。Bファイルとの「艇番→登録番号」の一致数を数える。
 * 6艇そろって一致していなければ汚染とみなす（部分一致は、欠場の差し替え等ではなく
 * 「別の日の出走表が入っている」ことの現れであることを、監査で確認済み）。
 * @returns {{match: number, total: number, contaminated: boolean}}
 */
export function compareRace(dbRowsByBoat, bEntriesByBoat) {
  let match = 0;
  let total = 0;
  for (const [boatNumber, bEntry] of bEntriesByBoat) {
    const db = dbRowsByBoat.get(boatNumber);
    if (!db) continue;
    total++;
    if (db.racer_id === bEntry.racer_id) match++;
  }
  return { match, total, contaminated: total > 0 && match < total };
}

/**
 * 復元後の1行を作る。既存行の主キー（race_id・boat_number）は保つ。
 * @param {object} existing 現在の race_entries の行（主キーのみ使う）
 * @param {object} bEntry Bファイルの出走表エントリ
 * @param {object|null} profile racer_profiles の行（見つからなければ null）
 * @returns {object} upsert する行
 */
export function buildRestoredRow(existing, bEntry, profile) {
  const row = { race_id: existing.race_id, boat_number: existing.boat_number };
  for (const [dbCol, bCol] of Object.entries(COLUMNS_FROM_B))
    row[dbCol] = bEntry[bCol] ?? null;
  for (const [dbCol, pCol] of Object.entries(COLUMNS_FROM_PROFILE))
    row[dbCol] = profile ? (profile[pCol] ?? null) : null;
  // racer_profiles に無い選手（新人等）は、Bファイルの氏名で代替する（表記は詰めた形になる）
  if (!profile && bEntry.name) row.player_name = bEntry.name;
  for (const col of COLUMNS_TO_NULL) row[col] = null;
  return row;
}

/**
 * 1日分の復元行を組み立てる。
 * @param {object} params
 * @param {Map<string, Map<number, object>>} params.bIndex indexBEntriesByRace の結果
 * @param {Map<string, Map<number, object>>} params.dbIndex race_id → (艇番 → 現在の行)
 * @param {Map<number, object>} params.profiles racer_id → racer_profiles の行
 * @param {Set<string>} [params.limitToRaceIds] 指定すると、このレースだけを対象にする
 * @returns {{rows: object[], races: Array<{race_id: string, match: number, total: number}>, missingProfiles: number[]}}
 */
export function buildRestorePlan({
  bIndex,
  dbIndex,
  profiles,
  limitToRaceIds,
}) {
  const rows = [];
  const races = [];
  const missingProfiles = new Set();
  for (const [raceId, bEntries] of bIndex) {
    if (limitToRaceIds && !limitToRaceIds.has(raceId)) continue;
    const dbRows = dbIndex.get(raceId);
    if (!dbRows) continue;
    const { match, total, contaminated } = compareRace(dbRows, bEntries);
    if (!contaminated) continue;
    races.push({ race_id: raceId, match, total });
    for (const [boatNumber, bEntry] of bEntries) {
      const existing = dbRows.get(boatNumber);
      if (!existing) continue;
      const profile = profiles.get(bEntry.racer_id) ?? null;
      if (!profile) missingProfiles.add(bEntry.racer_id);
      rows.push(buildRestoredRow(existing, bEntry, profile));
    }
  }
  races.sort((a, b) => a.race_id.localeCompare(b.race_id));
  return {
    rows,
    races,
    missingProfiles: [...missingProfiles].sort((a, b) => a - b),
  };
}
