// 補正Harvilleモデル: 単勝確率から2連単・3連単・3連複の確率を導出する
//
// 素のHarville式は「1着確率をそのまま2着・3着の条件付き確率に流用」するため
// 本命の2・3着確率を過大評価するバイアスがある。
// Benter (1994) の補正に倣い、2着・3着の条件付き確率に減衰指数
// (gamma, delta) を適用して補正する。
//   P(2着=j | 1着=i) = p_j^gamma / Σ_{k≠i} p_k^gamma
//   P(3着=k | 1着=i, 2着=j) = p_k^delta / Σ_{m≠i,j} p_m^delta
// gamma=delta=1 で素のHarvilleに一致する。
// 既定値は Benter (1994) の香港競馬での推定値 (gamma≈0.81, delta≈0.65)。

export const BENTER_GAMMA = 0.81;
export const BENTER_DELTA = 0.65;

// 確率配列を合計1に正規化（0や負値は最小値でクランプ）
export function normalizeProbs(probs) {
  const MIN_P = 1e-9;
  const clamped = probs.map((p) =>
    typeof p === "number" && p > MIN_P ? p : MIN_P,
  );
  const sum = clamped.reduce((s, p) => s + p, 0);
  return clamped.map((p) => p / sum);
}

// オッズ配列（単勝）→ implied 確率（ブックメーカーマージン除去済み）
export function impliedProbsFromOdds(oddsArr) {
  const inv = oddsArr.map((o) => (typeof o === "number" && o > 1 ? 1 / o : 0));
  return normalizeProbs(inv);
}

// P(2着=second | 1着=first)
export function condSecond(probs, first, second, gamma) {
  let denom = 0;
  for (let k = 0; k < probs.length; k++) {
    if (k === first) continue;
    denom += probs[k] ** gamma;
  }
  return probs[second] ** gamma / denom;
}

// P(3着=third | 1着=first, 2着=second)
export function condThird(probs, first, second, third, delta) {
  let denom = 0;
  for (let k = 0; k < probs.length; k++) {
    if (k === first || k === second) continue;
    denom += probs[k] ** delta;
  }
  return probs[third] ** delta / denom;
}

/**
 * 2連単確率 P(1着=a, 2着=b)
 * @param {number[]} winProbs - 各艇の単勝確率（インデックス=艇番-1）
 * @param {[number, number]} combo - [a, b]（0-indexed）
 */
export function exactaProb(winProbs, [a, b], opts = {}) {
  const gamma = opts.gamma ?? BENTER_GAMMA;
  const p = normalizeProbs(winProbs);
  return p[a] * condSecond(p, a, b, gamma);
}

/**
 * 3連単確率 P(1着=a, 2着=b, 3着=c)
 * @param {number[]} winProbs - 各艇の単勝確率（インデックス=艇番-1）
 * @param {[number, number, number]} combo - [a, b, c]（0-indexed）
 */
export function trifectaProb(winProbs, [a, b, c], opts = {}) {
  const gamma = opts.gamma ?? BENTER_GAMMA;
  const delta = opts.delta ?? BENTER_DELTA;
  const p = normalizeProbs(winProbs);
  return p[a] * condSecond(p, a, b, gamma) * condThird(p, a, b, c, delta);
}

/**
 * 3連複確率 P({a,b,c} が上位3着)＝6順列の3連単確率の合計
 */
export function trioProb(winProbs, [a, b, c], opts = {}) {
  const perms = [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
  return perms.reduce(
    (sum, perm) => sum + trifectaProb(winProbs, perm, opts),
    0,
  );
}

/**
 * "1-2-3" 形式の買い目文字列（艇番1-6）で3連単確率を計算
 */
export function trifectaProbFromCombo(winProbs, comboStr, opts = {}) {
  const parts = String(comboStr)
    .split("-")
    .map((s) => parseInt(s, 10) - 1);
  if (parts.length !== 3 || parts.some((i) => !(i >= 0 && i < winProbs.length)))
    return null;
  if (new Set(parts).size !== 3) return null;
  return trifectaProb(winProbs, parts, opts);
}

/**
 * "1-2-3" 形式の買い目文字列（艇番1-6）で3連複確率を計算
 */
export function trioProbFromCombo(winProbs, comboStr, opts = {}) {
  const parts = String(comboStr)
    .split("-")
    .map((s) => parseInt(s, 10) - 1);
  if (parts.length !== 3 || parts.some((i) => !(i >= 0 && i < winProbs.length)))
    return null;
  if (new Set(parts).size !== 3) return null;
  return trioProb(winProbs, parts, opts);
}

// CLI self-test（ブラウザから import される場合は process が無いためガード）
if (
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  process.argv[1].endsWith("harville.js")
) {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`Assertion failed: ${msg}`);
  };
  const approx = (x, y, eps = 1e-9) => Math.abs(x - y) < eps;

  const p = [0.4, 0.25, 0.15, 0.1, 0.06, 0.04];

  // 全3連単順列の確率合計は1（gamma/delta任意で成立）
  let total = 0;
  for (let a = 0; a < 6; a++)
    for (let b = 0; b < 6; b++)
      for (let c = 0; c < 6; c++) {
        if (a === b || b === c || a === c) continue;
        total += trifectaProb(p, [a, b, c]);
      }
  assert(approx(total, 1, 1e-9), `trifecta probs sum to 1 (got ${total})`);

  // gamma=delta=1 で素のHarvilleに一致
  const plain = trifectaProb(p, [0, 1, 2], { gamma: 1, delta: 1 });
  const expected = p[0] * (p[1] / (1 - p[0])) * (p[2] / (1 - p[0] - p[1]));
  assert(approx(plain, expected), "gamma=delta=1 equals plain Harville");

  // Benter補正は素のHarvilleより本命の3連単確率を下げる
  const corrected = trifectaProb(p, [0, 1, 2]);
  assert(
    corrected < plain,
    `correction dampens favorite (corrected=${corrected}, plain=${plain})`,
  );

  // trioProb = 6順列の合計
  const trio = trioProb(p, [0, 1, 2]);
  assert(trio > corrected, "trio >= trifecta");

  // 文字列コンボ（艇番は1-indexed）
  assert(
    approx(trifectaProbFromCombo(p, "1-2-3"), corrected),
    "combo string parse",
  );
  assert(trifectaProbFromCombo(p, "1-1-3") === null, "duplicate boats invalid");
  assert(trifectaProbFromCombo(p, "1-2") === null, "short combo invalid");

  // exacta の周辺化: Σ_c trifecta(a,b,c) = exacta(a,b)
  let margSum = 0;
  for (let c = 0; c < 6; c++) {
    if (c === 0 || c === 1) continue;
    margSum += trifectaProb(p, [0, 1, c]);
  }
  assert(
    approx(margSum, exactaProb(p, [0, 1])),
    "trifecta marginalizes to exacta",
  );

  // implied probs
  const imp = impliedProbsFromOdds([2.0, 4.0, 8.0, 8.0, 16.0, 16.0]);
  assert(
    approx(
      imp.reduce((s, x) => s + x, 0),
      1,
    ),
    "implied probs normalized",
  );
  assert(imp[0] > imp[1], "lower odds -> higher prob");

  console.log("harville: all assertions passed");
}
