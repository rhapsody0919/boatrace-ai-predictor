/**
 * オッズ・モメンタム分析
 *
 * JRA全レース20年分の実証研究（arXiv:2509.14645）は「リターンは締切直前の
 * オッズ変化と相関し、最終オッズは情報を完全には織り込んでいない」ことを
 * 示した。本スクリプトはボートレースで同じ非効率が存在するかを検証する。
 *
 * 方法:
 *   race_odds の複数スナップショット（60/30/15/10/5分前）から
 *   momentum_i = ln(最終オッズ_i / 初期オッズ_i) を計算し、
 *   1. モメンタム分位ごとの単勝ベット回収率（オッズ短縮艇 vs 伸長艇）
 *   2. 条件付きロジットで ln(implied確率) にモメンタムを追加した際の
 *      log-loss 改善（= 最終オッズを超える予測情報を持つか）
 *   を評価する。
 *
 * 使い方:
 *   node scripts/analysis/analyze-odds-momentum.js
 *   node scripts/analysis/analyze-odds-momentum.js --from=2026-03-01 --to=2026-06-30
 */

import { fetchAll, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  fitConditionalLogit,
  predictConditionalLogit,
} from "./train-conditional-logit.js";

const QUANTILES = 5;

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  return { from: get("from"), to: get("to") };
}

const clampP = (p) => Math.min(Math.max(p, 1e-6), 1 - 1e-6);

function impliedProbs(odds) {
  const inv = odds.map((o) => 1 / o);
  const sum = inv.reduce((s, x) => s + x, 0);
  return inv.map((x) => x / sum);
}

