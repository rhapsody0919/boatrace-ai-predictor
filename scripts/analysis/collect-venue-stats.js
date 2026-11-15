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

/**
 * 予測・結果・選手情報を取得（エラー時は null）
 */
async function fetchVenueData(venueCode, venueCodeStr) {
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

  return { predictions, results, entries };
}

function buildResultsMap(results) {
  const resultsMap = {};
  results?.forEach((r) => {
    resultsMap[r.race_id] = r;
  });
  return resultsMap;
}

function buildEntriesMap(entries) {
  const entriesMap = {};
  entries?.forEach((e) => {
    if (!entriesMap[e.race_id]) entriesMap[e.race_id] = {};
    entriesMap[e.race_id][e.boat_number] = e;
  });
  return entriesMap;
}

function createVenueStats(venueCode, venueName) {
  return {
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
}

function createAccumulator() {
  return {
    sampleSize: 0,
    firstBoatWins: 0,
    winHits: [],
    winPayouts: [],
    winReturns: [],
    placeHits: [],
    placePayouts: [],
    trioHits: [],
    trioPayouts: [],
    trifectaHits: [],
    trifectaPayouts: [],

    // 条件別データ
    byFirstBoatGrade: {},
    byFirstBoatMotor: { high: [], mid: [], low: [] },
    byConfidence: { high: [], mid: [], low: [] },

    // 組み合わせ分析用データ
    combPickGradeMotor: {}, // 予測1着 × 級別 × モーター
    combPickGrade: {}, // 予測1着 × 級別
    combPickWinrate: {}, // 予測1着 × 勝率帯
    combPickConfidence: {}, // 予測1着 × 信頼度
    combPick12: {}, // 予測1-2着

    // 日付追跡
    dates: [],
  };
}

/**
 * 組み合わせ1件分の集計（該当キーの total・hits・payouts を更新）
 */
function addCombination(combData, key, winHit, result) {
  if (!combData[key]) {
    combData[key] = { total: 0, hits: 0, payouts: [] };
  }
  combData[key].total++;
  if (winHit) {
    combData[key].hits++;
    if (result.payout_win) combData[key].payouts.push(result.payout_win);
  }
}

function collectBetResults(acc, pred, result) {
  // ----- 単勝 -----
  const winHit = pred.top_pick === result.rank1;
  acc.winHits.push(winHit);
  if (winHit && result.payout_win) {
    acc.winPayouts.push(result.payout_win);
    acc.winReturns.push(result.payout_win); // 回収額
  } else {
    acc.winReturns.push(0);
  }

  // ----- 複勝 -----
  const placeHit =
    pred.top_pick === result.rank1 || pred.top_pick === result.rank2;
  acc.placeHits.push(placeHit);
  if (placeHit) {
    const payout =
      pred.top_pick === result.rank1
        ? result.payout_place_1
        : result.payout_place_2;
    if (payout) acc.placePayouts.push(payout);
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
  acc.trioHits.push(trioHit);
  // payout_trio=3連単・payout_trifecta=3連複（is_hit_* も同じ。列名と中身が逆。079、BOA-536）
  if (trioHit && result.payout_trifecta) {
    acc.trioPayouts.push(result.payout_trifecta);
  }

  // ----- 3連単 -----
  const predTrifecta = [pred.top_pick, pred.top_2nd, pred.top_3rd]
    .filter(Boolean)
    .join("-");
  const resultTrifecta = [result.rank1, result.rank2, result.rank3].join("-");
  const trifectaHit = predTrifecta === resultTrifecta;
  acc.trifectaHits.push(trifectaHit);
  if (trifectaHit && result.payout_trio) {
    acc.trifectaPayouts.push(result.payout_trio);
  }

  return winHit;
}

function collectConditionData(acc, pred, result, winHit, firstBoat) {
  const firstBoatGrade = firstBoat?.grade || "Unknown";
  const firstBoatMotor = firstBoat?.motor_2rate || 0;
  const byFirstBoatGrade = acc.byFirstBoatGrade;

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
  acc.byFirstBoatMotor[motorCategory].push({
    hit: winHit,
    payout: winHit ? result.payout_win : 0,
  });

  // AI信頼度
  const conf = pred.confidence || 50;
  const confCategory = conf >= 70 ? "high" : conf >= 50 ? "mid" : "low";
  acc.byConfidence[confCategory].push({
    hit: winHit,
    payout: winHit ? result.payout_win : 0,
  });

  return conf;
}

function collectCombinationData(acc, pred, result, winHit, conf, pickBoat) {
  // ===== 組み合わせ分析用データ収集 =====
  const pickGrade = pickBoat?.grade || "Unknown";
  const pickMotor = pickBoat?.motor_2rate || 0;
  const pickWinRate = pickBoat?.win_rate || 0;

  // 1. 予測1着 × 級別 × モーター
  const keyGradeMotor = `${pred.top_pick}号艇_${pickGrade}_M${categorizeMotor(pickMotor)}`;
  addCombination(acc.combPickGradeMotor, keyGradeMotor, winHit, result);

  // 2. 予測1着 × 級別
  const keyGrade = `${pred.top_pick}号艇_${pickGrade}`;
  addCombination(acc.combPickGrade, keyGrade, winHit, result);

  // 3. 予測1着 × 勝率帯
  const keyWinrate = `${pred.top_pick}号艇_勝率${categorizeWinRate(pickWinRate)}`;
  addCombination(acc.combPickWinrate, keyWinrate, winHit, result);

  // 4. 予測1着 × 信頼度
  const keyConfidence = `${pred.top_pick}号艇_信頼度${categorizeConfidence(conf)}`;
  addCombination(acc.combPickConfidence, keyConfidence, winHit, result);

  // 5. 予測1-2着の組み合わせ
  const key12 = `${pred.top_pick}-${pred.top_2nd}`;
  addCombination(acc.combPick12, key12, winHit, result);
}

/**
 * 予測1件分を集計（結果が無ければ何もしない）
 */
function collectPrediction(acc, pred, resultsMap, entriesMap) {
  const result = resultsMap[pred.race_id];
  if (!result) return;

  acc.sampleSize++;

  // 日付
  const date = pred.race_id.substring(0, 10);
  acc.dates.push(date);

  // 1号艇勝率
  if (result.rank1 === 1) acc.firstBoatWins++;

  // 1号艇情報
  const firstBoat = entriesMap[pred.race_id]?.[1];

  const winHit = collectBetResults(acc, pred, result);
  const conf = collectConditionData(acc, pred, result, winHit, firstBoat);
  const pickBoat = entriesMap[pred.race_id]?.[pred.top_pick];
  collectCombinationData(acc, pred, result, winHit, conf, pickBoat);
}

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

function fillBasicAndBetStats(stats, acc) {
  // 基本統計
  stats.basic.first_boat_win_rate = (
    (acc.firstBoatWins / stats.sample_size) *
    100
  ).toFixed(1);
  stats.basic.upset_rate = (
    ((stats.sample_size - acc.firstBoatWins) / stats.sample_size) *
    100
  ).toFixed(1);

  stats.bet_types.win = calcBetTypeStats(acc.winHits, acc.winPayouts, 1 / 6);
  stats.bet_types.place = calcBetTypeStats(
    acc.placeHits,
    acc.placePayouts,
    2 / 6,
  );
  stats.bet_types.trio = calcBetTypeStats(
    acc.trioHits,
    acc.trioPayouts,
    1 / 20,
  );
  stats.bet_types.trifecta = calcBetTypeStats(
    acc.trifectaHits,
    acc.trifectaPayouts,
    1 / 120,
  );
}

function fillRiskAndStreaks(stats, acc) {
  // リスク指標
  const returns = acc.winReturns.map((r) => (r > 0 ? r : 0)); // 100円ベットに対する回収額
  const returnRates = returns.map((r) => r); // 回収率として計算
  stats.risk.sharpe_ratio = sharpeRatio(returnRates).toFixed(3);
  stats.risk.max_drawdown = maxDrawdown(returnRates).toFixed(0);
  stats.risk.volatility = stdDev(returnRates).toFixed(1);

  // 連勝/連敗
  const streakResult = streakAnalysis(acc.winHits);
  stats.streaks.win = {
    max_win: streakResult.maxWin,
    max_lose: streakResult.maxLose,
    current: streakResult.currentStreak,
  };
}

function summarizeConditionList(target, byCategory) {
  for (const [category, data] of Object.entries(byCategory)) {
    if (data.length === 0) continue;
    const hitRate = data.filter((d) => d.hit).length / data.length;
    const recoveryRate =
      (data.reduce((a, d) => a + d.payout, 0) / (data.length * 100)) * 100;
    target[category] = {
      total: data.length,
      hit_rate: (hitRate * 100).toFixed(1),
      recovery_rate: recoveryRate.toFixed(1),
    };
  }
}

function fillConditionStats(stats, acc) {
  // 条件別分析
  for (const [grade, data] of Object.entries(acc.byFirstBoatGrade)) {
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

  summarizeConditionList(
    stats.conditions.by_first_boat_motor,
    acc.byFirstBoatMotor,
  );
  summarizeConditionList(stats.conditions.by_confidence, acc.byConfidence);
}

function fillCombinationStats(stats, acc) {
  stats.combinations.by_pick_grade_motor = calcCombinationStats(
    acc.combPickGradeMotor,
  );
  stats.combinations.by_pick_grade = calcCombinationStats(acc.combPickGrade);
  stats.combinations.by_pick_winrate = calcCombinationStats(
    acc.combPickWinrate,
  );
  stats.combinations.by_pick_confidence = calcCombinationStats(
    acc.combPickConfidence,
  );
  stats.combinations.by_pick_1_2 = calcCombinationStats(acc.combPick12);
}

// ===== 回収率100%超えの有望条件を抽出 =====
function extractProfitableRules(combinations) {
  const MIN_SAMPLE = 10; // 最低サンプル数
  const profitableRules = [];

  // 全組み合わせから有望条件を抽出
  const allCombinations = [
    {
      type: "艇番×級別×モーター",
      data: combinations.by_pick_grade_motor,
    },
    { type: "艇番×級別", data: combinations.by_pick_grade },
    { type: "艇番×勝率帯", data: combinations.by_pick_winrate },
    { type: "艇番×信頼度", data: combinations.by_pick_confidence },
    { type: "1-2着予測", data: combinations.by_pick_1_2 },
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
  return profitableRules;
}

// ===== 推奨度スコア計算 =====
function fillRecommendation(stats) {
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
}

async function collectVenueStats(venueCode) {
  const venueName = VENUE_NAMES[venueCode];
  const venueCodeStr = String(venueCode).padStart(2, "0");

  const fetched = await fetchVenueData(venueCode, venueCodeStr);
  if (!fetched) return null;
  const { predictions, results, entries } = fetched;

  // マップ化
  const resultsMap = buildResultsMap(results);
  const entriesMap = buildEntriesMap(entries);

  // standardモデルのみで分析
  const standardPreds = predictions.filter((p) => p.model_id === "standard");

  // ===== 統計計算 =====

  const stats = createVenueStats(venueCode, venueName);

  // データ収集
  const acc = createAccumulator();
  for (const pred of standardPreds) {
    collectPrediction(acc, pred, resultsMap, entriesMap);
  }
  stats.sample_size = acc.sampleSize;

  if (stats.sample_size === 0) return null;

  // 日付範囲
  const dates = acc.dates;
  dates.sort();
  stats.data_period.start = dates[0];
  stats.data_period.end = dates[dates.length - 1];

  // ===== 統計値計算 =====
  fillBasicAndBetStats(stats, acc);
  fillRiskAndStreaks(stats, acc);
  fillConditionStats(stats, acc);
  fillCombinationStats(stats, acc);
  stats.profitable_rules = extractProfitableRules(stats.combinations);
  fillRecommendation(stats);

  return stats;
}

// ===== メイン処理 =====

function printVenueStats(stats) {
  console.log(`\n【${stats.venue_name}】 (${stats.sample_size}レース)`);
  console.log(`  期間: ${stats.data_period.start} 〜 ${stats.data_period.end}`);
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
}

async function analyzeAllVenues(venuesToAnalyze) {
  const allStats = [];
  for (const venueCode of venuesToAnalyze) {
    const stats = await collectVenueStats(venueCode);

    if (stats && stats.sample_size > 0) {
      allStats.push(stats);
      printVenueStats(stats);
    } else {
      console.log(`\n【${VENUE_NAMES[venueCode]}】 データなし`);
    }
  }
  return allStats;
}

// ===== ランキング =====
function printRankings(allStats) {
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

  return { sortedByRecovery, sortedByScore };
}

// ===== 全会場の有望条件（組み合わせ分析） =====
function printAllProfitableRules(allStats) {
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

  return { allProfitableRules, sortedVenues };
}

// ===== 結果を保存 =====
async function saveOutput(allStats, rankings, profitable) {
  const { sortedByRecovery, sortedByScore } = rankings;
  const { allProfitableRules, sortedVenues } = profitable;
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

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です");
    process.exit(1);
  }

  console.log("📊 24会場の詳細統計分析を実行中...\n");
  console.log("=".repeat(70));

  const venueArg = process.argv.find((arg) => arg.startsWith("--venue="));
  const targetVenue = venueArg ? parseInt(venueArg.split("=")[1]) : null;

  const venuesToAnalyze = targetVenue
    ? [targetVenue]
    : Array.from({ length: 24 }, (_, i) => i + 1);

  const allStats = await analyzeAllVenues(venuesToAnalyze);

  // ===== ランキング =====
  const rankings = printRankings(allStats);

  // ===== 全会場の有望条件（組み合わせ分析） =====
  const profitable = printAllProfitableRules(allStats);

  // ===== 結果を保存 =====
  await saveOutput(allStats, rankings, profitable);
}

main().catch(console.error);
