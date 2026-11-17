import { assertInt, assertIntOrNull, assertObject, assertOneOf, assertText, parseIsoDate } from "./modelAssert.js";

/**
 * venue_motor_stats（会場公式のモーター成績、取得日ごとの1行）。キーは Supabase の snake_case のまま。
 * 根拠: docs/reference/schema-snapshot.json の relations venue_motor_stats（主キー venue_code・motor_number・scraped_date、
 * source_template は NOT NULL。CHECK は無い）。会場コード1〜24 は races.venue_code と同じ前提（raceId.js の parseRaceId）。
 * select で取っていない列（undefined）は検査しない。主キーは必須なので、つなぐ票では select に主キーの列を足す
 * （今の motorQueries2.js・motorQueries4.js の motor_pretest_stats の読みは venue_code・race_date を取らない）
 * @typedef {object} MotorStat
 * @property {number} venue_code 1〜24（主キー）
 * @property {number} motor_number 整数（主キー、smallint）
 * @property {string} scraped_date YYYY-MM-DD（主キー）
 * @property {string} [source_template] NOT NULL
 * @property {(number|null)} [meet_count] 以下の回数は smallint
 * @property {(number|null)} [race_count]
 * @property {(number|null)} [final_count]
 * @property {(number|null)} [championship_count]
 * @property {(number|null)} [first_place_count]
 * @property {(number|null)} [second_place_count]
 * @property {(number|null)} [third_place_count]
 * @property {(string|null)} [stats_period_start] YYYY-MM-DD
 * @property {(string|null)} [stats_period_end] YYYY-MM-DD
 */

/**
 * motor_pretest_stats（前検の1選手1行）。根拠: schema-snapshot の relations motor_pretest_stats の CHECK 4本
 * （会場1〜24・racer_class 4値・pretest_rank は null か1以上・pretest_time と pretest_rank は両方 null か両方あり）
 * @typedef {object} MotorPretest
 * @property {string} race_date YYYY-MM-DD（主キー）
 * @property {number} venue_code 1〜24（主キー）
 * @property {number} racer_id 整数（主キー）
 * @property {("A1"|"A2"|"B1"|"B2")} [racer_class]
 * @property {number} [motor_number]
 * @property {number} [boat_number]
 * @property {(number|null)} [pretest_time]
 * @property {(number|null)} [pretest_rank] 1以上
 */

const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;
const INT_MAX = 2147483647;
const STAT_COUNTS = [
  "meet_count",
  "race_count",
  "final_count",
  "championship_count",
  "first_place_count",
  "second_place_count",
  "third_place_count",
];
const RACER_CLASSES = ["A1", "A2", "B1", "B2"];

/**
 * venue_motor_stats の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<MotorStat>}
 */
export function makeMotorStat(row) {
  assertObject(row, "makeMotorStat");
  const ctx = `motor venue_code=${String(row.venue_code)} motor_number=${String(row.motor_number)} scraped_date=${String(row.scraped_date)}`;
  assertInt(row.venue_code, 1, 24, "motor の会場コード", ctx);
  assertInt(row.motor_number, SMALLINT_MIN, SMALLINT_MAX, "motor の motor_number", ctx);
  parseIsoDate(row.scraped_date, "motor の scraped_date", ctx);
  if (row.source_template !== undefined) assertText(row.source_template, "motor の source_template", ctx);
  for (const key of STAT_COUNTS) assertIntOrNull(row[key], SMALLINT_MIN, SMALLINT_MAX, `motor の ${key}`, ctx);
  if (row.stats_period_start != null) parseIsoDate(row.stats_period_start, "motor の stats_period_start", ctx);
  if (row.stats_period_end != null) parseIsoDate(row.stats_period_end, "motor の stats_period_end", ctx);
  return Object.freeze({ ...row });
}

/**
 * motor_pretest_stats の行を検査して凍結した写しを返す。pretest_time と pretest_rank の組は両方を取ったときだけ見る
 * @param {object} row
 * @returns {Readonly<MotorPretest>}
 */
export function makeMotorPretest(row) {
  assertObject(row, "makeMotorPretest");
  const ctx = `pretest race_date=${String(row.race_date)} venue_code=${String(row.venue_code)} racer_id=${String(row.racer_id)}`;
  parseIsoDate(row.race_date, "pretest の race_date", ctx);
  assertInt(row.venue_code, 1, 24, "pretest の会場コード", ctx);
  assertInt(row.racer_id, -INT_MAX - 1, INT_MAX, "pretest の racer_id", ctx);
  if (row.racer_class !== undefined) assertOneOf(row.racer_class, RACER_CLASSES, "pretest の racer_class", ctx);
  if (row.motor_number !== undefined) assertInt(row.motor_number, SMALLINT_MIN, SMALLINT_MAX, "pretest の motor_number", ctx);
  if (row.boat_number !== undefined) assertInt(row.boat_number, SMALLINT_MIN, SMALLINT_MAX, "pretest の boat_number", ctx);
  assertIntOrNull(row.pretest_rank, 1, SMALLINT_MAX, "pretest の pretest_rank", ctx);
  if (row.pretest_time !== undefined && row.pretest_rank !== undefined && (row.pretest_time === null) !== (row.pretest_rank === null)) {
    throw new RangeError(`pretest の pretest_time と pretest_rank の片方だけが null: ${String(row.pretest_time)}・${String(row.pretest_rank)}（${ctx}）`);
  }
  return Object.freeze({ ...row });
}
