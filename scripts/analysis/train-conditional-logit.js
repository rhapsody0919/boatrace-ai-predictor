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
import {
  FEATURE_NAMES,
  predictConditionalLogit,
  impliedProbs,
} from "../../src/services/sherlockModel.js";
import {
  ODDS_HAIRCUT,
  EV_THRESHOLDS,
  fitFundModel,
  fitCombinerOOF,
  evaluate,
  predictTestMonth,
  simulateRoi,
} from "./trainConditionalLogitFit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 4表を取得（race_id の範囲で絞る）
async function fetchRaceTables({ from, to }) {
  const rangeFilter = (col) => (q) => {
    if (from) q = q.gte(col, from);
    if (to) q = q.lte(col, `${to}~`); // race_id は日付プレフィックスで辞書順
    return q;
  };

  return Promise.all([
    fetchAll(
      "race_entries",
      "race_id, boat_number, grade, win_rate, local_win_rate, motor_2rate, boat_2rate",
      (q) => rangeFilter("race_id")(q).order("race_id").order("boat_number"),
    ),
    fetchAll(
      "exhibition_data",
      "race_id, boat_number, exhibition_time, start_timing",
      (q) => rangeFilter("race_id")(q).order("race_id").order("boat_number"),
    ),
    fetchAll(
      "race_results",
      "race_id, rank1, rank2, rank3, payout_win, is_cancelled, is_no_race",
      (q) => {
        q = q.not("rank1", "is", null);
        return rangeFilter("race_id")(q).order("race_id");
      },
    ),
    fetchAll(
      "race_odds",
      "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      (q) => rangeFilter("race_id")(q).order("race_id").order("captured_at"),
    ),
  ]);
}

// 4表を race_id で引ける形に整える
function indexRaceTables({ entries, exhibitions, results, oddsRows }) {
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
  return { latestOdds, exhibitionByRace, resultByRace, entriesByRace };
}

// 最終オッズ行 → 6艇の単勝オッズ（欠損・1以下を含めば null）
function oddsOfRow(oddsRow) {
  let odds = oddsRow
    ? [1, 2, 3, 4, 5, 6].map((b) => oddsRow[`odds_win_${b}`] ?? null)
    : null;
  if (odds && odds.some((o) => !(o > 1))) odds = null;
  return odds;
}

// レース単位に組み立て（6艇そろい・結果ありが必須）
// オッズ欠損レースは基礎モデルの学習には使い（hasOdds=false）、
// オッズ結合・評価・回収率シミュレーションからは除外する。
function assembleRaces(index) {
  const { latestOdds, exhibitionByRace, resultByRace, entriesByRace } = index;
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
    const odds = oddsOfRow(latestOdds[raceId]);
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
  return { races, noEntries, noResult, noOdds };
}

export async function loadDataset({ from, to }) {
  console.log("データ取得中...");
  const [entries, exhibitions, results, oddsRows] = await fetchRaceTables({
    from,
    to,
  });
  console.log(
    `  entries=${entries.length}, exhibitions=${exhibitions.length}, results=${results.length}, odds_snapshots=${oddsRows.length}`,
  );

  const { races, noEntries, noResult, noOdds } = assembleRaces(
    indexRaceTables({ entries, exhibitions, results, oddsRows }),
  );

  races.sort((a, b) => (a.raceId < b.raceId ? -1 : 1));
  console.log(
    `  対象レース=${races.length}（うちオッズあり=${races.length - noOdds}。除外: 6艇未満=${noEntries}, 結果なし=${noResult}）`,
  );
  return races;
}

// ---------------------------------------------------------------------------
// メイン: walk-forward 評価
// ---------------------------------------------------------------------------

// 前計算（勝者の位置・implied 確率）をして、月別の束ねを返す
function prepareRaces(races) {
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
  return { valid, byMonth, byMonthOdds };
}

