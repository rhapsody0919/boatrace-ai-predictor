import { solveLinear } from "../lib/parametric-calibration.js";
import {
  buildFeatures,
  predictConditionalLogit,
  clampP,
  softmax,
} from "../../src/services/sherlockModel.js";

const ODDS_HAIRCUT = 0.95; // 単勝オッズの締切変動ヘアカット
const EV_THRESHOLDS = [1.0, 1.1, 1.2, 1.3];
const RIDGE = 1e-4;
const MAX_ITER = 50;
const TOL = 1e-8;
const VENUE_ADV_SHRINK = 200; // 会場別1コース優位のtarget encodingの縮小定数

// ---------------------------------------------------------------------------
// 会場別1コース優位（target encoding, 学習データのみから推定）
// ---------------------------------------------------------------------------

/**
 * venueCode → (会場の1コース勝率 − 全体の1コース勝率) を縮小推定で返す。
 * サンプルが少ない会場は0に向かって縮小される（過学習防止）。
 */
export function estimateVenueIn1Adv(races) {
  let globalWins = 0;
  const byVenue = {};
  for (const r of races) {
    const v = (byVenue[r.venueCode] ??= { wins: 0, n: 0 });
    v.n++;
    if (r.winner === 1) {
      v.wins++;
      globalWins++;
    }
  }
  const globalRate = globalWins / races.length;
  const adv = {};
  for (const [venue, { wins, n }] of Object.entries(byVenue)) {
    const raw = wins / n - globalRate;
    adv[venue] = raw * (n / (n + VENUE_ADV_SHRINK)); // shrinkage
  }
  return adv;
}

// ---------------------------------------------------------------------------
// 条件付きロジット（Newton-Raphson MLE）
// ---------------------------------------------------------------------------

// 1レース分の勾配・ヘッセ行列（上三角）を grad・hess へ足し込む
function accumulateRace(grad, hess, feats, target, w) {
  const d = w.length;
  const probs = softmax(
    feats.map((f) => f.reduce((s, x, j) => s + x * w[j], 0)),
  );

  const mu = new Array(d).fill(0);
  for (let i = 0; i < feats.length; i++) {
    for (let j = 0; j < d; j++) mu[j] += probs[i] * feats[i][j];
  }
  for (let j = 0; j < d; j++) grad[j] += mu[j] - feats[target][j];

  for (let i = 0; i < feats.length; i++) {
    for (let j = 0; j < d; j++) {
      const pj = probs[i] * feats[i][j];
      for (let k = j; k < d; k++) hess[j][k] += pj * feats[i][k];
    }
  }
  for (let j = 0; j < d; j++) {
    for (let k = j; k < d; k++) hess[j][k] -= mu[j] * mu[k];
  }
}

/**
 * 条件付きロジットのMLE学習
 * @param {number[][][]} X - [レース][艇][特徴量]
 * @param {number[]} y - 勝者のインデックス（0-5）
 * @returns {number[]} 重みベクトル
 */
export function fitConditionalLogit(X, y) {
  const d = X[0][0].length;
  let w = new Array(d).fill(0);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const grad = new Array(d).fill(0);
    const hess = Array.from({ length: d }, () => new Array(d).fill(0));

    for (let r = 0; r < X.length; r++) {
      accumulateRace(grad, hess, X[r], y[r], w);
    }

    // 対称化 + ridge
    for (let j = 0; j < d; j++) {
      grad[j] += RIDGE * w[j];
      hess[j][j] += RIDGE;
      for (let k = 0; k < j; k++) hess[j][k] = hess[k][j];
    }

    const delta = solveLinear(hess, grad);
    if (!delta) break;
    let maxStep = 0;
    for (let j = 0; j < d; j++) {
      w[j] -= delta[j];
      maxStep = Math.max(maxStep, Math.abs(delta[j]));
    }
    if (maxStep < TOL) break;
  }
  return w;
}

// ---------------------------------------------------------------------------
// 学習ヘルパー
// ---------------------------------------------------------------------------

