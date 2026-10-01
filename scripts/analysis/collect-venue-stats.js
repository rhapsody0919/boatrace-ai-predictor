/**
 * 24会場の詳細統計分析スクリプト
 *
 * 天才データサイエンティスト視点での統計指標：
 * - 基本統計（的中率、回収率）
 * - 信頼区間（95%CI）
 * - シャープレシオ（リスク調整後リターン）
 * - 最大ドローダウン
 * - 連勝/連敗記録
 * - 条件別分析（級別、モーター性能別）
 * - 統計的有意性検定
 * - 期待値分析
 */

import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ===== 統計ユーティリティ関数 =====

/**
 * 平均値
 */
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * 標準偏差
 */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const avg = mean(arr);
  const squareDiffs = arr.map((x) => Math.pow(x - avg, 2));
  return Math.sqrt(mean(squareDiffs));
}

/**
 * 95%信頼区間（正規近似）
 * @param {number} p - 確率（0-1）
 * @param {number} n - サンプルサイズ
 * @returns {object} { lower, upper }
 */
function confidenceInterval95(p, n) {
  if (n === 0) return { lower: 0, upper: 0 };
  const z = 1.96; // 95%信頼区間
  const se = Math.sqrt((p * (1 - p)) / n);
  return {
    lower: Math.max(0, p - z * se),
    upper: Math.min(1, p + z * se),
  };
}

/**
 * シャープレシオ（回収率ベース）
 * = (平均回収率 - 100%) / 回収率の標準偏差
 */
function sharpeRatio(returns) {
  if (returns.length < 2) return 0;
  const avgReturn = mean(returns);
  const std = stdDev(returns);
  if (std === 0) return 0;
  return (avgReturn - 100) / std;
}

/**
 * 最大ドローダウン
 * 累積回収率の最高点からの最大下落率
 */
function maxDrawdown(returns) {
  if (returns.length === 0) return 0;

  let cumulative = 0;
  let peak = 0;
  let maxDD = 0;

  for (const ret of returns) {
    cumulative += ret - 100; // 100%基準からの損益
    peak = Math.max(peak, cumulative);
    const dd = peak - cumulative;
    maxDD = Math.max(maxDD, dd);
  }

  return maxDD;
}

/**
 * 連勝/連敗記録
 */
function streakAnalysis(hits) {
  if (hits.length === 0) return { maxWin: 0, maxLose: 0, currentStreak: 0 };

  let maxWin = 0,
    maxLose = 0;
  let currentWin = 0,
    currentLose = 0;

  for (const hit of hits) {
    if (hit) {
      currentWin++;
      currentLose = 0;
      maxWin = Math.max(maxWin, currentWin);
    } else {
      currentLose++;
      currentWin = 0;
      maxLose = Math.max(maxLose, currentLose);
    }
  }

  return {
    maxWin,
    maxLose,
    currentStreak: currentWin > 0 ? currentWin : -currentLose,
  };
}

/**
 * 二項検定（p値計算）
 * 帰無仮説: 真の的中率 = 期待的中率
 */
function binomialPValue(successes, trials, expectedP) {
  if (trials === 0) return 1;
  const observedP = successes / trials;
  const se = Math.sqrt((expectedP * (1 - expectedP)) / trials);
  if (se === 0) return 1;
  const z = Math.abs(observedP - expectedP) / se;
  // 正規近似での両側p値
  return 2 * (1 - normalCDF(z));
}

/**
 * 標準正規分布の累積分布関数（近似）
 */
