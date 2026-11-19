function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

// 低精度会場：共通の外れパターンを言語化
function failurePatterns(p) {
  const patterns = [];
  const misses = p.total_races - p.hits;

  // 1コース実績が param より大きく低い場合は荒れ会場
  if (p.venue_1course_actual_rate < p.venue_1course_param - 0.03) {
    patterns.push(
      `1コース実績勝率(${(p.venue_1course_actual_rate * 100).toFixed(0)}%)がパラメータ値(${(p.venue_1course_param * 100).toFixed(0)}%)を下回り、想定以上に荒れている`,
    );
  }

  // 不的中レースで実際の決まり手の偏り
  const missTechSorted = Object.entries(
    p.missed_race_actual_technique_distribution,
  ).sort((a, b) => b[1] - a[1]);
  if (missTechSorted.length > 0) {
    const [topT, topC] = missTechSorted[0];
    patterns.push(
      `不的中${misses}レース中、実際の決まり手で最多は「${topT}」(${topC}件, ${pct(topC, misses)}%)`,
    );
  }

  // 決まり手別 的中率の最低
  const techRates = Object.entries(p.hit_rate_by_actual_technique)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => a[1].rate - b[1].rate);
  if (techRates.length > 0) {
    const [worstT, worstV] = techRates[0];
    patterns.push(
      `決まり手「${worstT}」の的中率が最低(${worstV.rate}%, n=${worstV.total}) — このパターンの予測が苦手`,
    );
  }

  // 非1コース決着の取りこぼし
  const nonInWins = Object.entries(p.actual_winning_course_distribution)
    .filter(([c]) => Number(c) !== 1)
    .reduce((s, [, n]) => s + n, 0);
  const nonInMiss = Object.entries(p.missed_race_actual_course_distribution)
    .filter(([c]) => Number(c) !== 1)
    .reduce((s, [, n]) => s + n, 0);
  if (nonInWins > 0) {
    patterns.push(
      `非1コース決着${nonInWins}レース中${nonInMiss}件が不的中(${pct(nonInMiss, nonInWins)}%) — アウトコースの台頭を捉えられていない`,
    );
  }

  // モデルが1コーストップ予測した不的中の割合
  const predInMiss = p.missed_race_model_predicted_top_course["1"] || 0;
  if (predInMiss > 0) {
    patterns.push(
      `不的中レースのうち${predInMiss}件(${pct(predInMiss, misses)}%)でモデルは1コース(逃げ)をトップ予測 — イン信頼が過剰`,
    );
  }

  // 風の影響
  const strongWind = p.hit_rate_by_wind.strong;
  if (
    strongWind &&
    strongWind.total >= 3 &&
    strongWind.rate < p.accuracy * 100 - 5
  ) {
    patterns.push(
      `強風時(5m以上)の的中率(${strongWind.rate}%, n=${strongWind.total})が会場平均を下回る`,
    );
  }

  return patterns;
}

// 高精度会場：成功要因を言語化
function successFactors(p) {
  const factors = [];

  if (p.venue_1course_actual_rate >= 0.55) {
    factors.push(
      `1コース実績勝率が高い(${(p.venue_1course_actual_rate * 100).toFixed(0)}%) — イン有利でモデルの逃げ予測が機能しやすい`,
    );
  }

  const inPred = p.model_in_prediction;
  if (inPred.races_model_predicted_course1_top > 0) {
    factors.push(
      `モデルが1コーストップ予測したレースの的中率(${(inPred.rate * 100).toFixed(0)}%, n=${inPred.races_model_predicted_course1_top}) — 逃げ判定の精度が高い`,
    );
  }

  const techRates = Object.entries(p.hit_rate_by_actual_technique)
    .filter(([, v]) => v.total >= 3)
    .sort((a, b) => b[1].rate - a[1].rate);
  if (techRates.length > 0) {
    const [bestT, bestV] = techRates[0];
    factors.push(
      `決まり手「${bestT}」の的中率が最高(${bestV.rate}%, n=${bestV.total})`,
    );
  }

  const nigeRate = p.hit_rate_by_actual_technique["逃げ"];
  if (nigeRate && nigeRate.total >= 5) {
    factors.push(
      `逃げ決着レースの的中率(${nigeRate.rate}%, n=${nigeRate.total}) — 決着が読みやすい`,
    );
  }

  const calmWind = p.hit_rate_by_wind.calm;
  if (calmWind && calmWind.total >= 5) {
    factors.push(
      `無風〜弱風(3m未満)のレース比率が高く的中率も安定(${calmWind.rate}%, n=${calmWind.total})`,
    );
  }

  return factors;
}

export { pct, failurePatterns, successFactors };
