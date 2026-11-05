/**
 * 固定の材料の写し（fixtures/*.json.gz）を、型 f01 の検査・試験で使える形に埋める（純関数。元の材料は変えない）。
 * 使う所: scripts/maintenance/verify-full-picture-scene2.js・verify-sns-makers.js（ADR-0105）。
 *
 * 写しは build が読んだ所だけで、出走表の名前は1艇目だけ・級は無い（make-fixture.mjs が落とす）。級を同じ写しの
 * facts.today.classes から、名前を names で埋める。試験の材料（10/12〜10/19）は race.startTime（締切）を持つ前の物で、
 * 写しは /1（日目・大会名を持つ前）なので、一般戦の3日目・締切 16:44 で埋める（毎日の材料は /2 から持つ、BOA-1310）。
 */
/** 6字（race_entries の最長、2026-09〜の実測）の仮の名前 */
export const F01_LONG_NAMES = ["壱壱壱壱壱壱", "弐弐弐弐弐弐", "参参参参参参", "肆肆肆肆肆肆", "伍伍伍伍伍伍", "陸陸陸陸陸陸"];

/**
 * @param {object} materials 写しの材料
 * @param {string[]} names 1〜6号艇の名前
 * @returns {object} 埋めた材料（写し）
 */
export function withF01Fields(materials, names = F01_LONG_NAMES) {
  const mf = structuredClone(materials);
  const race = mf.api.races.find((r) => r.raceId === mf.raceId);
  race.entries = [1, 2, 3, 4, 5, 6].map((b) => ({ ...race.entries.find((e) => e.number === b), number: b, name: names[b - 1], grade: mf.api.facts.today.classes[b - 1] }));
  mf.race = { grade: "ippan", seriesDayText: "3日目", raceTitle: null, ...mf.race, startTime: mf.race?.startTime ?? "16:44:00" };
  return mf;
}
