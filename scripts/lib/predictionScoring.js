// 予想のスコア計算（3モデルの選手スコア・展開予測ボーナス・展示データボーナス）。scripts/daily/generate-predictions.js から元のまま移した。

// 展開予測ボーナスの1着分（1着コースが boatLane のときだけ。モデルごとの係数）
export function turnWinnerBonus(pattern, prob, modelType) {
  switch (modelType) {
    case "standard":
      return prob * 300;
    case "safeBet":
      return prob * (pattern.technique === "nige" ? 500 : 150);
    case "upsetFocus":
      return prob * (pattern.technique === "nige" ? 100 : 400);
  }
  return 0;
}

// 展開予測ボーナスを計算
export function calculateTurnBonus(turnResult, boatLane, modelType) {
  if (!turnResult?.patterns) return 0;
  let bonus = 0;
  for (const pattern of turnResult.patterns) {
    const prob = pattern.probability;

    // 1着ボーナス
    if (pattern.winnerCourse === boatLane) {
      bonus += turnWinnerBonus(pattern, prob, modelType);
    }

    // 2着ボーナス
    const secondProb = pattern.secondPlace?.[boatLane] || 0;
    if (secondProb > 0) {
      const w = { standard: 150, safeBet: 200, upsetFocus: 100 }[modelType];
      bonus += prob * secondProb * w;
    }

    // 3着ボーナス（実データで6号艇の3着率が15%以上あるため係数を引き上げ）
    const thirdProb = pattern.thirdPlace?.[boatLane] || 0;
    if (thirdProb > 0) {
      const w = { standard: 150, safeBet: 180, upsetFocus: 120 }[modelType];
      bonus += prob * thirdProb * w;
    }
  }
  return Math.round(bonus);
}

// 展示データボーナスを計算
export function calculateExhibitionBonus(exhibitionEntry, avgExTime, modelType) {
  if (!exhibitionEntry) return 0;
  let bonus = 0;

  // 展示タイム（速い = 良いモーター/セッティング）
  if (exhibitionEntry.exhibitionTime && avgExTime) {
    const diff = avgExTime - exhibitionEntry.exhibitionTime;
    const weight = { standard: 50, safeBet: 30, upsetFocus: 80 }[modelType];
    bonus += diff * weight;
  }

  // 展示ST（速い = スタート力）
  if (exhibitionEntry.startTiming != null) {
    const stBonus = Math.max(0, 0.18 - exhibitionEntry.startTiming) * 100;
    const weight = { standard: 40, safeBet: 25, upsetFocus: 60 }[modelType];
    bonus += stBonus * weight;
  }

  return Math.round(bonus);
}

// スタンダードv2版AIスコア（統計的に最適化）
// 統計分析（2,172レース）に基づく係数:
// - 枠番の影響: 22倍差（最重要）
// - 全国勝率の影響: 10倍差（非常に重要）
// - 級別の影響: 5倍差（重要）
// - モーター性能: 5.2%差（限定的）
// - 当地成績: 3.7%差（限定的）
export function calculateStandardScoreV2(
  racer,
  index,
  turnResult,
  exEntry,
  avgExTime,
) {
  let score = 0;

  // 全国勝率（最重要: 10倍の差がある）
  score += racer.globalWinRate * 150;

  // 級別ボーナス（非常に重要: A1はB2の5倍勝ちやすい）
  if (racer.grade === "A1") score += 400;
  else if (racer.grade === "A2") score += 250;
  else if (racer.grade === "B1") score += 100;
  else if (racer.grade === "B2") score += 0;

  // 枠番補正（1着率ベース: 1号艇57% / 6号艇3%、ただし入着率は6号艇25%あるためペナルティを緩和）
  if (index === 0)
    score += 500; // 1号艇
  else if (index === 1)
    score += 100; // 2号艇
  else if (index === 2)
    score += 0; // 3号艇
  else if (index === 3)
    score -= 50; // 4号艇
  else if (index === 4)
    score -= 100; // 5号艇
  else if (index === 5) score -= 70; // 6号艇（入着率25%を考慮して-150→-70に緩和）

  // モーター性能（限定的: 5.2%の差）
  score += racer.motor2Rate * 20;

  // ボート性能（限定的: データ不足）
  score += racer.boat2Rate * 10;

  // 当地アドバンテージ（限定的: 3.7%の差）
  const localAdvantage = racer.localWinRate - racer.globalWinRate;
  score += localAdvantage * 10;

  // 展開予測ボーナス
  score += calculateTurnBonus(turnResult, racer.lane, "standard");

  // 展示データボーナス
  score += calculateExhibitionBonus(exEntry, avgExTime, "standard");

  return Math.floor(score);
}

