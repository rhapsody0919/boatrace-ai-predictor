// 補正Harville の本体は src/pure/harville.js（画面の src からも読むため）。ここは同じ名の再 export と CLI の自己試験だけ
import {
  impliedProbsFromOdds,
  exactaProb,
  trifectaProb,
  trioProb,
  trifectaProbFromCombo,
} from "../../src/pure/harville.js";

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

export {
  BENTER_GAMMA,
  BENTER_DELTA,
  normalizeProbs,
  impliedProbsFromOdds,
  condSecond,
  condThird,
  exactaProb,
  trifectaProb,
  trioProb,
  trifectaProbFromCombo,
  trioProbFromCombo,
} from "../../src/pure/harville.js";
