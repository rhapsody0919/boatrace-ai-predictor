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
  // 欠場艇等の行の補完（BOA-327 の前提）。K にあって race_start_timings に行の無い艇を挿入する（既存の行には触れない）。
  // 2026-09-20 までの結果ページの取得は ST のある艇だけを書き、項目 st は進入の無い艇（欠場）と、行のあるレースを飛ばした
  missing_boats: {
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
      "finish_mark",
      "finish_rank",
      "official_finish_code",
      "created_at",
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
  // BOA-553: 公式の成績コード（マイグレーション116）。既存の行の NULL だけを埋める（行の無い艇は挿入しない）。
  // BOA-582: 同じ行の着欄・着（077）も、成績コードから決まるものだけ同じ回で埋める（同じ行を2回書かない。Disk IO のため）
  finish_code: {
    table: "race_start_timings",
    mode: "update",
    stampUpdatedAt: true,
    keyColumns: ["race_id", "boat_number"],
    columns: [
      "race_id",
      "boat_number",
      "official_finish_code",
      "finish_mark",
      "finish_rank",
    ],
  },
  // BOA-480: レースの状態（マイグレーション078）。race_results は rank1〜3 も NOT NULL のため、対象の列だけを送る
  // upsert は INSERT の段階で制約違反になる。同じ値ごとにまとめて update().in(race_id) で書く（groupUpdate）。
  // 書くのは race_status が NULL の行だけ（既存の値は上書きしない）
  race_status: {
    table: "race_results",
    mode: "groupUpdate",
    keyColumns: ["race_id"],
    nullGuardColumn: "race_status",
    columns: ["race_id", "race_status", "refund_boats"],
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
 * 欠場艇等の行（missing_boats）: K の成績にあって、race_start_timings に行の無い艇の行を作る。races にあるレースだけ。
 * 形は 2026-09-21 以降の結果ページの取得が書く行と同じ。欠場（K0/K1）は finish_mark='欠'・ST と進入は NULL・
 * is_flying と is_late_start は false。走った艇は K の ST・進入・F・L。着欄・着は成績コードから（finishMarkFromCode。
 * 失格 S0〜S2 は NULL）。created_at は NULL（バックフィルの行は取得時刻を偽らない）。
 *
 * @param {Object} day kb-day/v1
 * @param {{raceIds: Set<string>, existingKeys: Set<string>}} existing races の race_id・既存の行の `${race_id}|${boat_number}`
 */
export function buildMissingBoatRows(day, { raceIds, existingKeys }) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    if (!raceIds.has(raceId)) continue;
    for (const r of race.rows ?? []) {
      if (!Number.isInteger(r.boat_number)) continue;
      if (existingKeys.has(`${raceId}|${r.boat_number}`)) continue;
      const code = typeof r.finish_raw === "string" ? r.finish_raw : null;
      const derived = code ? finishMarkFromCode(code) : null;
      rows.push({
        race_id: raceId,
        boat_number: r.boat_number,
        start_timing:
          typeof r.start_timing === "number" ? Math.abs(r.start_timing) : null,
        is_flying: Boolean(r.is_flying),
        is_late_start: Boolean(r.is_late_start),
        entry_course: Number.isInteger(r.course) ? r.course : null,
        finish_mark: derived?.finish_mark ?? null,
        finish_rank: derived?.finish_rank ?? null,
        official_finish_code: code,
        created_at: null,
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

/**
 * BOA-582: Kファイルの成績コードから、結果ページの着欄（finish_mark。NFKC 正規化後）と着（finish_rank）を導く。
 * 2026-09-21〜30 の正解（結果ページ由来）8,805艇で、着欄・着とも100%一致（2026-10-02）。
 * S0/S1/S2（失格）は null: 結果ページでは転・落・沈・妨・エ・失のどれにもなり、Kからは決まらない
 * （同じ期間の実測で S0→転・落・エ・失、S1→転・落・エ・沈、S2→妨）。未知のコードも null。
 *
 * @param {string} code
 * @returns {{finish_mark: string, finish_rank: number|null}|null}
 */
export function finishMarkFromCode(code) {
  if (/^0[1-6]$/.test(code)) {
    return { finish_mark: String(Number(code)), finish_rank: Number(code) };
  }
  const mark = {
    F: "F",
    L0: "L",
    L1: "L",
    K0: "欠",
    K1: "欠",
    "00": "_",
  }[code];
  return mark === undefined ? null : { finish_mark: mark, finish_rank: null };
}

/**
 * BOA-553: 公式の成績コード（Kファイルの着順欄の表記のまま。01〜06・F・L0・L1・K0・K1・S0・S1・S2 等）。
 * BOA-582: 同じ行の着欄・着（finish_mark・finish_rank）も、着欄が NULL で成績コードから決まる艇だけ埋める。
 * race_start_timings の既存の行だけが対象で、行の無い艇は作らない。3列とも既存の値は上書きしない（持ち回る）。
 * 3列のどれも変わらない艇は書かない（成績コードを書き終えた後の再実行では、着欄の差分の行だけになる）。
 *
 * @param {Object} day kb-day/v1
 * @param {Map<string, {official_finish_code?: string|null, finish_mark?: string|null, finish_rank?: number|null}>} existingByKey
 *   `${race_id}|${boat_number}` → 既存の行の3列
 * @param {{filled?: Record<string, number>}} [out] 列ごとに、NULL から値を入れた艇の数を足し込む（dry-run の内訳）
 */
export function buildFinishCodeRows(day, existingByKey, out = {}) {
  const filled = (out.filled ??= {
    official_finish_code: 0,
    finish_mark: 0,
    finish_rank: 0,
  });
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    for (const r of race.rows ?? []) {
      if (!Number.isInteger(r.boat_number)) continue;
      const cur = existingByKey.get(`${raceId}|${r.boat_number}`);
      if (!cur) continue;
      const code = typeof r.finish_raw === "string" ? r.finish_raw.trim() : "";
      if (code === "") continue;
      const before = {
        official_finish_code: cur.official_finish_code ?? null,
        finish_mark: cur.finish_mark ?? null,
        finish_rank: cur.finish_rank ?? null,
      };
      const derived =
        before.finish_mark === null ? finishMarkFromCode(code) : null;
      const next = {
        official_finish_code: before.official_finish_code ?? code,
        finish_mark: derived ? derived.finish_mark : before.finish_mark,
        finish_rank: before.finish_rank ?? derived?.finish_rank ?? null,
      };
      const changed = Object.keys(next).filter(
        (col) => next[col] !== before[col],
      );
      if (changed.length === 0) continue;
      for (const col of changed) filled[col] += 1;
      rows.push({ race_id: raceId, boat_number: r.boat_number, ...next });
    }
  }
  return rows;
}

/** 返還になる成績コード（F=フライング、L0/L1=出遅れ、K0/K1=欠場）。S0/S1/S2（失格）・00（順位なし）は返還しない */
const REFUND_CODES = new Set(["F", "L0", "L1", "K0", "K1"]);
/** Kファイルに現れる成績コードの全て（2005〜2026-09 のアーカイブ全期間の実測）。これ以外が出たら書かずに異常とする */
const KNOWN_FINISH_CODES = new Set([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "S0",
  "S1",
  "S2",
  "F",
  "K0",
  "K1",
  "L0",
  "L1",
  "00",
]);
/** 払戻の special（kbFileParser）で、払戻とみなす表記。「不成立」だけが不成立、それ以外は払戻あり */
const KNOWN_PAYOUT_SPECIALS = new Set([
  null,
  undefined,
  "",
  "特払い",
  "不成立",
]);

/**
 * BOA-480: K の1レースから race_status・refund_boats を導く（結果ページの classifyRaceStatus と同じ構造）。
 * 2026-09-21 以降の正解（結果ページ由来）と、9/21 より前で値のある行の計3,084件で、両列とも100%一致（2026-10-02）。
 *   no_race:        付記に「レース不成立」がある、または全勝式の払戻が「不成立」
 *   partial_refund: 一部の勝式が不成立、または返還艇がある
 *   normal:         それ以外
 * 想定外（未知の成績コード・払戻の表記、払戻0件なのに「レース不成立」も無い）は null を返し、呼び出し側が異常として数える。
 *
 * @param {{rows?: Object[], payouts?: Object[], extra_lines?: string[]}} race kb-day/v1 の .k.venues[].races[]
 * @returns {{race_status: string, refund_boats: number[]}|{anomaly: string}}
 */
export function deriveRaceStatusFromK(race) {
  const rows = race?.rows ?? [];
  const payouts = race?.payouts ?? [];
  const unknownCode = rows.find((r) => !KNOWN_FINISH_CODES.has(r.finish_raw));
  if (unknownCode)
    return { anomaly: `未知の成績コード ${unknownCode.finish_raw}` };
  const unknownSpecial = payouts.find(
    (p) => !KNOWN_PAYOUT_SPECIALS.has(p.special),
  );
  if (unknownSpecial)
    return { anomaly: `未知の払戻の表記 ${unknownSpecial.special}` };
  const refundBoats = [
    ...new Set(
      rows
        .filter((r) => REFUND_CODES.has(r.finish_raw))
        .map((r) => r.boat_number),
    ),
  ].sort((a, b) => a - b);
  const raceNoRace = (race?.extra_lines ?? []).some((l) =>
    /レース不成立/.test(l),
  );
  const notEstablished = payouts.filter((p) => p.special === "不成立").length;
  if (raceNoRace || (payouts.length > 0 && notEstablished === payouts.length)) {
    return { race_status: "no_race", refund_boats: refundBoats };
  }
  if (payouts.length === 0)
    return { anomaly: "払戻が0件で「レース不成立」も無い" };
  if (notEstablished > 0 || refundBoats.length > 0) {
    return { race_status: "partial_refund", refund_boats: refundBoats };
  }
  return { race_status: "normal", refund_boats: refundBoats };
}

/**
 * BOA-480: race_results の race_status が NULL のレースだけ、K から導いた値を書く行を作る。
 * K の会場が完了（status complete 以外）でないもの・導けないもの（anomaly）は書かず、anomalies に入れる。
 *
 * @param {Object} day kb-day/v1
 * @param {Map<string, string|null>} statusByRace race_results の race_id → 既存の race_status（行が無ければキーが無い）
 * @param {{anomalies?: Array<{race_id: string, reason: string}>}} [out]
 */
export function buildRaceStatusRows(day, statusByRace, out = {}) {
  const rows = [];
  for (const venue of day?.k?.venues ?? []) {
    for (const race of venue.races ?? []) {
      const raceId = raceIdOf(day.date, venue.venue_code, race.race_number);
      if (!statusByRace.has(raceId) || statusByRace.get(raceId) !== null)
        continue;
      if (venue.status && venue.status !== "complete") {
        out.anomalies?.push({
          race_id: raceId,
          reason: `K の会場が ${venue.status}`,
        });
        continue;
      }
      const d = deriveRaceStatusFromK(race);
      if (d.anomaly) {
        out.anomalies?.push({ race_id: raceId, reason: d.anomaly });
        continue;
      }
      rows.push({
        race_id: raceId,
        race_status: d.race_status,
        refund_boats: d.refund_boats,
      });
    }
  }
  return rows;
}