async function loadData({ from, to }) {
  const rangeFilter = (col) => (q) => {
    if (from) q = q.gte(col, from);
    if (to) q = q.lte(col, `${to}~`);
    return q;
  };

  console.log("データ取得中...");
  const [oddsRows, results] = await Promise.all([
    fetchAll(
      "race_odds",
      "race_id, captured_at, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
      (q) => rangeFilter("race_id")(q).order("race_id").order("captured_at"),
    ),
    fetchAll(
      "race_results",
      "race_id, rank1, payout_win, is_cancelled, is_no_race",
      (q) =>
        rangeFilter("race_id")(q.not("rank1", "is", null)).order("race_id"),
    ),
  ]);
  console.log(`  odds_snapshots=${oddsRows.length}, results=${results.length}`);

  const resultByRace = {};
  for (const r of results) {
    if (r.is_cancelled || r.is_no_race) continue;
    resultByRace[r.race_id] = r;
  }

  // race_id ごとに最初と最後のスナップショットを取る
  const byRace = {};
  for (const row of oddsRows) {
    const cur = (byRace[row.race_id] ??= { first: row, last: row, count: 1 });
    if (row.captured_at < cur.first.captured_at) cur.first = row;
    if (row.captured_at > cur.last.captured_at) cur.last = row;
    cur.count++;
  }

  const races = [];
  let skippedSnapshots = 0;
  let skippedOdds = 0;
  for (const [raceId, snap] of Object.entries(byRace)) {
    const result = resultByRace[raceId];
    if (!result) continue;
    // モメンタム計算には2時点以上（かつ十分な間隔）が必要
    if (snap.count < 2 || snap.first.captured_at === snap.last.captured_at) {
      skippedSnapshots++;
      continue;
    }
    const firstOdds = [1, 2, 3, 4, 5, 6].map(
      (b) => snap.first[`odds_win_${b}`] ?? null,
    );
    const lastOdds = [1, 2, 3, 4, 5, 6].map(
      (b) => snap.last[`odds_win_${b}`] ?? null,
    );
    if (firstOdds.some((o) => !(o > 1)) || lastOdds.some((o) => !(o > 1))) {
      skippedOdds++;
      continue;
    }
    races.push({
      raceId,
      firstOdds,
      lastOdds,
      momentum: lastOdds.map((o, i) => Math.log(o / firstOdds[i])),
      winner: result.rank1 - 1, // 0-indexed
      payoutWin: result.payout_win ?? 0,
    });
  }
  races.sort((a, b) => (a.raceId < b.raceId ? -1 : 1));
  console.log(
    `  対象レース=${races.length}（除外: スナップショット不足=${skippedSnapshots}, オッズ欠損=${skippedOdds}）`,
  );
  return races;
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("Supabase not configured.");
    process.exit(1);
  }
  const races = await loadData(parseArgs());
  if (races.length < 500) {
    console.error(`レース数が不足しています (${races.length})`);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // 1. モメンタム分位別の回収率
  //    momentum < 0 = オッズ短縮（買われている艇）、> 0 = 伸長（見放された艇）
  // -------------------------------------------------------------------------
  const allBets = [];
  for (const r of races) {
    for (let i = 0; i < 6; i++) {
      allBets.push({
        momentum: r.momentum[i],
        isWin: i === r.winner,
        payout: i === r.winner ? r.payoutWin : 0,
        lastOdds: r.lastOdds[i],
      });
    }
  }
  allBets.sort((a, b) => a.momentum - b.momentum);

  console.log("\n===== モメンタム分位別 単勝回収率（全艇に100円ベット）=====");
  console.log("quantile | momentum範囲        | bets   | hit%  | recovery");
  const qSize = Math.floor(allBets.length / QUANTILES);
  for (let q = 0; q < QUANTILES; q++) {
    const slice = allBets.slice(
      q * qSize,
      q === QUANTILES - 1 ? allBets.length : (q + 1) * qSize,
    );
    const invested = slice.length * 100;
    const returned = slice.reduce((s, b) => s + b.payout, 0);
    const hits = slice.filter((b) => b.isWin).length;
    const mMin = slice[0].momentum;
    const mMax = slice[slice.length - 1].momentum;
    console.log(
      `Q${q + 1}       | ${mMin.toFixed(3).padStart(7)} 〜 ${mMax.toFixed(3).padStart(7)} | ${String(slice.length).padStart(6)} | ${((hits / slice.length) * 100).toFixed(2)}% | ${((returned / invested) * 100).toFixed(1)}%`,
    );
  }
  console.log(
    "  ※ Q1=オッズ短縮（直前に買われた艇）… Q5=オッズ伸長（直前に見放された艇）",
  );

  // -------------------------------------------------------------------------
  // 2. 条件付きロジット: ln(q_final) 単独 vs ln(q_final) + momentum
  //    walk-forward（前半で学習・後半で評価）
  // -------------------------------------------------------------------------
  const splitIdx = Math.floor(races.length / 2);
  const trainRaces = races.slice(0, splitIdx);
  const testRaces = races.slice(splitIdx);

  const featsBase = (r) => {
    const q = impliedProbs(r.lastOdds);
    return r.lastOdds.map((_, i) => [Math.log(clampP(q[i]))]);
  };
  const featsMom = (r) => {
    const q = impliedProbs(r.lastOdds);
    return r.lastOdds.map((_, i) => [Math.log(clampP(q[i])), r.momentum[i]]);
  };

  const wBase = fitConditionalLogit(
    trainRaces.map(featsBase),
    trainRaces.map((r) => r.winner),
  );
  const wMom = fitConditionalLogit(
    trainRaces.map(featsMom),
    trainRaces.map((r) => r.winner),
  );

  let llBase = 0;
  let llMom = 0;
  for (const r of testRaces) {
    const pBase = predictConditionalLogit(featsBase(r), wBase);
    const pMom = predictConditionalLogit(featsMom(r), wMom);
    llBase += -Math.log(clampP(pBase[r.winner]));
    llMom += -Math.log(clampP(pMom[r.winner]));
  }
  llBase /= testRaces.length;
  llMom /= testRaces.length;
  const llUniform = Math.log(6);

  console.log("\n===== モメンタムの追加情報量（テスト後半 walk-forward）=====");
  console.log(
    `  train=${trainRaces.length}レース, test=${testRaces.length}レース`,
  );
  console.log(
    `  logloss: odds単独=${llBase.toFixed(4)}, odds+momentum=${llMom.toFixed(4)} (改善 ${llBase - llMom >= 0 ? "+" : ""}${(llBase - llMom).toFixed(4)})`,
  );
  console.log(
    `  McFadden R²: odds単独=${(1 - llBase / llUniform).toFixed(4)}, odds+momentum=${(1 - llMom / llUniform).toFixed(4)}`,
  );
  console.log(
    `  momentum係数=${wMom[1].toFixed(4)}（負 = オッズ短縮艇が implied 以上に勝つ）`,
  );
  const verdict =
    llBase - llMom > 0.001
      ? "→ モメンタムは最終オッズを超える予測情報を持つ（特徴量として採用価値あり）"
      : "→ 有意な追加情報は確認できず";
  console.log(`  ${verdict}`);
}

const isCli =
  process.argv[1] && process.argv[1].endsWith("analyze-odds-momentum.js");
if (isCli) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