function normalCDF(z) {
  const a1 = 0.254829592,
    a2 = -0.284496736,
    a3 = 1.421413741;
  const a4 = -1.453152027,
    a5 = 1.061405429,
    p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.sqrt(2);
  const t = 1 / (1 + p * z);
  const y =
    1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

/**
 * 期待値計算
 * = Σ(確率 × 配当) - 投資額
 */
function expectedValue(hitRate, avgPayout, betAmount = 100) {
  return hitRate * avgPayout - betAmount;
}

/**
 * ケリー基準（最適ベット比率）
 * f* = (bp - q) / b
 * b = オッズ - 1, p = 勝率, q = 1 - p
 */
function kellyFraction(hitRate, avgOdds) {
  if (avgOdds <= 1 || hitRate <= 0) return 0;
  const b = avgOdds - 1;
  const p = hitRate;
  const q = 1 - p;
  const f = (b * p - q) / b;
  return Math.max(0, f); // 負の場合は0（ベットしない）
}

// ===== 組み合わせ条件キー生成 =====

/**
 * パラメータ値をカテゴリに変換
 */
function categorizeWinRate(winRate) {
  if (winRate >= 7.0) return "7.0↑";
  if (winRate >= 6.0) return "6.0-6.9";
  if (winRate >= 5.0) return "5.0-5.9";
  if (winRate >= 4.0) return "4.0-4.9";
  return "4.0↓";
}

function categorizeMotor(motor2rate) {
  if (motor2rate >= 45) return "45↑";
  if (motor2rate >= 40) return "40-44";
  if (motor2rate >= 35) return "35-39";
  if (motor2rate >= 30) return "30-34";
  return "30↓";
}

function categorizeConfidence(confidence) {
  if (confidence >= 75) return "75↑";
  if (confidence >= 60) return "60-74";
  if (confidence >= 45) return "45-59";
  return "45↓";
}

// ===== メイン分析関数 =====

async function collectVenueStats(venueCode) {
  const venueName = VENUE_NAMES[venueCode];
  const venueCodeStr = String(venueCode).padStart(2, "0");

  // 1. 予測データ取得（全モデル）
  const { data: predictions, error } = await supabase
    .from("predictions")
    .select("race_id, model_id, top_pick, top_2nd, top_3rd, confidence")
    .like("race_id", `%-${venueCodeStr}-%`);

  if (error) {
    console.error(
      `Error fetching predictions for venue ${venueCode}:`,
      error.message,
    );
    return null;
  }

  // 2. 結果データ取得
  const raceIds = [...new Set(predictions.map((p) => p.race_id))];

  const { data: results, error: resultsError } = await supabase
    .from("race_results")
    .select("*")
    .in("race_id", raceIds);

  if (resultsError) {
    console.error(
      `Error fetching results for venue ${venueCode}:`,
      resultsError.message,
    );
    return null;
  }

  // 3. race_entries（選手情報）取得
  const { data: entries, error: entriesError } = await supabase
    .from("race_entries")
    .select("race_id, boat_number, grade, win_rate, motor_2rate")
    .in("race_id", raceIds);

  if (entriesError) {
    console.error(
      `Error fetching entries for venue ${venueCode}:`,
      entriesError.message,
    );
    return null;
  }

  // マップ化
  const resultsMap = {};
  results?.forEach((r) => {
    resultsMap[r.race_id] = r;
  });

  const entriesMap = {};
  entries?.forEach((e) => {
    if (!entriesMap[e.race_id]) entriesMap[e.race_id] = {};
    entriesMap[e.race_id][e.boat_number] = e;
  });

  // standardモデルのみで分析
  const standardPreds = predictions.filter((p) => p.model_id === "standard");

  // ===== 統計計算 =====

  const stats = {
    venue_code: venueCode,
    venue_name: venueName,
    data_period: { start: null, end: null },
    sample_size: 0,

    // 基本統計
    basic: {
      first_boat_win_rate: 0,
      upset_rate: 0,
    },

    // ベット種別統計
    bet_types: {
      win: createBetTypeStats(),
      place: createBetTypeStats(),
      trio: createBetTypeStats(),
      trifecta: createBetTypeStats(),
    },

    // 条件別分析（単一条件）
    conditions: {
      by_first_boat_grade: {}, // 1号艇の級別
      by_first_boat_motor: {}, // 1号艇のモーター性能別
      by_confidence: {}, // AI信頼度別
    },

    // 組み合わせ分析（複合条件）
    combinations: {
      // 予測1着艇番 × 級別 × モーター
      by_pick_grade_motor: {},
      // 予測1着艇番 × 級別
      by_pick_grade: {},
      // 予測1着艇番 × 勝率帯
      by_pick_winrate: {},
      // 予測1着艇番 × 信頼度
      by_pick_confidence: {},
      // 予測1-2着の組み合わせ
      by_pick_1_2: {},
    },

    // 回収率100%超えの有望条件
    profitable_rules: [],

    // リスク指標
    risk: {
      sharpe_ratio: 0,
      max_drawdown: 0,
      volatility: 0,
    },

    // 連勝/連敗
    streaks: {
      win: { max_win: 0, max_lose: 0, current: 0 },
    },

    // 推奨度（総合評価）
    recommendation: {
      score: 0,
      grade: "",
      reasons: [],
    },
  };

  function createBetTypeStats() {
    return {
      total: 0,
      hits: 0,
      hit_rate: 0,
      hit_rate_ci95: { lower: 0, upper: 0 },
      payout_sum: 0,
      recovery_rate: 0,
      avg_payout: 0,
      expected_value: 0,
      kelly_fraction: 0,
      p_value: 0,
      is_significant: false,
    };
  }

  // データ収集
  let firstBoatWins = 0;
  const winHits = [],
    winPayouts = [],
    winReturns = [];
  const placeHits = [],
    placePayouts = [];
  const trioHits = [],
    trioPayouts = [];
  const trifectaHits = [],
    trifectaPayouts = [];

  // 条件別データ
  const byFirstBoatGrade = {};
  const byFirstBoatMotor = { high: [], mid: [], low: [] };
  const byConfidence = { high: [], mid: [], low: [] };

  // 組み合わせ分析用データ
  const combPickGradeMotor = {}; // 予測1着 × 級別 × モーター
  const combPickGrade = {}; // 予測1着 × 級別
  const combPickWinrate = {}; // 予測1着 × 勝率帯
  const combPickConfidence = {}; // 予測1着 × 信頼度
  const combPick12 = {}; // 予測1-2着

  // 日付追跡
  const dates = [];

  for (const pred of standardPreds) {
    const result = resultsMap[pred.race_id];
    if (!result) continue;

    stats.sample_size++;

    // 日付
    const date = pred.race_id.substring(0, 10);
    dates.push(date);

    // 1号艇勝率
    if (result.rank1 === 1) firstBoatWins++;

    // 1号艇情報
    const firstBoat = entriesMap[pred.race_id]?.[1];
    const firstBoatGrade = firstBoat?.grade || "Unknown";
    const firstBoatMotor = firstBoat?.motor_2rate || 0;

    // ----- 単勝 -----
    const winHit = pred.top_pick === result.rank1;
    winHits.push(winHit);
    if (winHit && result.payout_win) {
      winPayouts.push(result.payout_win);
      winReturns.push(result.payout_win); // 回収額
    } else {
      winReturns.push(0);
    }

    // ----- 複勝 -----
    const placeHit =
      pred.top_pick === result.rank1 || pred.top_pick === result.rank2;
    placeHits.push(placeHit);
    if (placeHit) {
      const payout =
        pred.top_pick === result.rank1
          ? result.payout_place_1
          : result.payout_place_2;
      if (payout) placePayouts.push(payout);
    }

    // ----- 3連複 -----
    const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd]
      .filter(Boolean)
      .sort()
      .join("-");
    const resultTop3 = [result.rank1, result.rank2, result.rank3]
      .sort()
      .join("-");
    const trioHit = predTop3 === resultTop3;
    trioHits.push(trioHit);
    // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
    if (trioHit && result.payout_trifecta) {
      trioPayouts.push(result.payout_trifecta);
    }

    // ----- 3連単 -----
    const predTrifecta = [pred.top_pick, pred.top_2nd, pred.top_3rd]
      .filter(Boolean)
      .join("-");
    const resultTrifecta = [result.rank1, result.rank2, result.rank3].join("-");
    const trifectaHit = predTrifecta === resultTrifecta;
    trifectaHits.push(trifectaHit);
    if (trifectaHit && result.payout_trio) {
      trifectaPayouts.push(result.payout_trio);
    }

    // ----- 条件別集計 -----
    // 1号艇級別
    if (!byFirstBoatGrade[firstBoatGrade]) {
      byFirstBoatGrade[firstBoatGrade] = { total: 0, winHits: 0, payouts: [] };
    }
    byFirstBoatGrade[firstBoatGrade].total++;
    if (winHit) {
      byFirstBoatGrade[firstBoatGrade].winHits++;
      if (result.payout_win)
        byFirstBoatGrade[firstBoatGrade].payouts.push(result.payout_win);
    }

    // 1号艇モーター性能
    const motorCategory =
      firstBoatMotor >= 40 ? "high" : firstBoatMotor >= 30 ? "mid" : "low";
    byFirstBoatMotor[motorCategory].push({
      hit: winHit,
      payout: winHit ? result.payout_win : 0,
    });

    // AI信頼度
    const conf = pred.confidence || 50;
    const confCategory = conf >= 70 ? "high" : conf >= 50 ? "mid" : "low";
    byConfidence[confCategory].push({
      hit: winHit,
      payout: winHit ? result.payout_win : 0,
    });

    // ===== 組み合わせ分析用データ収集 =====
    const pickBoat = entriesMap[pred.race_id]?.[pred.top_pick];
    const pickGrade = pickBoat?.grade || "Unknown";
    const pickMotor = pickBoat?.motor_2rate || 0;
    const pickWinRate = pickBoat?.win_rate || 0;

    // 1. 予測1着 × 級別 × モーター
    const keyGradeMotor = `${pred.top_pick}号艇_${pickGrade}_M${categorizeMotor(pickMotor)}`;
    if (!combPickGradeMotor[keyGradeMotor]) {
      combPickGradeMotor[keyGradeMotor] = { total: 0, hits: 0, payouts: [] };
    }
    combPickGradeMotor[keyGradeMotor].total++;
    if (winHit) {
      combPickGradeMotor[keyGradeMotor].hits++;
      if (result.payout_win)
        combPickGradeMotor[keyGradeMotor].payouts.push(result.payout_win);
    }

    // 2. 予測1着 × 級別
    const keyGrade = `${pred.top_pick}号艇_${pickGrade}`;
    if (!combPickGrade[keyGrade]) {
      combPickGrade[keyGrade] = { total: 0, hits: 0, payouts: [] };
    }
    combPickGrade[keyGrade].total++;
    if (winHit) {
      combPickGrade[keyGrade].hits++;
      if (result.payout_win)
        combPickGrade[keyGrade].payouts.push(result.payout_win);
    }

    // 3. 予測1着 × 勝率帯
    const keyWinrate = `${pred.top_pick}号艇_勝率${categorizeWinRate(pickWinRate)}`;
    if (!combPickWinrate[keyWinrate]) {
      combPickWinrate[keyWinrate] = { total: 0, hits: 0, payouts: [] };
    }
    combPickWinrate[keyWinrate].total++;
    if (winHit) {
      combPickWinrate[keyWinrate].hits++;
      if (result.payout_win)
        combPickWinrate[keyWinrate].payouts.push(result.payout_win);
    }

    // 4. 予測1着 × 信頼度
    const keyConfidence = `${pred.top_pick}号艇_信頼度${categorizeConfidence(conf)}`;
    if (!combPickConfidence[keyConfidence]) {
      combPickConfidence[keyConfidence] = { total: 0, hits: 0, payouts: [] };
    }
    combPickConfidence[keyConfidence].total++;
    if (winHit) {
      combPickConfidence[keyConfidence].hits++;
      if (result.payout_win)
        combPickConfidence[keyConfidence].payouts.push(result.payout_win);
    }

    // 5. 予測1-2着の組み合わせ
    const key12 = `${pred.top_pick}-${pred.top_2nd}`;
    if (!combPick12[key12]) {
      combPick12[key12] = { total: 0, hits: 0, payouts: [] };
    }
    combPick12[key12].total++;
    if (winHit) {
      combPick12[key12].hits++;
      if (result.payout_win) combPick12[key12].payouts.push(result.payout_win);
    }
  }

  if (stats.sample_size === 0) return null;

  // 日付範囲
  dates.sort();
  stats.data_period.start = dates[0];
  stats.data_period.end = dates[dates.length - 1];

  // ===== 統計値計算 =====

  // 基本統計
  stats.basic.first_boat_win_rate = (
    (firstBoatWins / stats.sample_size) *
    100
  ).toFixed(1);
  stats.basic.upset_rate = (
    ((stats.sample_size - firstBoatWins) / stats.sample_size) *
    100
  ).toFixed(1);

  // ベット種別統計
  function calcBetTypeStats(hits, payouts, expectedHitRate = null) {
    const total = hits.length;
    const hitCount = hits.filter((h) => h).length;
    const hitRate = total > 0 ? hitCount / total : 0;
    const payoutSum = payouts.reduce((a, b) => a + b, 0);
    const recoveryRate = total > 0 ? (payoutSum / (total * 100)) * 100 : 0;
    const avgPayout = hitCount > 0 ? payoutSum / hitCount : 0;
    const avgOdds = avgPayout / 100;
    const ev = expectedValue(hitRate, avgPayout);
    const kelly = kellyFraction(hitRate, avgOdds);
    const ci = confidenceInterval95(hitRate, total);

    // 統計的有意性（期待的中率との比較）
    const expected = expectedHitRate || 1 / 6; // 6艇なのでランダムなら16.7%
    const pValue = binomialPValue(hitCount, total, expected);

    return {
      total,
      hits: hitCount,
      hit_rate: (hitRate * 100).toFixed(1),
      hit_rate_ci95: {
        lower: (ci.lower * 100).toFixed(1),
        upper: (ci.upper * 100).toFixed(1),
      },
      payout_sum: payoutSum,
      recovery_rate: recoveryRate.toFixed(1),
      avg_payout: avgPayout.toFixed(0),
      expected_value: ev.toFixed(1),
      kelly_fraction: (kelly * 100).toFixed(2),
      p_value: pValue.toFixed(4),
      is_significant: pValue < 0.05,
    };
  }

  stats.bet_types.win = calcBetTypeStats(winHits, winPayouts, 1 / 6);
  stats.bet_types.place = calcBetTypeStats(placeHits, placePayouts, 2 / 6);
  stats.bet_types.trio = calcBetTypeStats(trioHits, trioPayouts, 1 / 20);
  stats.bet_types.trifecta = calcBetTypeStats(
    trifectaHits,
    trifectaPayouts,
    1 / 120,
  );

  // リスク指標
  const returns = winReturns.map((r) => (r > 0 ? r : 0)); // 100円ベットに対する回収額
  const returnRates = returns.map((r) => r); // 回収率として計算
  stats.risk.sharpe_ratio = sharpeRatio(returnRates).toFixed(3);
  stats.risk.max_drawdown = maxDrawdown(returnRates).toFixed(0);
  stats.risk.volatility = stdDev(returnRates).toFixed(1);

  // 連勝/連敗
  const streakResult = streakAnalysis(winHits);
  stats.streaks.win = {
    max_win: streakResult.maxWin,
    max_lose: streakResult.maxLose,
    current: streakResult.currentStreak,
  };

  // 条件別分析
  for (const [grade, data] of Object.entries(byFirstBoatGrade)) {
    const hitRate = data.total > 0 ? data.winHits / data.total : 0;
    const recoveryRate =
      data.total > 0
        ? (data.payouts.reduce((a, b) => a + b, 0) / (data.total * 100)) * 100
        : 0;
    stats.conditions.by_first_boat_grade[grade] = {
      total: data.total,
      hit_rate: (hitRate * 100).toFixed(1),
      recovery_rate: recoveryRate.toFixed(1),
    };
  }

  for (const [category, data] of Object.entries(byFirstBoatMotor)) {
    if (data.length === 0) continue;
    const hitRate = data.filter((d) => d.hit).length / data.length;
    const recoveryRate =
      (data.reduce((a, d) => a + d.payout, 0) / (data.length * 100)) * 100;
    stats.conditions.by_first_boat_motor[category] = {
      total: data.length,
      hit_rate: (hitRate * 100).toFixed(1),
      recovery_rate: recoveryRate.toFixed(1),
    };
  }

  for (const [category, data] of Object.entries(byConfidence)) {
    if (data.length === 0) continue;
    const hitRate = data.filter((d) => d.hit).length / data.length;
    const recoveryRate =
      (data.reduce((a, d) => a + d.payout, 0) / (data.length * 100)) * 100;
    stats.conditions.by_confidence[category] = {
      total: data.length,
      hit_rate: (hitRate * 100).toFixed(1),
      recovery_rate: recoveryRate.toFixed(1),
    };
  }

  // ===== 組み合わせ分析の統計値計算 =====
  function calcCombinationStats(combData) {
    const result = {};
    for (const [key, data] of Object.entries(combData)) {
      if (data.total < 5) continue; // サンプル数5未満は除外
      const hitRate = data.total > 0 ? data.hits / data.total : 0;
      const payoutSum = data.payouts.reduce((a, b) => a + b, 0);
      const recoveryRate =
        data.total > 0 ? (payoutSum / (data.total * 100)) * 100 : 0;
      result[key] = {
        total: data.total,
        hits: data.hits,
        hit_rate: (hitRate * 100).toFixed(1),
        recovery_rate: recoveryRate.toFixed(1),
      };
    }
    return result;
  }

  stats.combinations.by_pick_grade_motor =
    calcCombinationStats(combPickGradeMotor);
  stats.combinations.by_pick_grade = calcCombinationStats(combPickGrade);
  stats.combinations.by_pick_winrate = calcCombinationStats(combPickWinrate);
  stats.combinations.by_pick_confidence =
    calcCombinationStats(combPickConfidence);
  stats.combinations.by_pick_1_2 = calcCombinationStats(combPick12);

  // ===== 回収率100%超えの有望条件を抽出 =====
  const MIN_SAMPLE = 10; // 最低サンプル数
  const profitableRules = [];

  // 全組み合わせから有望条件を抽出
  const allCombinations = [
    {
      type: "艇番×級別×モーター",
      data: stats.combinations.by_pick_grade_motor,
    },
    { type: "艇番×級別", data: stats.combinations.by_pick_grade },
    { type: "艇番×勝率帯", data: stats.combinations.by_pick_winrate },
    { type: "艇番×信頼度", data: stats.combinations.by_pick_confidence },
    { type: "1-2着予測", data: stats.combinations.by_pick_1_2 },
  ];

  for (const { type, data } of allCombinations) {
    for (const [condition, condStats] of Object.entries(data)) {
      const recovery = parseFloat(condStats.recovery_rate);
      if (recovery >= 100 && condStats.total >= MIN_SAMPLE) {
        profitableRules.push({
          type,
          condition,
          total: condStats.total,
          hits: condStats.hits,
          hit_rate: condStats.hit_rate,
          recovery_rate: condStats.recovery_rate,
          profit_per_race: (((recovery - 100) / 100) * 100).toFixed(0),
        });
      }
    }
  }

  // 回収率順にソート
  profitableRules.sort(
    (a, b) => parseFloat(b.recovery_rate) - parseFloat(a.recovery_rate),
  );
  stats.profitable_rules = profitableRules;

  // ===== 推奨度スコア計算 =====
  const reasons = [];
  let score = 50; // 基準点

  // 回収率ボーナス/ペナルティ
  const winRecovery = parseFloat(stats.bet_types.win.recovery_rate);
  if (winRecovery >= 100) {
    score += 20;
    reasons.push(`単勝回収率${winRecovery}%（100%超）`);
  } else if (winRecovery >= 80) {
    score += 10;
  } else if (winRecovery < 60) {
    score -= 20;
    reasons.push(`単勝回収率${winRecovery}%（低い）`);
  }

  // サンプルサイズボーナス
  if (stats.sample_size >= 100) {
    score += 10;
    reasons.push(`十分なサンプル数（${stats.sample_size}レース）`);
  } else if (stats.sample_size < 30) {
    score -= 15;
    reasons.push(`サンプル数不足（${stats.sample_size}レース）`);
  }

  // シャープレシオ
  const sr = parseFloat(stats.risk.sharpe_ratio);
  if (sr > 0) {
    score += Math.min(20, sr * 10);
    reasons.push(`正のシャープレシオ（${sr}）`);
  }

  // 統計的有意性
  if (stats.bet_types.win.is_significant) {
    score += 10;
    reasons.push("統計的に有意（p<0.05）");
  }

  // 条件別で100%超えがある場合
  for (const [grade, data] of Object.entries(
    stats.conditions.by_first_boat_grade,
  )) {
    if (parseFloat(data.recovery_rate) >= 100 && data.total >= 10) {
      score += 5;
      reasons.push(`${grade}級で回収率${data.recovery_rate}%`);
    }
  }

  stats.recommendation.score = Math.max(0, Math.min(100, score));
  stats.recommendation.grade =
    score >= 80
      ? "A"
      : score >= 60
        ? "B"
        : score >= 40
          ? "C"
          : score >= 20
            ? "D"
            : "E";
  stats.recommendation.reasons = reasons;

  return stats;
}

