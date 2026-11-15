import { assertInt, assertObject, assertOneOf, assertText } from "./modelAssert.js";

/**
 * venues の行（キーは Supabase の snake_case のまま）。根拠: docs/db-migration/001_schema.sql の
 * venues（code は PRIMARY KEY・name は NOT NULL）、races.venue_code の 1〜24（raceId.js の parseRaceId）
 * @typedef {object} Venue
 * @property {number} code 1〜24
 * @property {string} name
 * @property {(string|null)} [water_type] 検査しない。初期データが7会場で公式と食い違っていて画面に出さない（services/venueQueries.js）
 * @property {(null|"in_strong"|"out_strong"|"balanced")} [cluster] update_venue_stats が直近90日の1号艇1着率で決める
 * @property {(number|null)} [avg_first_win_rate] 0〜1（AVG(rank1=1) の割合、numeric(5,4)）
 */

// update_venue_stats（docs/db-migration/001_schema.sql）が書く3値。列に CHECK は無いので、行が無い・null も許す
const VENUE_CLUSTERS = ["in_strong", "out_strong", "balanced"];

/**
 * venues の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<Venue>}
 */
export function makeVenue(row) {
  assertObject(row, "makeVenue");
  const ctx = `venue code=${String(row.code)}`;
  assertInt(row.code, 1, 24, "venue の会場コード", ctx);
  assertText(row.name, "venue の name", ctx);
  if (row.cluster != null) assertOneOf(row.cluster, VENUE_CLUSTERS, "venue の cluster", ctx);
  if (row.avg_first_win_rate != null) {
    const v = row.avg_first_win_rate;
    if (typeof v !== "number" || !(v >= 0 && v <= 1)) {
      throw new RangeError(`venue の avg_first_win_rate が0〜1でない: ${String(v)}（${ctx}）`);
    }
  }
  return Object.freeze({ ...row });
}
