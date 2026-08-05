/**
 * 条件付きロジット + オッズ結合モデル（シャーロック予想）の学習・評価
 *
 * レースを「6艇からの離散選択問題」としてモデル化する:
 *   P(勝者=i) = exp(x_i・w) / Σ_j exp(x_j・w)
 *
 * 特徴量・推論ロジックは src/services/sherlockModel.js と共有しており、
 * フロントエンド（ホームズ予想 シャーロックタブ）と完全に同一の計算を行う。
 *
 * 3モデルを walk-forward（月単位）で比較評価する:
 *   1. fund     : 基礎特徴量（展示タイム・モーター・勝率・コース等）のみ
 *   2. odds     : 公衆オッズの implied 確率のみ
 *   3. combined : P ∝ exp(α・ln f_i + β・ln q_i)（Benter 1994 の二段階結合）
 *
 * 結合係数 (α, β) は out-of-fold 方式で学習する:
 *   学習期間の各月について「その月を除いて学習した基礎モデル」の予測を作り、
 *   全学習月のOOF予測に対して α, β を最尤推定する。
 *   （基礎モデルの in-sample 過信を α に混入させないため）
 *
 * 使い方:
 *   node scripts/analysis/train-conditional-logit.js
 *   node scripts/analysis/train-conditional-logit.js --from=2026-01-01 --to=2026-06-30
 *   node scripts/analysis/train-conditional-logit.js --save
 *   node scripts/analysis/train-conditional-logit.js --fit-production
 *     → 全期間で学習し data/sherlock/model.json を出力（フロントエンドが使用）
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { fetchAll, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { solveLinear } from "../lib/parametric-calibration.js";
import {
  FEATURE_NAMES,
  buildFeatures,
  predictConditionalLogit,
  impliedProbs,
  clampP,
  softmax,
} from "../../src/services/sherlockModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ODDS_HAIRCUT = 0.95; // 単勝オッズの締切変動ヘアカット
const EV_THRESHOLDS = [1.0, 1.1, 1.2, 1.3];
const RIDGE = 1e-4;
const MAX_ITER = 50;
const TOL = 1e-8;
const VENUE_ADV_SHRINK = 200; // 会場別1コース優位のtarget encodingの縮小定数

// momentum分析等の既存importのため再export
export { predictConditionalLogit, FEATURE_NAMES };

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return {
    from: get("from"),
    to: get("to"),
    save: argv.includes("--save"),
    fitProduction: argv.includes("--fit-production"),
  };
}

// ---------------------------------------------------------------------------
// データ取得・結合
// ---------------------------------------------------------------------------

export async function loadDataset({ from, to }) {
  const rangeFilter = (col) => (q) => {
    if (from) q = q.gte(col, from);
    if (to) q = q.lte(col, `${to}~`); // race_id は日付プレフィックスで辞書順
    return q;
  };

  console.log("データ取得中...");
  const [entries, exhibitions, results, oddsRows] = await Promise.all([
    fetchAll(
      "race_entries",
      "race_id, boat_number, grade, win_rate, local_win_rate, motor_2rate, boat_2rate",
      rangeFilter("race_id"),
    ),
    fetchAll(
      "exhibition_data",
      "race_id, boat_number, exhibition_time, start_timing",
      rangeFilter("race_id"),
    ),
    fetchAll(
      "race_results",
      "race_id, rank1, rank2, rank3, payout_win, is_cancelled, is_no_race",
      (q) => {
        q = q.not("rank1", "is", null);
        return rangeFilter("race_id")(q);
      },
    ),
    fetchAll(
      "race_odds",
      "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      rangeFilter("race_id"),
    ),
  ]);
  console.log(
    `  entries=${entries.length}, exhibitions=${exhibitions.length}, results=${results.length}, odds_snapshots=${oddsRows.length}`,
  );

  // 最終スナップショット（締切に最も近いオッズ）を race_id ごとに選ぶ
  const latestOdds = {};
  for (const row of oddsRows) {
    const cur = latestOdds[row.race_id];
    if (!cur || row.captured_at > cur.captured_at)
      latestOdds[row.race_id] = row;
  }

  const exhibitionByRace = {};
  for (const ex of exhibitions) {
    (exhibitionByRace[ex.race_id] ??= {})[ex.boat_number] = ex;
  }

  const resultByRace = {};
  for (const r of results) {
    if (r.is_cancelled || r.is_no_race) continue;
    resultByRace[r.race_id] = r;
  }

  const entriesByRace = {};
  for (const e of entries) {
    (entriesByRace[e.race_id] ??= []).push(e);
  }

  // レース単位に組み立て（6艇そろい・結果ありが必須）
  // オッズ欠損レースは基礎モデルの学習には使い（hasOdds=false）、
  // オッズ結合・評価・回収率シミュレーションからは除外する。
  const races = [];
  let noEntries = 0;
  let noResult = 0;
  let noOdds = 0;

  for (const [raceId, raceEntries] of Object.entries(entriesByRace)) {
    if (raceEntries.length !== 6) {
      noEntries++;
      continue;
    }
    const result = resultByRace[raceId];
    if (!result) {
      noResult++;
      continue;
    }
    const oddsRow = latestOdds[raceId];
    let odds = oddsRow
      ? [1, 2, 3, 4, 5, 6].map((b) => oddsRow[`odds_win_${b}`] ?? null)
      : null;
    if (odds && odds.some((o) => !(o > 1))) odds = null;
    if (!odds) noOdds++;

    // race_id 形式: YYYY-MM-DD-VV-RR
    const venueCode = parseInt(raceId.split("-")[3], 10);

    races.push({
      raceId,
      month: raceId.slice(0, 7),
      venueCode,
      entries: raceEntries.sort((a, b) => a.boat_number - b.boat_number),
      exhibition: exhibitionByRace[raceId] ?? {},
      winner: result.rank1, // 艇番 1-6
      ranks: [result.rank1, result.rank2, result.rank3], // 上位3着の艇番（アドラー温度フィット用）
      payoutWin: result.payout_win ?? 0, // 100円あたり払戻（勝者に対する）
      odds,
      hasOdds: !!odds,
    });
  }

  races.sort((a, b) => (a.raceId < b.raceId ? -1 : 1));
  console.log(
    `  対象レース=${races.length}（うちオッズあり=${races.length - noOdds}。除外: 6艇未満=${noEntries}, 結果なし=${noResult}）`,
  );
  return races;
}

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
      const feats = X[r];
      const probs = softmax(
        feats.map((f) => f.reduce((s, x, j) => s + x * w[j], 0)),
      );

      const mu = new Array(d).fill(0);
      for (let i = 0; i < feats.length; i++) {
        for (let j = 0; j < d; j++) mu[j] += probs[i] * feats[i][j];
      }
      for (let j = 0; j < d; j++) grad[j] += mu[j] - feats[y[r]][j];

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

// ---------------------------------------------------------------------------
// メイン: walk-forward 評価
// ---------------------------------------------------------------------------

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured.");
    process.exit(1);
  }
  const args = parseArgs();
  const races = await loadDataset(args);
  if (races.length < 1000) {
    console.error(`レース数が不足しています (${races.length})`);
    process.exit(1);
  }

  const months = [...new Set(races.map((r) => r.month))].sort();
  console.log(`\n対象月: ${months.join(", ")}`);

  // 前計算
  for (const race of races) {
    race.winnerIdx = race.entries.findIndex(
      (e) => e.boat_number === race.winner,
    );
    race.implied = race.hasOdds ? impliedProbs(race.odds) : null;
  }
  const valid = races.filter((r) => r.winnerIdx >= 0);
  const validOdds = valid.filter((r) => r.implied);
  console.log(
    `学習対象=${valid.length}レース（オッズあり=${validOdds.length}）`,
  );

  const byMonth = {}; // 基礎モデル学習用（全レース）
  const byMonthOdds = {}; // 結合・評価用（オッズありのみ）
  for (const r of valid) (byMonth[r.month] ??= []).push(r);
  for (const r of validOdds) (byMonthOdds[r.month] ??= []).push(r);

  const foldResults = [];
  const roi = {};
  for (const th of EV_THRESHOLDS)
    roi[th] = { bets: 0, hits: 0, invested: 0, returned: 0 };
  let lastWeights = null;
  let lastCombiner = null;

  // walk-forward: 学習 = 月[0..m-1]（全先行月）、テスト = 月[m]（オッズあり）
  // 結合係数はOOF方式（学習月内 leave-one-month-out）
  for (let m = 2; m < months.length; m++) {
    const trainMonths = months.slice(0, m);
    const trainRaces = trainMonths.flatMap((mo) => byMonth[mo] ?? []);
    const testRaces = byMonthOdds[months[m]] ?? [];
    if (trainRaces.length < 1000 || testRaces.length < 100) continue;

    // 1. 基礎モデル（全学習月・全レース）+ 2. OOF結合係数
    const { venueAdv, weights } = fitFundModel(trainRaces);
    const combW = fitCombinerOOF(byMonth, byMonthOdds, trainMonths);
    if (!combW) continue;
    lastWeights = weights;
    lastCombiner = combW;

    // 3. テスト月で3モデルを評価
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
    const winners = testRaces.map((r) => r.winnerIdx);

    const fund = evaluate(fundProbs, winners);
    const odds = evaluate(oddsProbs, winners);
    const comb = evaluate(combProbs, winners);

    foldResults.push({
      testMonth: months[m],
      nTrain: trainRaces.length,
      nTest: testRaces.length,
      alpha: combW[0],
      beta: combW[1],
      fund,
      odds,
      combined: comb,
      deltaR2: comb.mcFaddenR2 - odds.mcFaddenR2,
    });

    // 4. 回収率シミュレーション（combined の確率 × スナップショットオッズ）
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

  // ---------------------------------------------------------------------------
  // レポート出力
  // ---------------------------------------------------------------------------

  console.log("\n===== walk-forward 評価（月次フォールド）=====");
  console.log(
    "month      | n     | logloss fund/odds/comb | acc fund/odds/comb | R² fund/odds/comb | ΔR²    | α/β",
  );
  for (const f of foldResults) {
    console.log(
      `${f.testMonth}    | ${String(f.nTest).padStart(5)} | ` +
        `${f.fund.logLoss.toFixed(4)} / ${f.odds.logLoss.toFixed(4)} / ${f.combined.logLoss.toFixed(4)} | ` +
        `${(f.fund.accuracy * 100).toFixed(1)}% / ${(f.odds.accuracy * 100).toFixed(1)}% / ${(f.combined.accuracy * 100).toFixed(1)}% | ` +
        `${f.fund.mcFaddenR2.toFixed(4)} / ${f.odds.mcFaddenR2.toFixed(4)} / ${f.combined.mcFaddenR2.toFixed(4)} | ` +
        `${f.deltaR2 >= 0 ? "+" : ""}${f.deltaR2.toFixed(4)} | ` +
        `${f.alpha.toFixed(2)}/${f.beta.toFixed(2)}`,
    );
  }

  const agg = (key, metric) => {
    const tot = foldResults.reduce((s, f) => s + f[key][metric] * f[key].n, 0);
    const n = foldResults.reduce((s, f) => s + f[key].n, 0);
    return tot / n;
  };
  console.log("\n===== 集計（テスト全期間・レース数加重平均）=====");
  for (const key of ["fund", "odds", "combined"]) {
    console.log(
      `${key.padEnd(9)}: logloss=${agg(key, "logLoss").toFixed(4)}, acc=${(agg(key, "accuracy") * 100).toFixed(1)}%, R²=${agg(key, "mcFaddenR2").toFixed(4)}`,
    );
  }
  const totalDeltaR2 =
    agg("combined", "mcFaddenR2") - agg("odds", "mcFaddenR2");
  console.log(
    `ΔR² (combined − odds) = ${totalDeltaR2 >= 0 ? "+" : ""}${totalDeltaR2.toFixed(4)}  ${totalDeltaR2 > 0 ? "→ 市場への上乗せ情報あり" : "→ 市場に対する優位なし"}`,
  );

  console.log("\n===== EV閾値別 単勝回収率シミュレーション（combined）=====");
  console.log(
    "threshold | bets  | hits | hit%  | invested | returned | recovery",
  );
  for (const th of EV_THRESHOLDS) {
    const x = roi[th];
    const rec = x.invested > 0 ? x.returned / x.invested : 0;
    console.log(
      `EV>=${th.toFixed(1)}   | ${String(x.bets).padStart(5)} | ${String(x.hits).padStart(4)} | ${x.bets > 0 ? ((x.hits / x.bets) * 100).toFixed(1) : "0.0"}% | ${String(x.invested).padStart(8)} | ${String(x.returned).padStart(8)} | ${(rec * 100).toFixed(1)}%`,
    );
  }

  if (lastWeights) {
    console.log("\n===== 基礎モデル係数（最終フォールド）=====");
    FEATURE_NAMES.forEach((name, j) =>
      console.log(`  ${name.padEnd(16)}: ${lastWeights[j].toFixed(4)}`),
    );
    if (lastCombiner)
      console.log(
        `  結合係数: α(fund)=${lastCombiner[0].toFixed(3)}, β(odds)=${lastCombiner[1].toFixed(3)}`,
      );
  }

  const aggSummary = {
    fund: {
      logLoss: agg("fund", "logLoss"),
      accuracy: agg("fund", "accuracy"),
      mcFaddenR2: agg("fund", "mcFaddenR2"),
    },
    odds: {
      logLoss: agg("odds", "logLoss"),
      accuracy: agg("odds", "accuracy"),
      mcFaddenR2: agg("odds", "mcFaddenR2"),
    },
    combined: {
      logLoss: agg("combined", "logLoss"),
      accuracy: agg("combined", "accuracy"),
      mcFaddenR2: agg("combined", "mcFaddenR2"),
    },
    deltaR2: totalDeltaR2,
    nTest: foldResults.reduce((s, f) => s + f.nTest, 0),
  };

  if (args.save) {
    const outDir = path.join(
      __dirname,
      "../../data/analysis/model-experiments",
    );
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, "conditional-logit-eval.json");
    await fs.writeFile(
      outPath,
      JSON.stringify(
        {
          evaluated_at: new Date().toISOString(),
          range: { from: args.from, to: args.to },
          folds: foldResults,
          roi,
          feature_names: FEATURE_NAMES,
          last_weights: lastWeights,
          last_combiner: lastCombiner,
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`\n結果を保存: ${outPath}`);
  }

  // ---------------------------------------------------------------------------
  // 本番モデルの出力（全期間で学習、フロントエンドが import する）
  // ---------------------------------------------------------------------------
  if (args.fitProduction) {
    console.log("\n===== 本番モデル学習（全期間）=====");
    const { venueAdv, weights } = fitFundModel(valid);
    const combW = fitCombinerOOF(byMonth, byMonthOdds, months);
    if (!combW) {
      console.error("OOFデータ不足で結合係数を学習できませんでした");
      process.exit(1);
    }
    console.log(
      `  基礎モデル: ${valid.length}レースで学習、結合係数 α=${combW[0].toFixed(3)}, β=${combW[1].toFixed(3)}`,
    );

    const model = {
      model_id: "sherlock",
      version: 1,
      trained_at: new Date().toISOString(),
      training_races: valid.length,
      training_from: valid[0].raceId.slice(0, 10),
      training_to: valid[valid.length - 1].raceId.slice(0, 10),
      feature_names: FEATURE_NAMES,
      weights,
      combiner: combW,
      venue_in1_adv: venueAdv,
      odds_haircut: ODDS_HAIRCUT,
      walk_forward_eval: aggSummary,
    };
    const outDir = path.join(__dirname, "../../data/sherlock");
    await fs.mkdir(outDir, { recursive: true });
    const outPath = path.join(outDir, "model.json");
    await fs.writeFile(outPath, JSON.stringify(model, null, 2), "utf-8");
    console.log(`  本番モデルを保存: ${outPath}`);
  }
}

const isCli =
  process.argv[1] && process.argv[1].endsWith("train-conditional-logit.js");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
