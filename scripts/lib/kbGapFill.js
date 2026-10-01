/**
 * K/Bファイル（kb-day/v1。kb-backfill.js parse の出力）から、本体テーブルの欠落を補う行を作る（純関数）。
 * 計画: docs/design/scraping-vercel-consolidation/backfill-phase1-kb-2026-10.md（項目3〜6）。
 * CLI: scripts/maintenance/backfill-kb-gaps.js。
 *
 * 書き込みの規律（PostgREST の一括 upsert は、行ごとにキーの集合が違う行を混ぜると、無い列を NULL で書く。
 * 2026-09-27 に race_entries の branch・hometown を1,729行消した）:
 *   - 項目ごとに書く列を固定し（GAP_FILL_ITEMS）、すべての行がちょうどその列を持つ（assertColumnSet で検査する）
 *   - 既存の値は上書きしない（NULL の列だけを埋める。既存の行の値をそのまま持ち回る）
 *   - 行の挿入は、その表に行が1つも無いレースだけ
 */

const pad2 = (n) => String(n).padStart(2, "0");
const raceIdOf = (date, venueCode, raceNumber) =>
  `${date}-${pad2(venueCode)}-${pad2(raceNumber)}`;

/**
 * 項目ごとの表・書く列・書き方（insert: 行の無いレースだけ挿入 / update: 既存の行の NULL の列だけ埋める）。
 * stampUpdatedAt: 書く行に updated_at（書き込みの時刻）を付ける（マイグレーション071の運用。列のある表だけ）
 */
export const GAP_FILL_ITEMS = Object.freeze({
  st: {
    table: "race_start_timings",
    mode: "insert",
    stampUpdatedAt: true,
    keyColumns: ["race_id", "boat_number"],
    columns: [
      "race_id",
      "boat_number",
      "start_timing",
      "is_flying",
      "is_late_start",
      "entry_course",
    ],
  },
  conditions: {
    table: "race_conditions",
    mode: "update",
    keyColumns: ["race_id"],
    // 風向は書かない: DB（直前情報ページ由来）と Kファイルで方位の基準が違う（2026-02〜09 で突き合わせると、
    // K の「南」が DB の「西」「東」「南」等にばらつく）。天候・風速・波高は Kファイルの「レース時点」の値で、
    // 結果ページの気象で上書きする今の運用（BOA-358）と同じ時点
    columns: ["race_id", "weather", "wind_speed", "wave_height", "race_stage"],
  },
  rate2: {
    table: "race_entries",
    mode: "update",
    stampUpdatedAt: true,
    keyColumns: ["race_id", "boat_number"],
    columns: ["race_id", "boat_number", "global_2rate", "local_2rate"],
  },
  exhibition: {
    table: "exhibition_data",
    // 行が無い艇は挿入し、行があって展示タイムが NULL の艇（展示STだけ・体重だけの行）は展示タイムだけを埋める。
    // 既存の展示タイムは上書きしない（展示タイムのある艇は作らない）
    mode: "update",
    stampUpdatedAt: true,
    keyColumns: ["race_id", "boat_number"],
    columns: ["race_id", "boat_number", "exhibition_time"],
  },
});

/** すべての行が、ちょうど columns の列を持つことを確かめる（違えば例外。書き込みの直前に呼ぶ） */
export function assertColumnSet(rows, columns) {
  const want = [...columns].sort().join(",");
  for (const row of rows) {
    const got = Object.keys(row).sort().join(",");
    if (got !== want) {
      throw new Error(
        `書く列の集合が違う行があります（${got} ≠ ${want}）。NULL 上書きを防ぐため中止します`,
      );
    }
  }
  return rows;
}

function* kRaces(day) {
  for (const venue of day?.k?.venues ?? []) {
    for (const race of venue.races ?? []) {
      yield {
        raceId: raceIdOf(day.date, venue.venue_code, race.race_number),
        race,
      };
    }
  }
}

/**
 * 項目4: スタート。races にあり、race_start_timings に行が1つも無いレースだけ、スタート情報のある艇の行を作る。
 * 欠場（進入が無い）艇の行は作らない（2026-09-21 より前の行と同じ形。行の有無で出走を判定する読み手がある）。
 * フライングの ST は正の値で保存する（本番の全期間がそう。kbFileParser は負の値で返す）。
 *
 * @param {Object} day kb-day/v1
 * @param {{raceIds: Set<string>, withRows: Set<string>}} existing races の race_id・行のあるレース
 */
export function buildStartTimingRows(day, { raceIds, withRows }) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    if (!raceIds.has(raceId) || withRows.has(raceId)) continue;
    for (const r of race.rows ?? []) {
      if (!Number.isInteger(r.boat_number) || !Number.isInteger(r.course))
        continue;
      rows.push({
        race_id: raceId,
        boat_number: r.boat_number,
        start_timing:
          typeof r.start_timing === "number" ? Math.abs(r.start_timing) : null,
        is_flying: Boolean(r.is_flying),
        is_late_start: Boolean(r.is_late_start),
        entry_course: r.course,
      });
    }
  }
  return rows;
}

