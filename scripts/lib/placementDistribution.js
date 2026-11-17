/**
 * 2着・3着のコース別統計分布
 *
 * race_results 7,642件から算出（2026-03-07時点）
 * scripts/analysis/calculate-placement-distribution.js で生成
 *
 * キー: "{technique}_{winnerCourse}"
 * 値: { second: {コース: 確率}, third: {コース: 確率}, sampleSize: 件数 }
 */

export const PLACEMENT_DISTRIBUTION = {
  nige_1: {
    second: { 1: 0, 2: 0.332, 3: 0.294, 4: 0.185, 5: 0.119, 6: 0.069 },
    third: { 1: 0, 2: 0.224, 3: 0.241, 4: 0.217, 5: 0.174, 6: 0.144 },
    sampleSize: 4064,
  },
  nuki_1: {
    second: { 1: 0, 2: 0.411, 3: 0.239, 4: 0.156, 5: 0.144, 6: 0.05 },
    third: { 1: 0, 2: 0.133, 3: 0.294, 4: 0.244, 5: 0.2, 6: 0.128 },
    sampleSize: 180,
  },
  sashi_2: {
    second: { 1: 0.622, 2: 0, 3: 0.171, 4: 0.099, 5: 0.061, 6: 0.047 },
    third: { 1: 0.192, 2: 0, 3: 0.259, 4: 0.234, 5: 0.171, 6: 0.144 },
    sampleSize: 556,
  },
  makuri_2: {
    second: { 1: 0.114, 2: 0, 3: 0.366, 4: 0.234, 5: 0.165, 6: 0.121 },
    third: { 1: 0.158, 2: 0, 3: 0.223, 4: 0.234, 5: 0.183, 6: 0.201 },
    sampleSize: 273,
  },
  nuki_2: {
    second: { 1: 0.528, 2: 0, 3: 0.169, 4: 0.146, 5: 0.101, 6: 0.056 },
    third: { 1: 0.18, 2: 0, 3: 0.292, 4: 0.247, 5: 0.169, 6: 0.112 },
    sampleSize: 89,
  },
  makuri_3: {
    second: { 1: 0.194, 2: 0.24, 3: 0, 4: 0.256, 5: 0.205, 6: 0.105 },
    third: { 1: 0.17, 2: 0.221, 3: 0, 4: 0.213, 5: 0.205, 6: 0.191 },
    sampleSize: 371,
  },
  makurizashi_3: {
    second: { 1: 0.633, 2: 0.176, 3: 0, 4: 0.09, 5: 0.069, 6: 0.032 },
    third: { 1: 0.133, 2: 0.156, 3: 0, 4: 0.283, 5: 0.24, 6: 0.188 },
    sampleSize: 346,
  },
  sashi_3: {
    second: { 1: 0.269, 2: 0.296, 3: 0, 4: 0.204, 5: 0.111, 6: 0.12 },
    third: { 1: 0.194, 2: 0.204, 3: 0, 4: 0.176, 5: 0.231, 6: 0.194 },
    sampleSize: 108,
  },
  nuki_3: {
    second: { 1: 0.474, 2: 0.284, 3: 0, 4: 0.168, 5: 0.053, 6: 0.021 },
    third: { 1: 0.211, 2: 0.242, 3: 0, 4: 0.147, 5: 0.253, 6: 0.147 },
    sampleSize: 95,
  },
  makuri_4: {
    second: { 1: 0.202, 2: 0.176, 3: 0.123, 4: 0, 5: 0.304, 6: 0.194 },
    third: { 1: 0.265, 2: 0.199, 3: 0.134, 4: 0, 5: 0.213, 6: 0.189 },
    sampleSize: 381,
  },
  makurizashi_4: {
    second: { 1: 0.398, 2: 0.179, 3: 0.164, 4: 0, 5: 0.194, 6: 0.065 },
    third: { 1: 0.174, 2: 0.184, 3: 0.214, 4: 0, 5: 0.249, 6: 0.179 },
    sampleSize: 201,
  },
  sashi_4: {
    second: { 1: 0.39, 2: 0.257, 3: 0.213, 4: 0, 5: 0.088, 6: 0.051 },
    third: { 1: 0.257, 2: 0.199, 3: 0.213, 4: 0, 5: 0.184, 6: 0.147 },
    sampleSize: 136,
  },
  nuki_4: {
    second: { 1: 0.385, 2: 0.212, 3: 0.096, 4: 0, 5: 0.192, 6: 0.115 },
    third: { 1: 0.288, 2: 0.192, 3: 0.288, 4: 0, 5: 0.115, 6: 0.115 },
    sampleSize: 52,
  },
  makuri_5: {
    second: { 1: 0.305, 2: 0.211, 3: 0.147, 4: 0.074, 5: 0, 6: 0.263 },
    third: { 1: 0.2, 2: 0.189, 3: 0.211, 4: 0.116, 5: 0, 6: 0.284 },
    sampleSize: 95,
  },
  makurizashi_5: {
    second: { 1: 0.383, 2: 0.183, 3: 0.175, 4: 0.163, 5: 0, 6: 0.096 },
    third: { 1: 0.183, 2: 0.192, 3: 0.138, 4: 0.213, 5: 0, 6: 0.275 },
    sampleSize: 240,
  },
  sashi_5: {
    second: { 1: 0.306, 2: 0.327, 3: 0.143, 4: 0.143, 5: 0, 6: 0.082 },
    third: { 1: 0.224, 2: 0.184, 3: 0.347, 4: 0.102, 5: 0, 6: 0.143 },
    sampleSize: 49,
  },
  nuki_5: {
    second: { 1: 0.509, 2: 0.255, 3: 0.109, 4: 0.091, 5: 0, 6: 0.036 },
    third: { 1: 0.255, 2: 0.218, 3: 0.127, 4: 0.236, 5: 0, 6: 0.164 },
    sampleSize: 55,
  },
  makuri_6: {
    second: { 1: 0.247, 2: 0.301, 3: 0.164, 4: 0.151, 5: 0.137, 6: 0 },
    third: { 1: 0.205, 2: 0.219, 3: 0.233, 4: 0.274, 5: 0.068, 6: 0 },
    sampleSize: 73,
  },
  makurizashi_6: {
    second: { 1: 0.411, 2: 0.144, 3: 0.167, 4: 0.178, 5: 0.1, 6: 0 },
    third: { 1: 0.222, 2: 0.311, 3: 0.111, 4: 0.211, 5: 0.144, 6: 0 },
    sampleSize: 90,
  },
  sashi_6: {
    second: { 1: 0.31, 2: 0.207, 3: 0.241, 4: 0.207, 5: 0.034, 6: 0 },
    third: { 1: 0.276, 2: 0.207, 3: 0.172, 4: 0.138, 5: 0.207, 6: 0 },
    sampleSize: 29,
  },
  nuki_6: {
    second: { 1: 0.5, 2: 0.067, 3: 0.133, 4: 0.233, 5: 0.067, 6: 0 },
    third: { 1: 0.233, 2: 0.433, 3: 0.133, 4: 0.133, 5: 0.067, 6: 0 },
    sampleSize: 30,
  },
};

