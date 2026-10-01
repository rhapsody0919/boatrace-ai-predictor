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
    columns: [
      "race_id",
      "weather",
      "wind_direction",
      "wind_speed",
      "wave_height",
      "race_stage",
    ],
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
    mode: "insert",
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
 * 項目6: 展示タイム。races にあり、exhibition_data に行が1つも無いレースだけ、展示タイムのある艇の行を作る。
 *
 * @param {Object} day kb-day/v1
 * @param {{raceIds: Set<string>, withRows: Set<string>}} existing
 */
export function buildExhibitionRows(day, { raceIds, withRows }) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    if (!raceIds.has(raceId) || withRows.has(raceId)) continue;
    for (const r of race.rows ?? []) {
      if (!Number.isInteger(r.boat_number)) continue;
      if (typeof r.exhibition_time !== "number") continue;
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
  { stage = (race) => race.stage ?? null } = {},
) {
  const rows = [];
  for (const { raceId, race } of kRaces(day)) {
    const cur = existingByRace.get(raceId);
    if (!cur) continue;
    const fromK = {
      weather: race.weather ?? null,
      wind_direction: race.wind_direction ?? null,
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
