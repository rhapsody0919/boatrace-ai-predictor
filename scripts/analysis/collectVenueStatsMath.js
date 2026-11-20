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

export {
  stdDev,
  confidenceInterval95,
  sharpeRatio,
  maxDrawdown,
  streakAnalysis,
  binomialPValue,
  expectedValue,
  kellyFraction,
  categorizeWinRate,
  categorizeMotor,
  categorizeConfidence,
};
