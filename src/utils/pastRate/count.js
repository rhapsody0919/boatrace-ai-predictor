/**
 * BOA-635「過去に発生した割合を見る」の数え方（docs/design/past-rate-check/spec.md FR-1・共通の数え方）。純粋関数。
 *
 * rows は layer API の rows（同じ条件の過去レース、新しい順最大2,000件）。型ごとに判定に要る値がそろう行だけを
 * 分母 n にし、そろわない行は理由つきで excluded に数える。ST は 1/100秒の整数で比べる（stCent）。
 * スリットの7形は龍神ソナーと同じ slitForms を使う（形の式を二重に持たない）。
 */
import { SLIT_FORMS, slitForms, stCent } from "../analogyScenario.js";
import { TECHNIQUE_NAMES } from "../turnPrediction.js";

/** 型の並び（画面のタブ・振り返りの順） */
export const TYPES = ["order", "boat1", "tenkai", "slit", "entry", "payout"];

/** 展開の決まり手（4つ。抜き・恵まれは出さない） */
export const TENKAI_TECHNIQUES = ["nige", "sashi", "makuri", "makurizashi"];

const SKIP = Symbol("skip");
const ORDER_TOP = 4;

/** 着順の入力 → 3連単の組（同じ艇を含む組は数えない。組の昇順） */
export function orderCombos({ first, second = [], third = [] }) {
  const a = first;
  const out = [];
  for (const b of [...second].sort((x, y) => x - y))
    for (const c of [...third].sort((x, y) => x - y))
      if (b !== a && c !== a && c !== b) out.push([a, b, c]);
  return out;
}

export const orderPoints = (input) => orderCombos(input).length;

const comboKey = (c) => c.join("-");

/** カスタムのスリット: 6艇平均より0.05秒（S−6c ≥ 30）以上速いと「出る」、遅いと「凹む」 */
function customMatch(st, courses) {
  const c = st.map(stCent);
  const s = c.reduce((t, v) => t + v, 0);
  return courses.every((want, k) => {
    if (want === 1) return s - 6 * c[k] >= 30;
    if (want === -1) return 6 * c[k] - s >= 30;
    return true;
  });
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const stComplete = (st) =>
  Array.isArray(st) && st.length === 6 && st.every(isNum);

/** 1行の判定（true／false／SKIP＝分母から除く）と、除くときの理由 */
const JUDGES = {
  order: {
    reason: null,
    judge: (r, input) => {
      const keys = new Set(orderCombos(input).map(comboKey));
      return keys.has(comboKey([r.rank1, r.rank2, r.rank3]));
    },
  },
  boat1: {
    reason: null,
    judge: (r, { outcome }) => {
      const top3 = [r.rank1, r.rank2, r.rank3].includes(1);
      if (outcome === "win") return r.rank1 === 1;
      if (outcome === "top3") return top3;
      return !top3;
    },
  },
  tenkai: {
    reason: "technique",
    judge: (r, { boat, technique }) => {
      if (r.winning_technique == null) return SKIP;
      return (
        r.rank1 === boat && r.winning_technique === TECHNIQUE_NAMES[technique]
      );
    },
  },
  slit: {
    reason: "st",
    judge: (r, input) => {
      const st = r.st_by_course;
      if (!stComplete(st)) return SKIP;
      if (input.mode === "custom") return customMatch(st, input.courses);
      const forms = slitForms(st, input.level);
      return input.patterns.every((p) => forms[p]);
    },
  },
  entry: {
    reason: "course",
    judge: (r, { boat, target }) => {
      const course = Array.isArray(r.course_by_boat)
        ? r.course_by_boat[boat - 1]
        : null;
      if (!isNum(course)) return SKIP;
      if (target === "within3") return course <= 3;
      if (target === "within4") return course <= 4;
      return course === boat;
    },
  },
  payout: {
    reason: "payout",
    judge: (r, { band }) => {
      const p = r.payout_3tan;
      if (!isNum(p)) return SKIP;
      if (band === "low") return p < 1000;
      if (band === "mid") return p >= 1000 && p < 10000;
      return p >= 10000;
    },
  },
};

/** 内訳: 着順（2点以上）は組ごとの上位4組、展開はそのとき2着に来た艇。ほかは null */
function breakdownOf(type, input, hits) {
  if (type === "order" && orderPoints(input) >= 2) {
    const counts = new Map();
    for (const r of hits) {
      const k = comboKey([r.rank1, r.rank2, r.rank3]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const items = [...counts]
      .map(([combo, count]) => ({ combo, count }))
      .sort((a, b) => b.count - a.count || (a.combo < b.combo ? -1 : 1));
    return { items: items.slice(0, ORDER_TOP), more: items.length > ORDER_TOP };
  }
  if (type === "tenkai") {
    const counts = new Map();
    for (const r of hits) counts.set(r.rank2, (counts.get(r.rank2) ?? 0) + 1);
    const items = [...counts]
      .map(([boat, count]) => ({ boat, count }))
      .sort((a, b) => b.count - a.count || a.boat - b.boat);
    return { items, more: false };
  }
  return null;
}

/**
 * 1つの型・入力で数える
 * @param {object[]} rows layer の rows
 * @param {string} type TYPES のどれか
 * @param {object} input 型ごとの入力（spec FR-5 の表と同じ形）
 * @returns {{n: number, count: number, excluded: {reason: string, count: number}[], breakdown: object|null}}
 */
export function countPastRate(rows, type, input) {
  const { reason, judge } = JUDGES[type];
  let skipped = 0;
  const hits = [];
  for (const r of rows) {
    const v = judge(r, input);
    if (v === SKIP) skipped++;
    else if (v) hits.push(r);
  }
  return {
    n: rows.length - skipped,
    count: hits.length,
    excluded: skipped > 0 ? [{ reason, count: skipped }] : [],
    breakdown: breakdownOf(type, input, hits),
  };
}

/** 結果タブの決着の行（着順1点と同じ数え方） */
export const decisionCount = (rows, [a, b, c]) =>
  countPastRate(rows, "order", {
    first: a,
    second: [b],
    third: [c],
    nagashi: false,
  });

/** 定義から同時に起きない2形（T0-2、docs/design/past-rate-check/analysis/slit-pattern-rates.md） */
const BOTH_LEVELS = ["wall+d2", "wall+d3", "wall+d1", "d2+d3", "d2+d1"];
const INCOMPATIBLE = {
  1: new Set(BOTH_LEVELS),
  2: new Set([...BOTH_LEVELS, "flat+d2", "flat+d3", "flat+d1", "flat+dash"]),
};
const pairKey = (a, b) =>
  SLIT_FORMS.indexOf(a) < SLIT_FORMS.indexOf(b) ? `${a}+${b}` : `${b}+${a}`;
const impossible = (a, b, level) => INCOMPATIBLE[level].has(pairKey(a, b));

/**
 * 押すと同時に起きない組になる形（押せなくする）。押した後に残る形と組む: 1形を選んでいればその形、
 * 2形を選んでいれば新しい方（3形目を押すと古い方が外れるため）。選択中の形は外すために押せる
 * @param {string[]} selected 選んだ順
 * @param {1|2} level
 */
export function incompatibleForms(selected, level) {
  if (selected.length === 0) return [];
  const partner = selected[selected.length - 1];
  return SLIT_FORMS.filter(
    (f) => !selected.includes(f) && impossible(f, partner, level),
  );
}

/** 選んだ2形が2段目では同時に起きない組か（「約半艇身」を押せなくする） */
export const levelBlocked = (selected) =>
  selected.length === 2 && impossible(selected[0], selected[1], 2);
