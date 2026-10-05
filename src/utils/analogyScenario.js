/**
 * アナロジー・ファインダー v16 の展開シナリオの定義（BOA-271。plan「定義」）。純粋関数。
 *
 * Python の scripts/ml/analogy/v16_defs.py・v16_facts.py と同じ定義（BOA-635 と共用）。一致は
 * scripts/ml/analogy/testdata/v16-defs-cases.json（Python で作った固定データ）で verify-analogy-facts.js が検査する。
 * - スリットの7形: round(ST×100) の整数で比べる（.5 は上へ。JS の Math.round と同じ）。F の ST は負
 * - 進入の型: 1号艇が1コース以外は inlost（前付けより優先）。前付け＝艇番より内のコースに入った艇
 * - 手がかりの8条件: 平均ST を 1/1000秒に丸めて比べる
 */

export const SLIT_FORMS = ["flat", "wall", "d2", "d3", "kado", "d1", "dash"];
export const HINTS = [
  "kado4",
  "kado4_02",
  "in_slow02",
  "in_fastest",
  "d2_slow01",
  "d3_slow01",
  "dash03",
  "flat03",
];
// spec A-9 の風速区分（類似レースの風速の区分とは別）
export const WIND_BANDS = [
  ["0-1", 0, 1],
  ["2-3", 2, 3],
  ["4-5", 4, 5],
  ["6+", 6, Infinity],
];

const isMissing = (v) => v === null || v === undefined || Number.isNaN(v);

/** 6桁で丸めてから .5 を上へ（Python の v16_defs._round_half_up と同じ） */
const roundHalfUp = (x) => Math.floor(Math.round(x * 1e6) / 1e6 + 0.5);

/** ST（秒）→ 1/100秒の整数 */
export const stCent = (st) => roundHalfUp(st * 100);

/** F の ST は負（出どころを問わず −abs） */
export const signedSt = (st, isFlying) => (isFlying ? -Math.abs(st) : st);

/**
 * コース順の ST（F は負）→ 7形の当否。1艇でも欠ければすべて false。形は重なりうる
 * @param {(number|null)[]} stByCourse
 * @returns {Record<string, boolean>}
 */
export function slitForms(stByCourse) {
  if (stByCourse.length !== 6 || stByCourse.some(isMissing))
    return Object.fromEntries(SLIT_FORMS.map((f) => [f, false]));
  const c = stByCourse.map(stCent);
  const max = (a) => Math.max(...a);
  const min = (a) => Math.min(...a);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  const inner = c.slice(0, 3);
  return {
    flat: max(c) - min(c) <= 6,
    wall: max(inner) - min(inner) <= 2,
    d2: c[1] - Math.min(c[0], c[2]) >= 5,
    d3: c[2] - Math.min(c[1], c[3]) >= 5,
    kado: min(inner) - c[3] >= 3,
    d1: c[0] - c[1] >= 5,
    dash: sum(inner) - sum(c.slice(3)) >= 15,
  };
}

/** 前付けした艇（艇番より内のコースに入った艇。艇番の昇順） */
export function maedukeBoats(courseByBoat) {
  return courseByBoat.flatMap((c, i) =>
    !isMissing(c) && c < i + 1 ? [i + 1] : [],
  );
}

/**
 * 進入の型（"all" を除く7つ）。進入が1艇でも分からなければ null
 * @param {(number|null)[]} courseByBoat 艇番順のコース
 */
export function entryType(courseByBoat) {
  if (courseByBoat.length !== 6 || courseByBoat.some(isMissing)) return null;
  if (courseByBoat[0] !== 1) return "inlost";
  if (courseByBoat.every((c, i) => c === i + 1)) return "waku";
  const m = maedukeBoats(courseByBoat).join(",");
  return { 6: "mae6", 5: "mae5", "5,6": "mae56" }[m] ?? "maeOther";
}

/** 風速（m）→ spec A-9 の区分。無ければ null */
export function windBand(windSpeed) {
  if (isMissing(windSpeed)) return null;
  const hit = WIND_BANDS.find(
    ([, lo, hi]) => windSpeed >= lo && windSpeed <= hi,
  );
  return hit ? hit[0] : null;
}

/**
 * コース順の平均ST（秒）→ 手がかりの8条件。1艇でも欠ければすべて false
 * @param {(number|null)[]} avgStByCourse
 */
export function hintConditions(avgStByCourse) {
  if (avgStByCourse.length !== 6 || avgStByCourse.some(isMissing))
    return Object.fromEntries(HINTS.map((h) => [h, false]));
  const c = avgStByCourse.map((v) => roundHalfUp(v * 1000));
  const inner = c.slice(0, 3);
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  return {
    kado4: c[3] < Math.min(...inner),
    kado4_02: Math.min(...inner) - c[3] >= 20,
    in_slow02: c[0] - c[1] >= 20,
    in_fastest: c[0] < Math.min(...c.slice(1)),
    d2_slow01: c[1] - Math.max(c[0], c[2]) >= 10,
    d3_slow01: c[2] - Math.max(c[1], c[3]) >= 10,
    dash03: sum(inner) - sum(c.slice(3)) >= 30,
    flat03: Math.max(...c) - Math.min(...c) <= 30,
  };
}
