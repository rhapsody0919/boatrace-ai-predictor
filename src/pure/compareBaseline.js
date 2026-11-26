/**
 * 数字に「基準との比べ」「6艇の中の比べ」を付けるための判定（意味づけ、2026-11-26 オーナー承認）。
 *
 * 決まり（共有ノートの m2-meaning/step4-types.md、data-scientist の偶然の幅の計算）:
 * - 位置（棒・点）は全部に出す。良し悪しの色は、差が偶然のぶれを超えたときだけ
 *   （1人・6艇は |z|≥1.96、24会場を同時に比べるときは |z|>3.08）
 * - 走数が足りない値は色の判定をしない（"few"。値と走数は画面に出す）
 * - 期待の件数が小さい率（5・6コースの1着率など）は正規近似が崩れるので、正確な二項で判定する
 * - 6艇の中の比べは「上位2位まで・下位2位まで」の3段。同じ値は同じ順位
 *   （展示タイム等の順位の効き目は上位1〜2位と5〜6位で検証済み。docs/knowledge/stat-findings.md）
 */

/** 1人・6艇の比べの線（95%） */
export const Z_LINE = 1.96;
/** 24会場を同時に比べるときの線（Bonferroni、0.05/24 の両側） */
export const Z_LINE_VENUES = 3.08;

// 期待の件数がこれ未満なら正確な二項で判定する（正規近似の目安。根拠: 二項の正規近似の一般的な目安）
const EXACT_MIN_EXPECTED = 10;

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// 標準正規の上側確率（Abramowitz-Stegun 26.2.17、誤差 7.5e-8 未満）
function upperTail(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const q = (Math.exp((-z * z) / 2) / Math.sqrt(2 * Math.PI)) * poly;
  return z >= 0 ? q : 1 - q;
}

// 二項 B(n, p) の P(X ≥ k) と P(X ≤ k)。p > 0.5 は失敗の数で数え直す
// （(1−p)^n から始めるので、p が大きく n が大きいと下へ溢れて 0 になる）
function binomialTails(n, p, k) {
  if (p > 0.5) {
    const flipped = binomialTails(n, 1 - p, n - k);
    return { atLeast: flipped.atMost, atMost: flipped.atLeast };
  }
  let pmf = Math.pow(1 - p, n);
  let below = 0;
  let atK = 0;
  for (let i = 0; i <= n; i += 1) {
    if (i < k) below += pmf;
    if (i === k) atK = pmf;
    pmf = (pmf * (n - i) * p) / ((i + 1) * (1 - p));
  }
  return { atLeast: 1 - below, atMost: below + atK };
}

/**
 * 率（%）を基準の率（%）と比べる。
 *
 * @param {{rate: number|null|undefined, baseline: number|null|undefined, n: number, minN?: number, zLine?: number}} args
 *   rate・baseline は 0〜100 の %。n は走数（率の分母）。minN 未満は "few"
 * @returns {{diff: number, dir: "high"|"low"|"unclear"|"few"} | null}
 *   diff は rate − baseline（pt）。値か基準が無ければ null
 */
export function judgeRateVsBaseline({ rate, baseline, n, minN = 1, zLine = Z_LINE }) {
  if (!isNum(rate) || !isNum(baseline) || !isNum(n)) return null;
  const diff = rate - baseline;
  if (n < minN || n <= 0) return { diff, dir: "few" };
  const p = baseline / 100;
  if (p <= 0 || p >= 1) return { diff, dir: "unclear" };
  const alpha = upperTail(zLine);
  if (n * p < EXACT_MIN_EXPECTED || n * (1 - p) < EXACT_MIN_EXPECTED) {
    const k = Math.round((rate / 100) * n);
    const { atLeast, atMost } = binomialTails(n, p, k);
    if (k > n * p && atLeast < alpha) return { diff, dir: "high" };
    if (k < n * p && atMost < alpha) return { diff, dir: "low" };
    return { diff, dir: "unclear" };
  }
  const z = (rate / 100 - p) / Math.sqrt((p * (1 - p)) / n);
  if (z >= zLine) return { diff, dir: "high" };
  if (z <= -zLine) return { diff, dir: "low" };
  return { diff, dir: "unclear" };
}

/**
 * 平均（ST 等）を基準の平均と比べる。sd は1走の標準偏差（平均ST なら 0.066 秒）。
 *
 * @param {{mean: number|null|undefined, baseline: number|null|undefined, n: number, sd: number, minN?: number, zLine?: number}} args
 * @returns {{diff: number, dir: "high"|"low"|"unclear"|"few"} | null}
 */
export function judgeMeanVsBaseline({ mean, baseline, n, sd, minN = 1, zLine = Z_LINE }) {
  if (!isNum(mean) || !isNum(baseline) || !isNum(n) || !isNum(sd) || sd <= 0) return null;
  const diff = mean - baseline;
  if (n < minN || n <= 0) return { diff, dir: "few" };
  const z = diff / (sd / Math.sqrt(n));
  if (z >= zLine) return { diff, dir: "high" };
  if (z <= -zLine) return { diff, dir: "low" };
  return { diff, dir: "unclear" };
}

/**
 * 向き（high/low）を良し悪しに直す。better は「高いほど良い」なら "high"。
 * 会場の傾向のように良し悪しでない物は使わず、dir をそのまま「出やすい・出にくい」にする。
 *
 * @param {"high"|"low"|"unclear"|"few"|null|undefined} dir
 * @param {"high"|"low"} better
 * @returns {"good"|"bad"|null}
 */
export function toneOf(dir, better) {
  if (dir !== "high" && dir !== "low") return null;
  return dir === better ? "good" : "bad";
}

/**
 * 6艇の中の上位・下位の3段。同じ値は同じ順位（自分より良い艇の数で順位を決める）。
 * 値のある艇が size×2 以下、または全艇同値なら空（上位と下位が重なり意味が無い）。
 *
 * @param {{boat: number, value: number|null|undefined}[]} candidates
 * @param {"max"|"min"} [dir] 高いほど良いなら "max"、低いほど良い（展示タイム等）なら "min"
 * @param {{size?: number, digits?: number}} [options] digits は表示の桁（bestOf と同じ理由で丸めて比べる）
 * @returns {Map<number, "top"|"bottom">}
 */
export function rankTiers(candidates, dir = "max", { size = 2, digits } = {}) {
  const round = (v) => (digits === undefined ? v : Number(v.toFixed(digits)));
  const values = (candidates ?? [])
    .filter((c) => isNum(c.value))
    .map((c) => ({ boat: c.boat, value: round(c.value) }));
  const tiers = new Map();
  if (values.length <= size * 2) return tiers;
  const better = (a, b) => (dir === "min" ? a < b : a > b);
  for (const c of values) {
    const betterCount = values.filter((o) => better(o.value, c.value)).length;
    const worseCount = values.filter((o) => better(c.value, o.value)).length;
    if (betterCount === 0 && worseCount === 0) return new Map();
    if (betterCount < size) tiers.set(c.boat, "top");
    else if (worseCount < size) tiers.set(c.boat, "bottom");
  }
  return tiers;
}
