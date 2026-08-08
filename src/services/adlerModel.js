/**
 * アドラー予想 共有モデルロジック（純粋関数のみ）
 *
 * 位置別温度付き Plackett-Luce: シャーロックの勝率を効用として、
 * 2連単・3連単・3連複の順列確率を導出する。数式本体は
 * scripts/lib/harville.js（補正Harville = 同一モデル）を共用し、
 * 温度パラメータ (gamma, delta) は実レースデータでフィットした値
 * （data/adler/model.json、scripts/analysis/train-adler-temps.js で週次更新）を使う。
 * Node/ブラウザ両対応のため、外部依存・副作用は持たない。
 */

import {
  exactaProb,
  trifectaProb,
  trioProb,
} from "../../scripts/lib/harville.js";

/** [a, b, c]（0-indexed）→ "1-2-3"（艇番表記） */
const comboLabel = (combo) => combo.map((i) => i + 1).join("-");

/**
 * 6艇の勝率から全順列確率を列挙し、確率降順の上位を返す
 * @param {number[]} winProbs - 各艇の勝率（インデックス = 艇番-1、合計1）
 * @param {Object} opts
 * @param {number} opts.gamma - 2着の温度パラメータ
 * @param {number} opts.delta - 3着の温度パラメータ
 * @param {number} [opts.topTrifecta=5] - 3連単の返却件数
 * @param {number} [opts.topExacta=3]   - 2連単の返却件数
 * @param {number} [opts.topTrio=3]     - 3連複の返却件数
 * @returns {{ trifecta: Array, exacta: Array, trio: Array }}
 *   各要素は { boats: number[]（艇番1-6）, label: string, prob: number }
 */
export function rankPermutations(winProbs, opts) {
  const { gamma, delta, topTrifecta = 5, topExacta = 3, topTrio = 3 } = opts;
  const n = winProbs.length;
  const plOpts = { gamma, delta };

  const trifecta = [];
  const exacta = [];
  const trio = [];

  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (b === a) continue;
      exacta.push({
        boats: [a + 1, b + 1],
        label: comboLabel([a, b]),
        prob: exactaProb(winProbs, [a, b], plOpts),
      });
      for (let c = 0; c < n; c++) {
        if (c === a || c === b) continue;
        trifecta.push({
          boats: [a + 1, b + 1, c + 1],
          label: comboLabel([a, b, c]),
          prob: trifectaProb(winProbs, [a, b, c], plOpts),
        });
        // 3連複は組み合わせ（昇順の組のみ列挙して重複を避ける）
        if (a < b && b < c) {
          trio.push({
            boats: [a + 1, b + 1, c + 1],
            label: comboLabel([a, b, c]),
            prob: trioProb(winProbs, [a, b, c], plOpts),
          });
        }
      }
    }
  }

  const byProbDesc = (x, y) => y.prob - x.prob;
  return {
    trifecta: trifecta.sort(byProbDesc).slice(0, topTrifecta),
    exacta: exacta.sort(byProbDesc).slice(0, topExacta),
    trio: trio.sort(byProbDesc).slice(0, topTrio),
  };
}