// walk-forward: 学習 = 月[0..m-1]（全先行月）、テスト = 月[m]（オッズあり）
// 結合係数はOOF方式（学習月内 leave-one-month-out）
function walkForward(months, byMonth, byMonthOdds) {
  const foldResults = [];
  const roi = {};
  for (const th of EV_THRESHOLDS)
    roi[th] = { bets: 0, hits: 0, invested: 0, returned: 0 };
  let lastWeights = null;
  let lastCombiner = null;

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
    const { fundProbs, oddsProbs, combProbs } = predictTestMonth(
      testRaces,
      venueAdv,
      weights,
      combW,
    );
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

    // 4. 回収率シミュレーション
    simulateRoi(roi, testRaces, combProbs);
  }
  return { foldResults, roi, lastWeights, lastCombiner };
}

// ---------------------------------------------------------------------------
// レポート出力
// ---------------------------------------------------------------------------

function printFoldTable(foldResults) {
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
}

// フォールド結果のレース数加重平均
function aggOf(foldResults, key, metric) {
  const tot = foldResults.reduce((s, f) => s + f[key][metric] * f[key].n, 0);
  const n = foldResults.reduce((s, f) => s + f[key].n, 0);
  return tot / n;
}

// 集計を出力し、ΔR²（combined − odds）を返す
function printAggregate(foldResults) {
  const agg = (key, metric) => aggOf(foldResults, key, metric);
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
  return totalDeltaR2;
}

function printRoiTable(roi) {
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
}

function printLastWeights(lastWeights, lastCombiner) {
  if (!lastWeights) return;
  console.log("\n===== 基礎モデル係数（最終フォールド）=====");
  FEATURE_NAMES.forEach((name, j) =>
    console.log(`  ${name.padEnd(16)}: ${lastWeights[j].toFixed(4)}`),
  );
  if (lastCombiner)
    console.log(
      `  結合係数: α(fund)=${lastCombiner[0].toFixed(3)}, β(odds)=${lastCombiner[1].toFixed(3)}`,
    );
}

// 本番モデルの walk_forward_eval に載せる集計
function summarizeFolds(foldResults, totalDeltaR2) {
  const metricsOf = (key) => ({
    logLoss: aggOf(foldResults, key, "logLoss"),
    accuracy: aggOf(foldResults, key, "accuracy"),
    mcFaddenR2: aggOf(foldResults, key, "mcFaddenR2"),
  });
  return {
    fund: metricsOf("fund"),
    odds: metricsOf("odds"),
    combined: metricsOf("combined"),
    deltaR2: totalDeltaR2,
    nTest: foldResults.reduce((s, f) => s + f.nTest, 0),
  };
}

// --save: 評価結果を data/analysis/model-experiments/ へ書く
async function saveEvaluation(args, wf) {
  const outDir = path.join(__dirname, "../../data/analysis/model-experiments");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, "conditional-logit-eval.json");
  await fs.writeFile(
    outPath,
    JSON.stringify(
      {
        evaluated_at: new Date().toISOString(),
        range: { from: args.from, to: args.to },
        folds: wf.foldResults,
        roi: wf.roi,
        feature_names: FEATURE_NAMES,
        last_weights: wf.lastWeights,
        last_combiner: wf.lastCombiner,
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
async function fitProductionModel(prep, months, aggSummary) {
  const { valid, byMonth, byMonthOdds } = prep;
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

  const prep = prepareRaces(races);
  const wf = walkForward(months, prep.byMonth, prep.byMonthOdds);

  printFoldTable(wf.foldResults);
  const totalDeltaR2 = printAggregate(wf.foldResults);
  printRoiTable(wf.roi);
  printLastWeights(wf.lastWeights, wf.lastCombiner);
  const aggSummary = summarizeFolds(wf.foldResults, totalDeltaR2);

  if (args.save) await saveEvaluation(args, wf);
  if (args.fitProduction) await fitProductionModel(prep, months, aggSummary);
}

const isCli =
  process.argv[1] && process.argv[1].endsWith("train-conditional-logit.js");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export {
  estimateVenueIn1Adv,
  fitConditionalLogit,
} from "./trainConditionalLogitFit.js";