// 本命狙い版スコア（堅実型）
export function calculateSafeBetScore(racer, index, turnResult, exEntry, avgExTime) {
  let score = 0;

  // 1号艇に大きなボーナス
  if (index === 0) score += 150;

  // A1級に大きなボーナス
  if (racer.grade === "A1") score += 120;
  else if (racer.grade === "A2") score += 60;

  // 全国勝率を重視
  score += racer.globalWinRate * 130;

  // 当地勝率
  score += racer.localWinRate * 80;

  // モーター性能（やや控えめ）
  score += racer.motor2Rate * 40;

  // レーン位置ペナルティ（強め）
  score -= index * 15;

  // 展開予測ボーナス
  score += calculateTurnBonus(turnResult, racer.lane, "safeBet");

  // 展示データボーナス
  score += calculateExhibitionBonus(exEntry, avgExTime, "safeBet");

  return Math.floor(score);
}

// 穴狙い版スコア（高配当型）
export function calculateUpsetFocusScore(
  racer,
  index,
  turnResult,
  exEntry,
  avgExTime,
) {
  let score = 0;

  // 外枠の逆転要素を重視
  if (index >= 3) score += 100; // 4-6号艇にボーナス

  // モーター性能を最重視（機材で逆転）
  score += racer.motor2Rate * 180;

  // ボート性能
  score += racer.boat2Rate * 80;

  // 当地適性（地元の利）
  score += racer.localWinRate * 100;
  score += racer.local2Rate * 60;

  // 全国勝率（やや控えめ）
  score += racer.globalWinRate * 50;

  // 1号艇へのペナルティ（逆張り）
  if (index === 0) score -= 100;

  // 展開予測ボーナス
  score += calculateTurnBonus(turnResult, racer.lane, "upsetFocus");

  // 展示データボーナス
  score += calculateExhibitionBonus(exEntry, avgExTime, "upsetFocus");

  return Math.floor(score);
}

// 選手データを処理（特定のスコア計算関数を使用）
export function processRacersWithScoreFn(
  racers,
  scoreFn,
  turnResult,
  exhibitionData,
) {
  if (!racers || racers.length === 0) {
    console.warn("⚠️  選手データが空です");
    return [];
  }

  // 展示タイム平均を計算
  let avgExTime = null;
  if (exhibitionData && exhibitionData.length > 0) {
    const exTimes = exhibitionData
      .filter((e) => e.exhibitionTime != null)
      .map((e) => e.exhibitionTime);
    if (exTimes.length > 0) {
      avgExTime = exTimes.reduce((s, v) => s + v, 0) / exTimes.length;
    }
  }

  const players = racers.map((racer, idx) => {
    const exEntry =
      exhibitionData?.find((e) => e.boatNumber === racer.lane) || null;
    return {
      number: racer.lane,
      racerId: racer.racerId || null,
      name: racer.name,
      grade: racer.grade,
      age: racer.age,
      winRate: racer.globalWinRate.toFixed(3),
      localWinRate: racer.localWinRate.toFixed(3),
      // 2連率・3連率は公式の出走表と同じ小数2桁で持つ（BOA-829）。以前は小数1桁に丸めており、朝の初期化から
      // 発走60分前の取得で上書きされるまで、race_entries に丸めた値（公式 33.05 → 33.0）が入っていた。
      // 龍神ソナー・思考アシストの朝の計算（出走表の時点）も丸めた値を読んでいた。表示の桁は画面側が決める
      global2Rate: racer.global2Rate?.toFixed(2) || null,
      local2Rate: racer.local2Rate?.toFixed(2) || null,
      global3Rate: racer.global3Rate?.toFixed(2) || null,
      local3Rate: racer.local3Rate?.toFixed(2) || null,
      motorNumber: racer.motorNumber,
      motor2Rate: racer.motor2Rate.toFixed(2),
      motor3Rate: racer.motor3Rate?.toFixed(2) || null,
      boatNumber: racer.boatNumber,
      boat2Rate: racer.boat2Rate.toFixed(2),
      boat3Rate: racer.boat3Rate?.toFixed(2) || null,
      // F数・L数（BOA-590。朝の初期化の出走表から。無ければ undefined のまま＝書かない）
      fCount: racer.fCount,
      lCount: racer.lCount,
      aiScore: scoreFn(racer, idx, turnResult, exEntry, avgExTime),
    };
  });

  // AIスコア順にソート
  return players.sort((a, b) => b.aiScore - a.aiScore);
}

/** 3つのモデル（standard・safeBet・upsetFocus）それぞれの選手のスコアと並び（展開予測・展示データを反映） */
export function scoreRacersByModel(race, turnPrediction) {
  const standardPlayers = processRacersWithScoreFn(
    race.racers,
    calculateStandardScoreV2,
    turnPrediction,
    race.exhibitionData,
  );
  const safeBetPlayers = processRacersWithScoreFn(
    race.racers,
    calculateSafeBetScore,
    turnPrediction,
    race.exhibitionData,
  );
  const upsetFocusPlayers = processRacersWithScoreFn(
    race.racers,
    calculateUpsetFocusScore,
    turnPrediction,
    race.exhibitionData,
  );
  return { standardPlayers, safeBetPlayers, upsetFocusPlayers };
}
