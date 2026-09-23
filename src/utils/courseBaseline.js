/**
 * ST考察の「同コース・同級別の平均との差」の算出（phase a FR-1）
 *
 * 設計: docs/design/analysis-visualization-upgrade/spec.md「コース別・級別のベースライン」
 *       docs/adr/0069 ではなく docs/adr/0068-course-baseline-precomputation.md
 *
 * ## なぜ級別まで分けるか
 *
 * 級別の交絡が、コース差と同じ大きさで実在する（2026-09-23の実測）。
 *
 *   コース効果（A1内、1コース→6コース）: 安定率 74.4% → 54.3% = 20.1pt
 *   級別効果（1コース内、A1→B2）       : 安定率 74.4% → 56.5% = 17.9pt
 *
 * 級別を無視したベースラインを使うと、B2級の選手は何コースでも「平均より悪い」、
 * A1級は何コースでも「平均より良い」と出る。それは選手個人のスタート巧拙ではなく
 * 級別を再表示しているだけで、差を併記する意味が消える。
 * 24セルすべてで n >= 1,079 あり、「級別に分けるとnが足りない」という当初の
 * 懸念は実測で否定された。
 *
 * ## 差の「良い向き」
 *
 * 安定率・抜出回数は高いほど良い、出遅率は低いほど良い。画面はこの向きに応じて
 * 色（--color-success-text / --color-error-text）を反転させる。
 */

/** 指標ごとの「高いほど良いか」。画面の色分けの向きに使う */
export const METRIC_DIRECTION = {
  stableRate: "higher-is-better",
  lateRate: "lower-is-better",
  breakoutCount: "higher-is-better",
  avgSt: "lower-is-better",
};

/**
 * `st_course_baseline` の行配列を、(course, grade) で引けるMapにする。
 *
 * @param {Array<Object>} rows st_course_baseline の行（course / grade / stable_rate / late_rate / ...）
 * @returns {Map<string, Object>} キーは `${course}-${grade}`
 */
export function indexBaseline(rows) {
  const map = new Map();
  for (const row of rows ?? []) {
    if (row?.course === null || row?.course === undefined) continue;
    if (!row?.grade) continue;
    map.set(`${row.course}-${row.grade}`, row);
  }
  return map;
}

/**
 * (course, grade) のベースラインセルを引く。無ければ null。
 *
 * 級別は**その選手の現在の級別**（そのレースの出走表の値）で引く。
 * 期途中で級別が変わった選手の過去の走は別のセルに分散するが、表示の一貫性を
 * 優先してこうする（spec.md 未確定事項1c）。
 */
export function getBaselineCell(baselineIndex, course, grade) {
  if (!baselineIndex || course === null || course === undefined || !grade) {
    return null;
  }
  return baselineIndex.get(`${course}-${grade}`) ?? null;
}

/**
 * 選手の値とベースラインの差を求める。
 *
 * @param {number|null} value 選手の値
 * @param {number|null} baseline 同コース・同級別の平均
 * @param {"higher-is-better"|"lower-is-better"} direction
 * @returns {{diff: number|null, isBetter: boolean|null}}
 *   diff は「選手の値 − ベースライン」（符号はそのまま。画面が「+12.1pt」等で出す）。
 *   isBetter は direction を踏まえた良し悪し（色分けに使う）。差が0のときは null
 */
export function diffFromBaseline(value, baseline, direction) {
  if (
    value === null ||
    value === undefined ||
    baseline === null ||
    baseline === undefined
  ) {
    return { diff: null, isBetter: null };
  }
  const diff = Number(value) - Number(baseline);
  if (diff === 0) return { diff: 0, isBetter: null };
  const isBetter = direction === "lower-is-better" ? diff < 0 : diff > 0;
  return { diff, isBetter };
}

/**
 * 抜出の「期待回数」を求める。
 *
 * 抜出は率ではなく実回数を主表示にするため（外のコースは30走あたり0.2〜0.4回しか
 * 起きず、率にすると0.0%が並ぶ）、ベースラインの率を選手の走数に換算して
 * 「平均 2.1回」の形で添える。
 *
 * @param {number|null} baselineRate ベースラインの抜出率(%)
 * @param {number} runs 選手のそのコースでの走数
 * @returns {number|null}
 */
export function expectedBreakoutCount(baselineRate, runs) {
  if (baselineRate === null || baselineRate === undefined) return null;
  if (!Number.isFinite(runs) || runs <= 0) return null;
  return (Number(baselineRate) / 100) * runs;
}
