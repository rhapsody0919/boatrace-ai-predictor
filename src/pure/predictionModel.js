import { assertInt, assertIntOrNull, assertObject, assertText } from "./modelAssert.js";
import { parseRaceId } from "./raceId.js";

/**
 * predictions（1レース1モデルの予想の1行）。キーは Supabase の snake_case のまま。
 * 根拠: docs/reference/schema-snapshot.json の relations predictions（race_id・model_id は NOT NULL で UNIQUE の組、
 * race_id は races の外部キーで races の race_id は raceModel.js と同じ YYYY-MM-DD-VV-RR、top_pick は NOT NULL の smallint。
 * CHECK は無いので艇番の範囲は見ない）。select で取っていない列（undefined）は検査しない
 * @typedef {object} Prediction
 * @property {string} race_id YYYY-MM-DD-VV-RR
 * @property {string} model_id
 * @property {number} [prediction_id] integer（主キー）
 * @property {number} [top_pick] smallint
 * @property {(number|null)} [top_2nd] smallint
 * @property {(number|null)} [top_3rd] smallint
 * @property {(boolean|null)} [is_hit_win] 以下の真偽の6列は結果が出るまで null
 * @property {(boolean|null)} [is_hit_place]
 * @property {(boolean|null)} [is_hit_trifecta]
 * @property {(boolean|null)} [is_hit_trio]
 * @property {(boolean|null)} [is_hit_turn]
 * @property {(boolean|null)} [is_shadow]
 * @property {(number|null)} [payout_win] 以下の払戻の4列は integer
 * @property {(number|null)} [payout_place]
 * @property {(number|null)} [payout_trifecta]
 * @property {(number|null)} [payout_trio]
 */

const SMALLINT_MIN = -32768;
const SMALLINT_MAX = 32767;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const BOOL_KEYS = ["is_hit_win", "is_hit_place", "is_hit_trifecta", "is_hit_trio", "is_hit_turn", "is_shadow"];
const PAYOUT_KEYS = ["payout_win", "payout_place", "payout_trifecta", "payout_trio"];

/**
 * predictions の行を検査して凍結した写しを返す
 * @param {object} row
 * @returns {Readonly<Prediction>}
 */
export function makePrediction(row) {
  assertObject(row, "makePrediction");
  const ctx = `prediction race_id=${String(row.race_id)} model_id=${String(row.model_id)}`;
  if (!parseRaceId(row.race_id)) {
    throw new RangeError(`prediction の race_id が YYYY-MM-DD-VV-RR の形でない: ${String(row.race_id)}（${ctx}）`);
  }
  assertText(row.model_id, "prediction の model_id", ctx);
  if (row.prediction_id !== undefined) assertInt(row.prediction_id, INT_MIN, INT_MAX, "prediction の prediction_id", ctx);
  if (row.top_pick !== undefined) assertInt(row.top_pick, SMALLINT_MIN, SMALLINT_MAX, "prediction の top_pick", ctx);
  assertIntOrNull(row.top_2nd, SMALLINT_MIN, SMALLINT_MAX, "prediction の top_2nd", ctx);
  assertIntOrNull(row.top_3rd, SMALLINT_MIN, SMALLINT_MAX, "prediction の top_3rd", ctx);
  for (const key of BOOL_KEYS) {
    if (row[key] != null && typeof row[key] !== "boolean") {
      throw new RangeError(`prediction の ${key} が真偽か null でない: ${String(row[key])}（${ctx}）`);
    }
  }
  for (const key of PAYOUT_KEYS) assertIntOrNull(row[key], INT_MIN, INT_MAX, `prediction の ${key}`, ctx);
  return Object.freeze({ ...row });
}
