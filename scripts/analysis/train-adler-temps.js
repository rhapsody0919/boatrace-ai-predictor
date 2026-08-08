// アドラー予想: 位置別温度付き Plackett-Luce の温度パラメータ (gamma, delta) を
// 実レースデータで最尤推定する。
//
// モデル構造（補正Harville = 位置別温度付きPL、scripts/lib/harville.js と同一）:
//   P(2着=j | 1着=i)        = p_j^gamma / Σ_{k≠i} p_k^gamma
//   P(3着=k | 1着=i, 2着=j) = p_k^delta / Σ_{m≠i,j} p_m^delta
// 効用（単勝確率 p）はシャーロック本番モデル（data/sherlock/model.json）の
// 基礎モデル出力を使う。gamma は2着項のみ、delta は3着項のみに現れるため、
// 対数尤度は分離し、それぞれ1次元の黄金分割探索で独立に最大化できる。
//
// 使い方:
//   node scripts/analysis/train-adler-temps.js                  # フィット + 時系列検証
//   node scripts/analysis/train-adler-temps.js --fit-production # 上記 + data/adler/model.json 出力
//
// 検証は時系列分割（前85%でフィット→後15%で3連単loglossを比較）。
// 本番パラメータは全データでフィットし直した値を保存する。

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildFeatures,
  predictConditionalLogit,
} from "../../src/services/sherlockModel.js";
import {
  condSecond,
  condThird,
  trifectaProb,
  BENTER_GAMMA,
  BENTER_DELTA,
} from "../lib/harville.js";
import { loadDataset } from "./train-conditional-logit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMP_LO = 0.05;
const TEMP_HI = 2.0;
const SPLIT_RATIO = 0.85;

// ---------------------------------------------------------------------------
// フィット対象データの構築
// ---------------------------------------------------------------------------

/** 上位3着がすべて有効（1-6の相異なる艇番）なレースに勝率を付与して返す */
export function buildFitRaces(races, sherlockModel) {
  const fitRaces = [];
  for (const r of races) {
    const ranks = r.ranks;
    if (
      !ranks ||
      ranks.some((x) => !(x >= 1 && x <= 6)) ||
      new Set(ranks).size !== 3
    )
      continue;
    const feats = buildFeatures(r, sherlockModel.venue_in1_adv);
    const probs = predictConditionalLogit(feats, sherlockModel.weights);
    fitRaces.push({
      raceId: r.raceId,
      probs,
      // 0-indexed に変換
      i1: ranks[0] - 1,
      i2: ranks[1] - 1,
      i3: ranks[2] - 1,
    });
  }
  return fitRaces;
}

// ---------------------------------------------------------------------------
// 対数尤度と1次元最適化
// ---------------------------------------------------------------------------

function logLikSecond(fitRaces, gamma) {
  let ll = 0;
  for (const r of fitRaces) {
    ll += Math.log(condSecond(r.probs, r.i1, r.i2, gamma));
  }
  return ll;
}

function logLikThird(fitRaces, delta) {
  let ll = 0;
  for (const r of fitRaces) {
    ll += Math.log(condThird(r.probs, r.i1, r.i2, r.i3, delta));
  }
  return ll;
}

/** 黄金分割探索で f を [lo, hi] 上で最大化する */
export function goldenSectionMax(f, lo, hi, tol = 1e-4) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let x1 = b - phi * (b - a);
  let x2 = a + phi * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  while (b - a > tol) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + phi * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - phi * (b - a);
      f1 = f(x1);
    }
  }
  return (a + b) / 2;
}

function fitTemps(fitRaces) {
  const gamma = goldenSectionMax(
    (g) => logLikSecond(fitRaces, g),
    TEMP_LO,
    TEMP_HI,
  );
  const delta = goldenSectionMax(
    (d) => logLikThird(fitRaces, d),
    TEMP_LO,
    TEMP_HI,
  );
  return { gamma, delta };
}

// ---------------------------------------------------------------------------
// 評価
// ---------------------------------------------------------------------------

/** 実際の3連単 (i1,i2,i3) に対する平均負対数尤度（小さいほど良い） */
function trifectaLogLoss(fitRaces, gamma, delta) {
  let sum = 0;
  for (const r of fitRaces) {
    sum -= Math.log(
      trifectaProb(r.probs, [r.i1, r.i2, r.i3], { gamma, delta }),
    );
  }
  return sum / fitRaces.length;
}

/** 最尤の3連単1点の的中率 */
function top1TrifectaHitRate(fitRaces, gamma, delta) {
  let hits = 0;
  for (const r of fitRaces) {
    let best = -1;
    let bestCombo = null;
    for (let a = 0; a < 6; a++)
      for (let b = 0; b < 6; b++)
        for (let c = 0; c < 6; c++) {
          if (a === b || b === c || a === c) continue;
          const p = trifectaProb(r.probs, [a, b, c], { gamma, delta });
          if (p > best) {
            best = p;
            bestCombo = [a, b, c];
          }
        }
    if (bestCombo[0] === r.i1 && bestCombo[1] === r.i2 && bestCombo[2] === r.i3)
      hits++;
  }
  return hits / fitRaces.length;
}

