import { assertInt, assertIntOrNull, assertObject, assertOneOf, assertText, parseIsoDate } from "./modelAssert.js";

/**
 * morning_digest_days（朝のまとめの1日1行、scheduleQueries.js の getMorningDigest が読む）。キーは Supabase の snake_case のまま。
 * 根拠: docs/reference/schema-snapshot.json の relations morning_digest_days（主キー digest_date、NOT NULL の列、
 * CHECK mdd_counts_nonneg・mdd_window_order）。select で取っていない列（undefined）は検査しない
 * @typedef {object} DigestDay
 * @property {string} digest_date YYYY-MM-DD（主キー）
 * @property {(string|null)} [generated_at] null は生成の途中
 * @property {number} [venue_count] 0以上
 * @property {number} [race_count] 0以上
 * @property {string} [window_start] YYYY-MM-DD
 * @property {string} [window_end] window_start 以後
 * @property {number} [window_days] smallint
 * @property {boolean} [flying_data_complete]
 * @property {number[]} [suppressed_venues] smallint の配列
 */

/**
 * morning_digest_rows（朝のまとめの節ごとの順位の1行）。根拠: schema-snapshot の relations morning_digest_rows
 * （主キー digest_date・section・rank、CHECK mdr_section_values・mdr_rank_positive・mdr_venue_range・mdr_boat_range・
 * mdr_course_range・mdr_race_fields_by_section・mdr_metric_fields_by_section）
 * @typedef {object} DigestRow
 * @property {string} digest_date YYYY-MM-DD（主キー）
 * @property {("featured"|"nige"|"makuri"|"nigashi"|"flying"|"returned")} section 主キー
 * @property {number} rank 1以上（主キー）
 * @property {(string|null)} [race_id] returned だけ null
 * @property {(number|null)} [race_number] returned だけ null
 * @property {(number|null)} [boat_number] 1〜6、returned だけ null
 * @property {(number|null)} [course] 1〜6、flying・returned 以外は必ずある
 * @property {number} [venue_code] 1〜24
 * @property {number} [racer_id]
 * @property {string} [racer_name]
 * @property {boolean} [is_small_sample]
 */

const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const SECTIONS = ["featured", "nige", "makuri", "nigashi", "flying", "returned"];
const RACE_KEYS = ["race_id", "race_number", "boat_number"];
const METRIC_KEYS = ["metric_value", "metric_expected", "metric_skill_delta", "metric_venue_baseline", "metric_predicted", "sample_size", "course"];

function assertBool(value, label, ctx) {
  if (typeof value !== "boolean") throw new RangeError(`${label} が真偽でない: ${String(value)}（${ctx}）`);
}

/**
 * morning_digest_days の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<DigestDay>}
 */
export function makeDigestDay(row) {
  assertObject(row, "makeDigestDay");
  const ctx = `digest_day digest_date=${String(row.digest_date)}`;
  parseIsoDate(row.digest_date, "digest_day の digest_date", ctx);
  for (const key of ["venue_count", "race_count"]) {
    if (row[key] !== undefined) assertInt(row[key], 0, SMALLINT_MAX, `digest_day の ${key}`, ctx);
  }
  const start = row.window_start === undefined ? null : parseIsoDate(row.window_start, "digest_day の window_start", ctx);
  const end = row.window_end === undefined ? null : parseIsoDate(row.window_end, "digest_day の window_end", ctx);
  if (start !== null && end !== null && end < start) {
    throw new RangeError(`digest_day の window_end が window_start より前: ${row.window_end}（${ctx}）`);
  }
  if (row.window_days !== undefined) assertInt(row.window_days, SMALLINT_MIN, SMALLINT_MAX, "digest_day の window_days", ctx);
  if (row.flying_data_complete !== undefined) assertBool(row.flying_data_complete, "digest_day の flying_data_complete", ctx);
  if (row.suppressed_venues !== undefined) {
    if (!Array.isArray(row.suppressed_venues)) {
      throw new RangeError(`digest_day の suppressed_venues が配列でない: ${String(row.suppressed_venues)}（${ctx}）`);
    }
    for (const v of row.suppressed_venues) assertInt(v, SMALLINT_MIN, SMALLINT_MAX, "digest_day の suppressed_venues の要素", ctx);
  }
  return Object.freeze({ ...row });
}

/**
 * morning_digest_rows の行を検査して凍結した写しを返す。節による null の決まりは、取った列ごとに見る
 * @param {object} row
 * @returns {Readonly<DigestRow>}
 */
export function makeDigestRow(row) {
  assertObject(row, "makeDigestRow");
  const ctx = `digest_row digest_date=${String(row.digest_date)} section=${String(row.section)} rank=${String(row.rank)}`;
  parseIsoDate(row.digest_date, "digest_row の digest_date", ctx);
  assertOneOf(row.section, SECTIONS, "digest_row の section", ctx);
  assertInt(row.rank, 1, SMALLINT_MAX, "digest_row の rank", ctx);
  if (row.venue_code !== undefined) assertInt(row.venue_code, 1, 24, "digest_row の会場コード", ctx);
  if (row.racer_id !== undefined) assertInt(row.racer_id, INT_MIN, INT_MAX, "digest_row の racer_id", ctx);
  if (row.racer_name !== undefined) assertText(row.racer_name, "digest_row の racer_name", ctx);
  if (row.is_small_sample !== undefined) assertBool(row.is_small_sample, "digest_row の is_small_sample", ctx);
  assertIntOrNull(row.boat_number, 1, 6, "digest_row の boat_number", ctx);
  assertIntOrNull(row.course, 1, 6, "digest_row の course", ctx);
  assertIntOrNull(row.race_number, SMALLINT_MIN, SMALLINT_MAX, "digest_row の race_number", ctx);
  const returned = row.section === "returned";
  for (const key of RACE_KEYS) {
    if (row[key] !== undefined && (row[key] === null) !== returned) {
      throw new RangeError(`digest_row の ${key} が節の決まり（returned だけ null）に合わない: ${String(row[key])}（${ctx}）`);
    }
  }
  if (row.section !== "flying" && !returned) {
    for (const key of METRIC_KEYS) {
      if (row[key] === null) throw new RangeError(`digest_row の ${key} が null（flying・returned 以外は必ずある、${ctx}）`);
    }
  }
  return Object.freeze({ ...row });
}