// フォールバック用グローバル平均
export const GLOBAL_PLACEMENT_AVERAGE = {
  second: { 1: 0.168, 2: 0.254, 3: 0.223, 4: 0.156, 5: 0.122, 6: 0.077 },
  third: { 1: 0.087, 2: 0.188, 3: 0.202, 4: 0.196, 5: 0.172, 6: 0.156 },
  sampleSize: 7642,
};

/** 勝者コースを0にして、残りの合計が1になるよう再正規化する（dist を直接書き換える） */
function zeroWinnerAndRenormalize(dist, winnerCourse) {
  dist[winnerCourse] = 0;
  const sum = Object.values(dist).reduce((a, b) => a + b, 0);
  if (sum > 0)
    for (let c = 1; c <= 6; c++)
      dist[c] = Math.round((dist[c] / sum) * 1000) / 1000;
}

/** 同techniqueの全コース平均（sampleSize で重み付け）。勝者コースは0にして再正規化する */
function techniqueAverageBaseline(techEntries, winnerCourse) {
  const avgSecond = {};
  const avgThird = {};
  let totalSamples = 0;

  for (let c = 1; c <= 6; c++) {
    avgSecond[c] = 0;
    avgThird[c] = 0;
  }

  for (const [, v] of techEntries) {
    for (let c = 1; c <= 6; c++) {
      avgSecond[c] += v.second[c] * v.sampleSize;
      avgThird[c] += v.third[c] * v.sampleSize;
    }
    totalSamples += v.sampleSize;
  }

  for (let c = 1; c <= 6; c++) {
    avgSecond[c] = Math.round((avgSecond[c] / totalSamples) * 1000) / 1000;
    avgThird[c] = Math.round((avgThird[c] / totalSamples) * 1000) / 1000;
  }

  // 勝者コースを0にして再正規化
  zeroWinnerAndRenormalize(avgSecond, winnerCourse);
  zeroWinnerAndRenormalize(avgThird, winnerCourse);

  return { second: avgSecond, third: avgThird, sampleSize: totalSamples };
}

/** グローバル平均（勝者コースを除外して再正規化） */
function globalAverageBaseline(winnerCourse) {
  const fallback = { ...GLOBAL_PLACEMENT_AVERAGE };
  const fs = { ...fallback.second };
  const ft = { ...fallback.third };
  zeroWinnerAndRenormalize(fs, winnerCourse);
  zeroWinnerAndRenormalize(ft, winnerCourse);
  return { second: fs, third: ft, sampleSize: fallback.sampleSize };
}

/**
 * フォールバック付きルックアップ
 * 1. 完全一致キー（sampleSize >= 30）
 * 2. 同technique全コース平均
 * 3. グローバル平均
 */
export function getPlacementBaseline(technique, winnerCourse) {
  const key = `${technique}_${winnerCourse}`;
  const entry = PLACEMENT_DISTRIBUTION[key];

  // sampleSize 30以上なら直接使用
  if (entry && entry.sampleSize >= 30) {
    return entry;
  }

  // 同techniqueの全コース平均を算出
  const techEntries = Object.entries(PLACEMENT_DISTRIBUTION).filter(
    ([k, v]) => k.startsWith(`${technique}_`) && v.sampleSize >= 30,
  );

  if (techEntries.length > 0) {
    return techniqueAverageBaseline(techEntries, winnerCourse);
  }

  return globalAverageBaseline(winnerCourse);
}