/**
 * 妥当性の機械的チェック: 2着艇の「レース内勝率順位」分布を予測と実測で比較。
 * フィットした gamma のもとで P(2着=順位r) の予測合計と実際の件数が
 * 大きく乖離していないかを確認する（.claude/rules/analysis.md データ精度検証）。
 */
function secondPlaceRankCheck(fitRaces, gamma) {
  const predicted = [0, 0, 0, 0, 0, 0];
  const actual = [0, 0, 0, 0, 0, 0];
  for (const r of fitRaces) {
    // 勝率降順の順位（0=最有力）。勝者は2着候補から除外される
    const order = r.probs
      .map((p, i) => [p, i])
      .sort((x, y) => y[0] - x[0])
      .map(([, i]) => i);
    const rankOf = {};
    order.forEach((boatIdx, rank) => {
      rankOf[boatIdx] = rank;
    });
    for (let j = 0; j < 6; j++) {
      if (j === r.i1) continue;
      predicted[rankOf[j]] += condSecond(r.probs, r.i1, j, gamma);
    }
    actual[rankOf[r.i2]]++;
  }
  return { predicted, actual };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const fitProduction = process.argv.includes("--fit-production");

  const modelPath = path.join(__dirname, "../../data/sherlock/model.json");
  const sherlockModel = JSON.parse(await fs.readFile(modelPath, "utf-8"));
  console.log(
    `シャーロック本番モデルを使用 (trained_at=${sherlockModel.trained_at})`,
  );

  const races = await loadDataset({ from: null, to: null });
  const fitRaces = buildFitRaces(races, sherlockModel);
  console.log(`温度フィット対象レース: ${fitRaces.length}（上位3着そろい）`);
  if (fitRaces.length < 1000) {
    throw new Error("フィット対象レースが少なすぎます（<1000）");
  }

  // --- 時系列分割検証 ---
  const splitAt = Math.floor(fitRaces.length * SPLIT_RATIO);
  const trainRaces = fitRaces.slice(0, splitAt);
  const testRaces = fitRaces.slice(splitAt);
  const fitted = fitTemps(trainRaces);
  console.log(
    `\n[時系列検証] train=${trainRaces.length} (〜${trainRaces[trainRaces.length - 1].raceId.slice(0, 10)}), test=${testRaces.length} (${testRaces[0].raceId.slice(0, 10)}〜)`,
  );
  console.log(
    `  フィット値: gamma=${fitted.gamma.toFixed(4)}, delta=${fitted.delta.toFixed(4)}`,
  );

  const evalSets = [
    { name: "素のHarville (γ=δ=1)", gamma: 1, delta: 1 },
    {
      name: `Benter既定値 (γ=${BENTER_GAMMA}, δ=${BENTER_DELTA})`,
      gamma: BENTER_GAMMA,
      delta: BENTER_DELTA,
    },
    { name: "フィット値", ...fitted },
  ];
  const evalResults = {};
  for (const s of evalSets) {
    const logloss = trifectaLogLoss(testRaces, s.gamma, s.delta);
    console.log(`  3連単logloss (test): ${s.name} = ${logloss.toFixed(4)}`);
    evalResults[s.name] = logloss;
  }
  const top1 = top1TrifectaHitRate(testRaces, fitted.gamma, fitted.delta);
  console.log(`  最尤3連単1点の的中率 (test): ${(top1 * 100).toFixed(2)}%`);

  // --- データ精度検証: 2着艇の勝率順位分布（予測 vs 実測） ---
  const check = secondPlaceRankCheck(testRaces, fitted.gamma);
  console.log("\n[妥当性チェック] 2着艇の勝率順位分布 (test, 順位1〜6):");
  console.log(
    `  予測: ${check.predicted.map((x) => Math.round(x)).join(", ")}`,
  );
  console.log(`  実測: ${check.actual.join(", ")}`);

  // --- 本番パラメータ: 全データでフィット ---
  const production = fitTemps(fitRaces);
  console.log(
    `\n[本番フィット] 全${fitRaces.length}レース: gamma=${production.gamma.toFixed(4)}, delta=${production.delta.toFixed(4)}`,
  );

  if (fitProduction) {
    const model = {
      model_id: "adler",
      version: 1,
      trained_at: new Date().toISOString(),
      base_model: "sherlock",
      base_model_trained_at: sherlockModel.trained_at,
      gamma: production.gamma,
      delta: production.delta,
      n_races: fitRaces.length,
      fit_from: fitRaces[0].raceId.slice(0, 10),
      fit_to: fitRaces[fitRaces.length - 1].raceId.slice(0, 10),
      eval: {
        n_test: testRaces.length,
        trifecta_logloss_plain: evalResults["素のHarville (γ=δ=1)"],
        trifecta_logloss_benter:
          evalResults[
            `Benter既定値 (γ=${BENTER_GAMMA}, δ=${BENTER_DELTA})`
          ],
        trifecta_logloss_fitted: evalResults["フィット値"],
        top1_trifecta_hit_rate: top1,
      },
    };
    const outDir = path.join(__dirname, "../../data/adler");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, "model.json");
    await fs.writeFile(outPath, JSON.stringify(model, null, 2), "utf-8");
    console.log(`本番モデルを保存: ${outPath}`);
  }
}

const isCli =
  typeof process !== "undefined" &&
  process.argv?.[1] &&
  process.argv[1].endsWith("train-adler-temps.js");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