// 基礎モデル一式（会場encoding + 重み）を学習
function fitFundModel(trainRaces) {
  const venueAdv = estimateVenueIn1Adv(trainRaces);
  const X = trainRaces.map((r) => buildFeatures(r, venueAdv));
  const y = trainRaces.map((r) => r.winnerIdx);
  const weights = fitConditionalLogit(X, y);
  return { venueAdv, weights };
}

/**
 * OOF方式で結合係数 (α, β) を学習する。
 * 学習月の各月 t について「t を除いた学習データ」で基礎モデルを作り、
 * 月 t の out-of-fold 予測を得る。全OOF予測に対して α, β をMLE。
 * 基礎モデルの学習には全レース、OOF予測にはオッズありレースのみを使う。
 */
function fitCombinerOOF(byMonth, byMonthOdds, trainMonths) {
  const oofX = [];
  const oofY = [];
  for (const t of trainMonths) {
    const holdout = byMonthOdds[t] ?? [];
    const rest = trainMonths
      .filter((m) => m !== t)
      .flatMap((m) => byMonth[m] ?? []);
    if (holdout.length === 0 || rest.length < 500) continue;
    const { venueAdv, weights } = fitFundModel(rest);
    for (const r of holdout) {
      const f = predictConditionalLogit(buildFeatures(r, venueAdv), weights);
      oofX.push(
        r.entries.map((_, i) => [
          Math.log(clampP(f[i])),
          Math.log(clampP(r.implied[i])),
        ]),
      );
      oofY.push(r.winnerIdx);
    }
  }
  if (oofX.length < 300) return null;
  return fitConditionalLogit(oofX, oofY);
}

// ---------------------------------------------------------------------------
// 評価
// ---------------------------------------------------------------------------

function evaluate(probsList, winners) {
  let logLoss = 0;
  let hits = 0;
  for (let r = 0; r < probsList.length; r++) {
    logLoss += -Math.log(clampP(probsList[r][winners[r]]));
    const pick = probsList[r].indexOf(Math.max(...probsList[r]));
    if (pick === winners[r]) hits++;
  }
  const n = probsList.length;
  const llPerRace = logLoss / n;
  const llUniform = Math.log(6);
  return {
    n,
    logLoss: llPerRace,
    accuracy: hits / n,
    mcFaddenR2: 1 - llPerRace / llUniform,
  };
}

// 1フォールドのテスト月で3モデルの確率を作る
function predictTestMonth(testRaces, venueAdv, weights, combW) {
  const fundProbs = [];
  const oddsProbs = [];
  const combProbs = [];
  for (const r of testRaces) {
    const f = predictConditionalLogit(buildFeatures(r, venueAdv), weights);
    const q = r.implied;
    const x = r.entries.map((_, i) => [
      Math.log(clampP(f[i])),
      Math.log(clampP(q[i])),
    ]);
    fundProbs.push(f);
    oddsProbs.push(q);
    combProbs.push(predictConditionalLogit(x, combW));
  }
  return { fundProbs, oddsProbs, combProbs };
}

// 回収率シミュレーション（combined の確率 × スナップショットオッズ）
function simulateRoi(roi, testRaces, combProbs) {
  for (let t = 0; t < testRaces.length; t++) {
    const r = testRaces[t];
    const p = combProbs[t];
    let bestEv = 0;
    let bestBoat = -1;
    for (let i = 0; i < 6; i++) {
      const ev = p[i] * r.odds[i] * ODDS_HAIRCUT;
      if (ev > bestEv) {
        bestEv = ev;
        bestBoat = i;
      }
    }
    for (const th of EV_THRESHOLDS) {
      if (bestEv >= th && bestBoat >= 0) {
        roi[th].bets++;
        roi[th].invested += 100;
        if (bestBoat === r.winnerIdx) {
          roi[th].hits++;
          roi[th].returned += r.payoutWin; // 実際の最終払戻（100円あたり）
        }
      }
    }
  }
}

export {
  ODDS_HAIRCUT,
  EV_THRESHOLDS,
  fitFundModel,
  fitCombinerOOF,
  evaluate,
  predictTestMonth,
  simulateRoi,
};