// ===== メイン処理 =====

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("📊 24会場の詳細統計分析を実行中...\n");
  console.log("=".repeat(70));

  const allStats = [];
  const venueArg = process.argv.find((arg) => arg.startsWith("--venue="));
  const targetVenue = venueArg ? parseInt(venueArg.split("=")[1]) : null;

  const venuesToAnalyze = targetVenue
    ? [targetVenue]
    : Array.from({ length: 24 }, (_, i) => i + 1);

  for (const venueCode of venuesToAnalyze) {
    const stats = await collectVenueStats(venueCode);

    if (stats && stats.sample_size > 0) {
      allStats.push(stats);

      console.log(`\n【${stats.venue_name}】 (${stats.sample_size}レース)`);
      console.log(
        `  期間: ${stats.data_period.start} 〜 ${stats.data_period.end}`,
      );
      console.log(`  1号艇勝率: ${stats.basic.first_boat_win_rate}%`);
      console.log(`  ─────────────────────────────────────`);
      console.log(
        `  単勝: 的中率 ${stats.bet_types.win.hit_rate}% [CI: ${stats.bet_types.win.hit_rate_ci95.lower}-${stats.bet_types.win.hit_rate_ci95.upper}%], 回収率 ${stats.bet_types.win.recovery_rate}%`,
      );
      console.log(
        `  複勝: 的中率 ${stats.bet_types.place.hit_rate}%, 回収率 ${stats.bet_types.place.recovery_rate}%`,
      );
      console.log(
        `  3連複: 的中率 ${stats.bet_types.trio.hit_rate}%, 回収率 ${stats.bet_types.trio.recovery_rate}%`,
      );
      console.log(
        `  3連単: 的中率 ${stats.bet_types.trifecta.hit_rate}%, 回収率 ${stats.bet_types.trifecta.recovery_rate}%`,
      );
      console.log(`  ─────────────────────────────────────`);
      console.log(`  シャープレシオ: ${stats.risk.sharpe_ratio}`);
      console.log(`  最大DD: ${stats.risk.max_drawdown}円`);
      console.log(
        `  連勝/連敗: ${stats.streaks.win.max_win}連勝 / ${stats.streaks.win.max_lose}連敗`,
      );
      console.log(`  ─────────────────────────────────────`);
      console.log(
        `  推奨度: ${stats.recommendation.grade} (${stats.recommendation.score}点)`,
      );
      if (stats.recommendation.reasons.length > 0) {
        console.log(`  理由: ${stats.recommendation.reasons.join(", ")}`);
      }

      // 有望条件（回収率100%超え）を表示
      if (stats.profitable_rules.length > 0) {
        console.log(`  ─────────────────────────────────────`);
        console.log(`  🎯 有望条件 (回収率100%↑, n≥10):`);
        for (const rule of stats.profitable_rules.slice(0, 5)) {
          console.log(
            `     ${rule.condition}: ${rule.recovery_rate}% (${rule.total}レース, 的中${rule.hit_rate}%)`,
          );
        }
        if (stats.profitable_rules.length > 5) {
          console.log(`     ...他${stats.profitable_rules.length - 5}件`);
        }
      }
    } else {
      console.log(`\n【${VENUE_NAMES[venueCode]}】 データなし`);
    }
  }

  // ===== ランキング =====
  console.log("\n" + "=".repeat(70));
  console.log("\n📈 ランキング（単勝回収率順）");
  console.log("─".repeat(50));

  const sortedByRecovery = [...allStats]
    .filter((s) => s.sample_size >= 20)
    .sort(
      (a, b) =>
        parseFloat(b.bet_types.win.recovery_rate) -
        parseFloat(a.bet_types.win.recovery_rate),
    );

  sortedByRecovery.forEach((s, i) => {
    const marker =
      parseFloat(s.bet_types.win.recovery_rate) >= 100 ? "🔥" : "  ";
    console.log(
      `${marker} ${(i + 1).toString().padStart(2)}. ${s.venue_name.padEnd(6)} ${s.bet_types.win.recovery_rate.padStart(6)}% (${s.sample_size}レース) [${s.recommendation.grade}]`,
    );
  });

  console.log("\n📊 推奨度ランキング");
  console.log("─".repeat(50));

  const sortedByScore = [...allStats]
    .filter((s) => s.sample_size >= 20)
    .sort((a, b) => b.recommendation.score - a.recommendation.score);

  sortedByScore.slice(0, 10).forEach((s, i) => {
    console.log(
      `  ${(i + 1).toString().padStart(2)}. ${s.venue_name.padEnd(6)} ${s.recommendation.score.toString().padStart(3)}点 [${s.recommendation.grade}] - ${s.recommendation.reasons[0] || ""}`,
    );
  });

  // ===== 全会場の有望条件（組み合わせ分析） =====
  console.log("\n🎯 全会場の有望条件（回収率100%↑, n≥10）");
  console.log("─".repeat(70));

  // 全会場の有望条件を集約
  const allProfitableRules = [];
  for (const s of allStats) {
    for (const rule of s.profitable_rules) {
      allProfitableRules.push({
        venue: s.venue_name,
        venue_code: s.venue_code,
        ...rule,
      });
    }
  }

  // 回収率順にソート
  allProfitableRules.sort(
    (a, b) => parseFloat(b.recovery_rate) - parseFloat(a.recovery_rate),
  );

  // 上位20件を表示
  console.log("\n  【回収率TOP20】");
  for (const rule of allProfitableRules.slice(0, 20)) {
    const marker = parseFloat(rule.recovery_rate) >= 120 ? "🔥" : "  ";
    console.log(
      `${marker} ${rule.venue.padEnd(4)} | ${rule.condition.padEnd(25)} | ${rule.recovery_rate.padStart(6)}% | ${rule.total}R | 的中${rule.hit_rate}%`,
    );
  }

  // 会場別サマリー
  console.log("\n  【会場別 有望条件数】");
  const venueRuleCounts = {};
  for (const rule of allProfitableRules) {
    venueRuleCounts[rule.venue] = (venueRuleCounts[rule.venue] || 0) + 1;
  }
  const sortedVenues = Object.entries(venueRuleCounts).sort(
    (a, b) => b[1] - a[1],
  );
  for (const [venue, count] of sortedVenues.slice(0, 10)) {
    console.log(`     ${venue}: ${count}件`);
  }

  // ===== 結果を保存 =====
  const outputPath = path.join(
    __dirname,
    "../../data/analysis/summary/venue-stats.json",
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const output = {
    generated_at: new Date().toISOString(),
    total_venues: allStats.length,
    total_races: allStats.reduce((a, s) => a + s.sample_size, 0),
    venues: allStats,
    rankings: {
      by_recovery: sortedByRecovery.map((s) => ({
        code: s.venue_code,
        name: s.venue_name,
        recovery: s.bet_types.win.recovery_rate,
      })),
      by_recommendation: sortedByScore.map((s) => ({
        code: s.venue_code,
        name: s.venue_name,
        score: s.recommendation.score,
        grade: s.recommendation.grade,
      })),
    },
    // 全会場の有望条件（回収率100%↑）
    profitable_rules: allProfitableRules,
    profitable_rules_summary: {
      total_count: allProfitableRules.length,
      by_venue: sortedVenues.map(([venue, count]) => ({ venue, count })),
      top_10: allProfitableRules.slice(0, 10),
    },
  };

  await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n✅ 結果を保存しました: ${outputPath}`);
}

main().catch(console.error);