/**
 * 項目6: 展示タイム。展示タイムがまだ無い艇（行が無い・行はあるが NULL）に、Kファイルの展示タイムを書く。
 * 書く列は exhibition_time だけ（展示ST・チルト・体重には触れない。Kファイルの ST は本番の ST で、展示STではない）。
 * 2025-12〜2026-03 は行の無いレース、2026-04〜09 は展示STだけ・体重だけの行が対象になる。
 *
 * @param {Object} day kb-day/v1
 * @param {{raceIds: Set<string>, timeByKey: Map<string, number|null>}} existing races の race_id・
 *   `${race_id}|${boat_number}` → 既存の行の exhibition_time（行が無ければキーが無い）
 */
export function buildExhibitionRows(day, { raceIds, timeByKey }) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    if (!raceIds.has(raceId)) continue;
    for (const r of race.rows ?? []) {
      if (!Number.isInteger(r.boat_number)) continue;
      if (typeof r.exhibition_time !== "number") continue;
      if ((timeByKey.get(`${raceId}|${r.boat_number}`) ?? null) !== null)
        continue;
      rows.push({
        race_id: raceId,
        boat_number: r.boat_number,
        exhibition_time: r.exhibition_time,
      });
    }
  }
  return rows;
}

/**
 * Kファイルのステージの表記を、DB（出走表ページ由来）の表記にそろえる。原文（全角のまま）から、2つ以上の空白・全角空白の
 * 後ろの付記（「進入固定」等）を落とす。2026-02〜09 の突き合わせで94%が完全一致。残りは会場独自のレース名が
 * Kファイルで6文字に切り詰められたもの（「朝からセンプ」と「朝からセンプル」等）で、復元できない
 * （予選・準優勝戦・優勝戦などの標準のステージは全て一致）。
 *
 * @param {{stage_raw?: string|null}} race
 * @returns {string|null}
 */
export function normalizeKStage(race) {
  const raw = typeof race?.stage_raw === "string" ? race.stage_raw.trim() : "";
  const head = raw.split(/[\s\u3000]{2,}|\u3000/)[0].trim();
  return head === "" ? null : head;
}

/**
 * 項目5: 気象・ステージ。race_conditions の既存の行のうち、NULL の列があり、K に値があるものだけ。
 * 既存の値は持ち回る（上書きしない）。
 *
 * @param {Object} day kb-day/v1
 * @param {Map<string, Object>} existingByRace race_id → race_conditions の行（対象の列）
 * @param {{stage?: (race: Object) => string|null}} [options] ステージの表記の変換（既定は K の表記のまま）
 */
export function buildConditionsRows(
  day,
  existingByRace,
  { stage = normalizeKStage } = {},
) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    const cur = existingByRace.get(raceId);
    if (!cur) continue;
    const fromK = {
      weather: race.weather ?? null,
      wind_speed: typeof race.wind_speed === "number" ? race.wind_speed : null,
      wave_height:
        typeof race.wave_height === "number" ? race.wave_height : null,
      race_stage: stage(race),
    };
    const next = { race_id: raceId };
    let changed = false;
    for (const [col, value] of Object.entries(fromK)) {
      const before = cur[col] ?? null;
      next[col] = before ?? value;
      if (before === null && value !== null) changed = true;
    }
    if (changed) rows.push(next);
  }
  return rows;
}

/**
 * 項目3: 2連率。race_entries の既存の行のうち、2連率が NULL で、Bファイルの登録番号が一致する艇だけ。
 *
 * @param {Object} day kb-day/v1
 * @param {Map<string, Object>} existingByKey `${race_id}|${boat_number}` → race_entries の行（racer_id・2連率）
 */
export function buildRate2Rows(day, existingByKey) {
  const rows = [];
  for (const venue of day?.b?.venues ?? []) {
    for (const race of venue.races ?? []) {
      const raceId = raceIdOf(day.date, venue.venue_code, race.race_number);
      for (const e of race.entries ?? []) {
        const cur = existingByKey.get(`${raceId}|${e.boat_number}`);
        if (!cur || cur.racer_id !== e.racer_id) continue;
        const g = cur.global_2rate ?? null;
        const l = cur.local_2rate ?? null;
        const nextG =
          g ?? (typeof e.national_2rate === "number" ? e.national_2rate : null);
        const nextL =
          l ?? (typeof e.local_2rate === "number" ? e.local_2rate : null);
        if (nextG === g && nextL === l) continue;
        rows.push({
          race_id: raceId,
          boat_number: e.boat_number,
          global_2rate: nextG,
          local_2rate: nextL,
        });
      }
    }
  }
  return rows;
}
