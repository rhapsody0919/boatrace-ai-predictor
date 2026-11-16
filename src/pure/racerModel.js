import { assertInt, assertIntOrNull, assertObject, assertText, parseIsoDate } from "./modelAssert.js";

// 既存の選手の集計（置き場はそのまま、ここは入口を集める）
export {
  CAREER_EXTRA_FINAL_STAGES,
  careerFinishCounts,
  careerFinishPoints,
  careerWinRate,
  isCareerFinalAppearance,
  isCareerFinalStage,
  isCareerStart,
} from "./racerCareerStats.js";

// racer_id の型 integer の範囲（schema-snapshot）。それ以上の範囲の根拠は無い
const INT4_MIN = -2147483648;
const INT4_MAX = 2147483647;

/**
 * racer_profiles の行（キーは Supabase の snake_case のまま）。根拠: docs/reference/schema-snapshot.json の
 * racer_profiles（racer_id は主キーの integer・name と birth_date は NOT NULL、他は null がありうる）
 * @typedef {object} Racer
 * @property {number} racer_id integer（int4 の範囲）。正の数かは DB に根拠が無いので検査しない
 * @property {string} name
 * @property {string} birth_date YYYY-MM-DD
 * @property {(number|null)} [sex] smallint。1=男・2=女（COMMENT のみで CHECK は無いので値は検査しない）
 * @property {(string|null)} [grade_at_scrape] 検査しない（CHECK が無い）
 */

/**
 * racer_series_points（選手×節の公式の得点率）の行。rank・score_rate・remarks は賞典除外・途中帰郷で null
 * @typedef {object} RacerSeriesPoint
 * @property {number} venue_code 1〜24
 * @property {string} meet_start_date YYYY-MM-DD
 * @property {number} racer_id
 * @property {(number|null)} [next_race_1] 1〜12
 * @property {(number|null)} [next_race_2] 1〜12
 * @property {(number|null)} [next_series_day] 1〜9
 */

/**
 * racer_profiles の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<Racer>}
 */
export function makeRacer(row) {
  assertObject(row, "makeRacer");
  const ctx = `racer_id=${String(row.racer_id)}`;
  assertInt(row.racer_id, INT4_MIN, INT4_MAX, "racer の racer_id", ctx);
  assertText(row.name, "racer の name", ctx);
  parseIsoDate(row.birth_date, "racer の birth_date", ctx);
  assertIntOrNull(row.sex, -32768, 32767, "racer の sex", ctx);
  return Object.freeze({ ...row });
}

/**
 * racer_series_points の行を検査して凍結した写しを返す。rank・score_rate などの null は落とさない
 * @param {object} row
 * @returns {Readonly<RacerSeriesPoint>}
 */
export function makeRacerSeriesPoint(row) {
  assertObject(row, "makeRacerSeriesPoint");
  const ctx = `racer_id=${String(row.racer_id)} venue_code=${String(row.venue_code)} meet_start_date=${String(row.meet_start_date)}`;
  assertInt(row.racer_id, INT4_MIN, INT4_MAX, "racer_series_point の racer_id", ctx);
  assertInt(row.venue_code, 1, 24, "racer_series_point の会場コード", ctx);
  parseIsoDate(row.meet_start_date, "racer_series_point の meet_start_date", ctx);
  assertIntOrNull(row.next_race_1, 1, 12, "racer_series_point の next_race_1", ctx);
  assertIntOrNull(row.next_race_2, 1, 12, "racer_series_point の next_race_2", ctx);
  assertIntOrNull(row.next_series_day, 1, 9, "racer_series_point の next_series_day", ctx);
  return Object.freeze({ ...row });
}
