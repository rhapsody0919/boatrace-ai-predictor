import { assertInt, assertObject, assertOneOf, parseIsoDate } from "./modelAssert.js";

// 既存の節の計算（置き場はそのまま、ここは入口を集める）
export { groupIntoCurrentMeet, groupIntoMeetBeforeRace } from "./meetGrouping.js";
export { meetExclusionsOf } from "./meetExclusion.js";

/**
 * race_series（節）の行。キーは Supabase の snake_case のまま。根拠: race_series の CHECK 6本
 * （docs/reference/schema-snapshot.json の relations race_series の constraints）
 * @typedef {object} Meet
 * @property {number} venue_code 1〜24（主キーの片方）
 * @property {string} start_date YYYY-MM-DD（主キーの片方、初日）
 * @property {string} end_date start_date 以後
 * @property {number} total_days end_date - start_date + 1（日数）
 * @property {string} class_code SG・G1・G2・G3・Ippan・Lady・Venus・Rookie・Takumi
 * @property {string} kind sg・g1・g2・g3・ippan・lady・venus・rookie・masters
 * @property {(null|"SG"|"G1"|"G2"|"G3"|"ippan")} [grade] class_code とは別の列（大文字小文字も別）
 * @property {(string|null)} [title]
 */

const CLASS_CODES = ["SG", "G1", "G2", "G3", "Ippan", "Lady", "Venus", "Rookie", "Takumi"];
const KINDS = ["sg", "g1", "g2", "g3", "ippan", "lady", "venus", "rookie", "masters"];
const GRADES = ["SG", "G1", "G2", "G3", "ippan"];
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * race_series の行を検査して凍結した写しを返す。日数の上限は DB に無いので検査しない
 * @param {object} row
 * @returns {Readonly<Meet>}
 */
export function makeMeet(row) {
  assertObject(row, "makeMeet");
  const ctx = `meet venue_code=${String(row.venue_code)} start_date=${String(row.start_date)}`;
  assertInt(row.venue_code, 1, 24, "meet の会場コード", ctx);
  const start = parseIsoDate(row.start_date, "meet の start_date", ctx);
  const end = parseIsoDate(row.end_date, "meet の end_date", ctx);
  if (end < start) {
    throw new RangeError(`meet の end_date が start_date より前: ${row.end_date}（${ctx}）`);
  }
  const days = (end - start) / DAY_MS + 1;
  if (row.total_days !== days) {
    throw new RangeError(`meet の total_days が end_date - start_date + 1 と違う: ${String(row.total_days)}（期待 ${days}、${ctx}）`);
  }
  assertOneOf(row.class_code, CLASS_CODES, "meet の class_code", ctx);
  assertOneOf(row.kind, KINDS, "meet の kind", ctx);
  if (row.grade != null) assertOneOf(row.grade, GRADES, "meet の grade", ctx);
  return Object.freeze({ ...row });
}
