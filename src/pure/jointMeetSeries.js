/**
 * 同じ節に格の違う2つの開催が同居する「併催」を、選手の組に分ける（純関数、G3 の点検 V-61、2026-11-26）。
 *
 * SG チャレンジカップと G2 レディースチャレンジカップは同じ会場・同じ日程で開き、公式の得点率一覧
 * （race/pointrank）も「チャレンジカップ」「レディースチャレンジカップ」の2表に分け、順位をそれぞれ1から
 * 振る（official-data-spec、2026-11-26 常滑 34名＋21名・2025-11-30 福岡も同じ形）。1つの順位に混ぜると
 * 準優の目安・順位が両方ともズレる。
 *
 * 見分け方は `scripts/lib/racerCareerSeries.js` の規則 `cc` と同じ（題に「チャレンジカップ」と
 * 「レディース」）。src は scripts を読めないので、ここに置き直した。題だけでは分けず、得点率に算入する
 * レースで選手をつないだ組がちょうど2つ・各6人以上のときだけ分ける（`splitMeetSeries` の安全弁と同じ考え。
 * 欠測で組が切れた節を誤って割らない）。予選の間は男女が同じレースに乗らない（公式の日程、2026/11/52408）。
 *
 * G2 には準優勝戦が無い（予選の後は最終日の特別選抜戦と優勝戦）。2025 福岡では女子の表の1〜6位が
 * 優勝戦に乗った。公式の文の規則は未確認なので、画面は「優勝戦の目安」を当社の推定と断って出す。
 */
import { prelimEndRaceIdOf, seriesComponentsOf } from "./seriesPoints.js";

/** 準優勝戦の無い G2 の、優勝戦の目安の人数（2025 福岡の実績からの推定） */
export const JOINT_FINAL_SLOTS = 6;

const MIN_GROUP_SIZE = 6;

const JOINT_RULES = Object.freeze([
  {
    id: "cc",
    match: (title) => title.includes("チャレンジカップ") && title.includes("レディース"),
    // primary（SG）は準優勝戦がある。other（G2）は準優勝戦が無く、優勝戦の目安を出す
    primary: { key: "cc-sg", grade: "SG", goal: "semifinal" },
    other: { key: "cc-g2", grade: "G2", goal: "final" },
  },
]);

const titleOf = (r) =>
  String(r.raceTitle ?? r.race_title ?? "").normalize("NFKC");
const raceIdOf = (r) => r.raceId ?? r.race_id;

/**
 * どちらの組が SG か。最終日の12R（SG の優勝戦。G2 の優勝戦は11R）に出た組、
 * まだ最終日の番組が無ければ人数の多い組（常滑・福岡とも SG 34名・G2 21名）。
 */
function primaryIndexOf(comps, list, racersByRace) {
  const isFinalDay = (r) => r.is_final_day === true || r.isFinalDay === true;
  const seed = list.find((r) => isFinalDay(r) && raceIdOf(r).endsWith("-12"));
  const seedRacers = seed ? (racersByRace.get(raceIdOf(seed)) ?? []) : [];
  const bySeed = comps.findIndex((c) => seedRacers.some((id) => c.has(id)));
  if (bySeed >= 0) return bySeed;
  return comps[0].size >= comps[1].size ? 0 : 1;
}

/**
 * 併催の節なら、開催ごとの選手の組を返す。そうでなければ null。
 *
 * @param {Array<{race_id: string, race_stage?: string|null, race_title?: string|null,
 *   is_final_day?: boolean}>} conditions 節の全レース（種別）
 * @param {Map<string, Array<number>>} racersByRace `race_id` → 出走選手ID
 * @returns {Array<{key: string, grade: string, goal: "semifinal"|"final",
 *   racerIds: Set<number>, conditions: Array<Object>, prelimEndRaceId: string|null}>|null}
 *   SG を先に。`conditions` はその組の選手が出たレースだけ、`prelimEndRaceId` はその組の予選の終わり
 *   （併催では予選の終わりが組ごとに違う。常滑 2026 は SG が4日目12R、G2 が5日目9R）
 */
export function jointMeetSeriesOf(conditions, racersByRace) {
  const list = Array.isArray(conditions) ? conditions : [];
  if (list.length === 0 || !(racersByRace instanceof Map)) return null;
  const rule = JOINT_RULES.find((r) => list.some((c) => r.match(titleOf(c))));
  if (!rule) return null;
  const comps = seriesComponentsOf(list, racersByRace);
  if (comps.length !== 2 || comps.some((c) => c.size < MIN_GROUP_SIZE)) {
    return null;
  }
  const p = primaryIndexOf(comps, list, racersByRace);
  return [
    { ...rule.primary, racerIds: comps[p] },
    { ...rule.other, racerIds: comps[1 - p] },
  ].map((s) => {
    const own = list.filter((c) =>
      (racersByRace.get(raceIdOf(c)) ?? []).some((id) => s.racerIds.has(id)),
    );
    return { ...s, conditions: own, prelimEndRaceId: prelimEndRaceIdOf(own) };
  });
}
