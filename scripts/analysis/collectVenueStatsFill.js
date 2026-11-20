import {
  stdDev,
  confidenceInterval95,
  sharpeRatio,
  maxDrawdown,
  streakAnalysis,
  binomialPValue,
  expectedValue,
  kellyFraction,
} from "./collectVenueStatsMath.js";

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

export {
  fillBasicAndBetStats,
  fillRiskAndStreaks,
  fillConditionStats,
  fillCombinationStats,
  extractProfitableRules,
  fillRecommendation,
};
