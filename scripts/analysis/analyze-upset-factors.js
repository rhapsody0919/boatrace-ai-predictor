/**
 * 1コース飛び予測の複合因子分析
 *
 * 分析する指標:
 * A. 1号艇の全国勝率
 * B. 会場別1コース勝率（ベース特性）
 * C. 1号艇のモーター2連率（相対値）
 * D. 選手間の勝率標準偏差（接戦度）
 * E. 1号艇の今節avgST（今節のスタート傾向）
 * F. 展開予測の逃げ確率（AI予測信頼度）
 * G. 複合スコア（A〜Fの重み付き合成）
 *
 * 目的: 既存の荒れ度スコアより精度の高い「1コース飛び確率」指標を設計するための素材
 */

import { supabase } from "../lib/supabaseClient.js";
import {
  VENUE_1COURSE_WIN_RATE,
  pct,
  analyzeComposite,
} from "./analyzeUpsetFactorsComposite.js";

const DAYS = 90;

const VENUE_AVG = 0.53;

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function pad(s, n) {
  return String(s).padStart(n);
}

async function fetchAll(table, query) {
  const PAGE = 1000;
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

function sinceDateString() {
  const since = new Date();
  since.setDate(since.getDate() - DAYS);
  return since.toISOString().split("T")[0];
}

async function fetchRaces(sinceStr) {
  return fetchAll("races", (from, to) =>
    supabase
      .from("races")
      .select(
        "race_id, venue_code, volatility_score, volatility_level, first_boat_win_rate, first_boat_motor_2rate, win_rate_stddev, motor_2rate_stddev",
      )
      .not("first_boat_win_rate", "is", null)
      .gte("race_date", sinceStr)
      .range(from, to),
  );
}

async function fetchResults(sinceStr) {
  return fetchAll("race_results", (from, to) =>
    supabase
      .from("race_results")
      .select(
        "race_id, rank1, payout_win, winning_technique, is_cancelled, is_no_race",
      )
      .gte("race_id", sinceStr)
      .eq("is_cancelled", false)
      .eq("is_no_race", false)
      .range(from, to),
  );
}

// predictions (standard model) — avgST と nige確率を取得
async function fetchPreds(sinceStr) {
  return fetchAll("predictions", (from, to) =>
    supabase
      .from("predictions")
      .select("race_id, feature_contributions")
      .eq("model_id", "standard")
      .not("feature_contributions", "is", null)
      .gte("race_id", sinceStr)
      .range(from, to),
  );
}

// JOIN & 特徴量抽出
function buildRows(races, resultMap, predMap) {
  const rows = [];
  for (const race of races) {
    const res = resultMap.get(race.race_id);
    if (!res || !res.winning_technique) continue;

    const pred = predMap.get(race.race_id);
    const fc = pred?.feature_contributions;
    const boat1Stats = fc?.racerStats?.find(
      (s) => s.course === 1 || s.boatNumber === 1,
    );
    const nigeProbFromAI = fc?.turnPrediction?.distribution?.nige ?? null;

    const venueKey = String(race.venue_code).padStart(2, "0");
    const venue1CourseRate = VENUE_1COURSE_WIN_RATE[venueKey] ?? VENUE_AVG;

    rows.push({
      race_id: race.race_id,
      venue_code: race.venue_code,
      // 説明変数
      venue1Rate: venue1CourseRate,
      boat1WinRate: race.first_boat_win_rate,
      boat1MotorRate: race.first_boat_motor_2rate,
      winRateStddev: race.win_rate_stddev,
      motorStddev: race.motor_2rate_stddev,
      boat1AvgST: boat1Stats?.avgST ?? null,
      nigeProbAI: nigeProbFromAI,
      volatilityScore: race.volatility_score,
      // 目的変数
      isUpset: res.winning_technique !== "逃げ",
      payout: res.payout_win,
      technique: res.winning_technique,
    });
  }
  return rows;
}

// ---- 個別因子分析（四分位） ----
function analyzeQuartile(label, getter, rows, baseline) {
  const valid = rows.filter((r) => getter(r) != null);
  if (valid.length < 50) {
    console.log(`  ${label}: データ不足`);
    return null;
  }
  const sorted = [...valid].sort((a, b) => getter(a) - getter(b));
  const q = Math.floor(sorted.length / 4);
  const quartiles = [
    sorted.slice(0, q),
    sorted.slice(q, q * 2),
    sorted.slice(q * 2, q * 3),
    sorted.slice(q * 3),
  ];
  const rates = quartiles.map(
    (g) => g.filter((r) => r.isUpset).length / g.length,
  );
  const range_ = (g) => {
    const v = getter;
    return `${v(g[0]).toFixed(2)}〜${v(g[g.length - 1]).toFixed(2)}`;
  };
  const spread = Math.max(...rates) - Math.min(...rates);
  const label2 = spread > 0.15 ? "🟢 強" : spread > 0.08 ? "🟡 中" : "🔴 弱";
  console.log(
    `  ${label2} ${label} (有効n=${valid.length}, 予測力: ${(spread * 100).toFixed(1)}pt差)`,
  );
  for (let i = 0; i < 4; i++) {
    const diff = rates[i] - baseline;
    const bar = "█".repeat(Math.round(rates[i] * 20));
    console.log(
      `    Q${i + 1} (${range_(quartiles[i])}, n=${quartiles[i].length}): ${pct(rates[i])} (${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(1)}pt) ${bar}`,
    );
  }
  console.log();
  return { spread, rates, quartiles, getter };
}

function analyzeIndividualFactors(rows, baseline) {
  console.log("=".repeat(65));
  console.log("【1】個別因子の予測力（四分位別 1コース飛び率）");
  console.log("=".repeat(65));

  const factorResults = {};

  console.log("\n■ A. 1号艇の全国勝率（低い→高い）");
  factorResults.boat1WinRate = analyzeQuartile(
    "1号艇 全国勝率",
    (r) => r.boat1WinRate,
    rows,
    baseline,
  );

  console.log("\n■ B. 会場の1コース勝率ベース（荒れやすい→安定）");
  factorResults.venue1Rate = analyzeQuartile(
    "会場1コース勝率",
    (r) => r.venue1Rate,
    rows,
    baseline,
  );

  console.log("\n■ C. 1号艇のモーター2連率（低い→高い）");
  factorResults.boat1MotorRate = analyzeQuartile(
    "1号艇 モーター2連率",
    (r) => r.boat1MotorRate,
    rows,
    baseline,
  );

  console.log("\n■ D. 選手間の勝率標準偏差（接戦→実力差大）");
  factorResults.winRateStddev = analyzeQuartile(
    "選手間 勝率σ",
    (r) => r.winRateStddev,
    rows,
    baseline,
  );

  console.log("\n■ E. モーター間の2連率標準偏差（均等→バラつき大）");
  factorResults.motorStddev = analyzeQuartile(
    "モーター間 2連率σ",
    (r) => r.motorStddev,
    rows,
    baseline,
  );

  console.log("\n■ F. 1号艇の今節avgST（速い→遅い）");
  factorResults.boat1AvgST = analyzeQuartile(
    "1号艇 今節avgST",
    (r) => r.boat1AvgST,
    rows,
    baseline,
  );

  console.log("\n■ G. AIの展開予測逃げ確率（低い→高い）");
  factorResults.nigeProbAI = analyzeQuartile(
    "AI逃げ確率",
    (r) => r.nigeProbAI,
    rows,
    baseline,
  );

  console.log("\n■ H. 現在の荒れ度スコア（低い→高い）");
  factorResults.volatilityScore = analyzeQuartile(
    "荒れ度スコア",
    (r) => r.volatilityScore,
    rows.filter((r) => r.volatilityScore != null),
    baseline,
  );

  return factorResults;
}

// ---- 会場別ブレークダウン ----
function printVenueBreakdown(rows) {
  console.log("\n=".repeat(65));
  console.log("【3】会場別 1コース飛び率（荒れやすい会場の実測）");
  console.log("=".repeat(65));

  const byVenue = {};
  for (const r of rows) {
    const v = r.venue_code;
    if (!byVenue[v]) byVenue[v] = [];
    byVenue[v].push(r);
  }

  const venueStats = Object.entries(byVenue)
    .filter(([, g]) => g.length >= 20)
    .map(([v, g]) => {
      const flyRate = g.filter((r) => r.isUpset).length / g.length;
      const theoretical =
        1 - (VENUE_1COURSE_WIN_RATE[String(v).padStart(2, "0")] || VENUE_AVG);
      const diff = flyRate - theoretical;
      return { venue: +v, n: g.length, flyRate, theoretical, diff };
    })
    .sort((a, b) => b.flyRate - a.flyRate);

  console.log(
    `\n  ${"会場".padEnd(4)} ${"n".padStart(5)} ${"実測飛び率".padStart(9)} ${"理論値".padStart(7)} ${"差".padStart(6)}`,
  );
  for (const s of venueStats) {
    const name = VENUE_NAMES[s.venue] || String(s.venue);
    const bar = s.diff > 0 ? "▲" : "▽";
    console.log(
      `  ${name.padEnd(4)} ${pad(s.n, 5)} ${pct(s.flyRate).padStart(9)} ${pct(s.theoretical).padStart(7)} ${(s.diff >= 0 ? "+" : "") + (s.diff * 100).toFixed(1)}pt ${bar}`,
    );
  }
}

// ---- サマリーと設計提言 ----
function printSummary(factorResults, quintiles, baseline) {
  console.log("\n=".repeat(65));
  console.log("【まとめ】各因子の予測力ランキング");
  console.log("=".repeat(65));

  const spreadOf = (key) => factorResults[key]?.spread ?? 0;

  const factorSummary = [
    {
      name: "A. 1号艇の全国勝率",
      key: "boat1WinRate",
      note: "最強。DBに保存済み",
    },
    { name: "B. AI逃げ確率", key: "nigeProbAI", note: "predictionsから取得" },
    { name: "C. 選手間勝率σ", key: "winRateStddev", note: "DBに保存済み" },
    {
      name: "D. 1号艇avgST",
      key: "boat1AvgST",
      note: "feature_contributionsから取得",
    },
    {
      name: "E. 会場1コース勝率",
      key: "venue1Rate",
      note: "定数。venueParameters.js",
    },
    { name: "F. モーター間σ", key: "motorStddev", note: "DBに保存済み" },
    { name: "G. 1号艇モーター", key: "boat1MotorRate", note: "DBに保存済み" },
    {
      name: "H. 現荒れ度スコア（参考）",
      key: "volatilityScore",
      note: "現行指標",
    },
  ].sort((a, b) => spreadOf(b.key) - spreadOf(a.key));

  for (const f of factorSummary) {
    const sp = spreadOf(f.key);
    const strength = sp > 0.15 ? "🟢 強" : sp > 0.08 ? "🟡 中" : "🔴 弱";
    console.log(
      `  ${strength} ${f.name.padEnd(22)} spread=${(sp * 100).toFixed(1)}pt  [${f.note}]`,
    );
  }

  // 複合スコアのspread
  const compUpsets = quintiles.map(
    (g) => g.filter((r) => r.isUpset).length / g.length,
  );
  const compSpread = Math.max(...compUpsets) - Math.min(...compUpsets);
  console.log(
    `\n  🔵 複合スコア（全因子合成）                spread=${(compSpread * 100).toFixed(1)}pt`,
  );
  console.log(`  （ベースライン: ${pct(baseline)}）`);
}

async function main() {
  const sinceStr = sinceDateString();

  console.log("🔍 1コース飛び予測 — 複合因子分析\n");
  console.log(`📅 期間: 過去${DAYS}日 (${sinceStr} 〜)\n`);

  const races = await fetchRaces(sinceStr);
  const results = await fetchResults(sinceStr);
  const preds = await fetchPreds(sinceStr);

  console.log(
    `races: ${races.length.toLocaleString()} / results: ${results.length.toLocaleString()} / preds: ${preds.length.toLocaleString()}`,
  );

  // マップ化
  const resultMap = new Map(results.map((r) => [r.race_id, r]));
  const predMap = new Map(preds.map((p) => [p.race_id, p]));

  const rows = buildRows(races, resultMap, predMap);

  console.log(`結合済み: ${rows.length.toLocaleString()} 件\n`);

  const baseline = rows.filter((r) => r.isUpset).length / rows.length;
  console.log(`ベースライン（1コース飛び率）: ${pct(baseline)}\n`);

  const factorResults = analyzeIndividualFactors(rows, baseline);
  const quintiles = analyzeComposite(rows, factorResults, baseline);
  printVenueBreakdown(rows);
  printSummary(factorResults, quintiles, baseline);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
