// 1レース分の予想の組み立て部品（展開予測の入力・モデルごとの予想・本命の理由・結果欄の初期値）。
// scripts/daily/generate-predictions.js の generateRacePrediction・generateTopPickReasoning から元のまま移した（純関数）。

// 展開予測パターンの1着・2着・3着からtop3を取得
export function getTop3FromPattern(pattern) {
  if (!pattern) return null;
  const first = pattern.winnerCourse;

  // 2着: secondPlaceの最大確率コース（1着除外）
  let second = null,
    maxSecond = 0;
  for (const [c, p] of Object.entries(pattern.secondPlace || {})) {
    if (Number(c) !== first && p > maxSecond) {
      maxSecond = p;
      second = Number(c);
    }
  }

  // 3着: thirdPlaceの最大確率コース（1着・2着除外）
  let third = null,
    maxThird = 0;
  for (const [c, p] of Object.entries(pattern.thirdPlace || {})) {
    if (Number(c) !== first && Number(c) !== second && p > maxThird) {
      maxThird = p;
      third = Number(c);
    }
  }

  if (!second || !third) return null;
  return [first, second, third];
}

// 信頼度を計算（トップピックのAIスコアと2位のAIスコアの差から算出）
export function calculateConfidence(players) {
  if (players.length < 2) return 70;

  const scoreDiff = players[0].aiScore - players[1].aiScore;
  // スコア差が大きいほど信頼度が高い（70-95%の範囲）
  const confidence = Math.min(
    95,
    Math.max(70, 70 + Math.floor(scoreDiff / 10)),
  );
  return confidence;
}

// レースIDを生成
export function generateRaceId(date, placeCd, raceNo) {
  return `${date}-${String(placeCd).padStart(2, "0")}-${String(raceNo).padStart(2, "0")}`;
}

// 本命選手の選定理由を生成（モデルごとの強みの列は、standard・safe-bet・upset-focus の各関数が作る）
export function standardPickStrengths(pick, { winRate, localWinRate, motor2Rate }) {
  const strengths = [];
  if (winRate >= 6.5) {
    strengths.push(`全国勝率${pick.winRate}の実力者`);
  }
  if (localWinRate >= 5.5) {
    strengths.push(`当地成績${pick.localWinRate}と好相性`);
  }
  if (motor2Rate >= 35) {
    strengths.push(
      `モーター2連率${motor2Rate.toFixed(1)}%の${motor2Rate >= 40 ? "好" : "安定"}機材`,
    );
  }
  return strengths;
}

export function safeBetPickStrengths(pick, { number, winRate }) {
  const strengths = [];
  if (number === 1) {
    strengths.push("1号艇の有利なコース取り");
  }
  if (pick.grade === "A1") {
    strengths.push("A1級選手として安定した実力");
  } else if (pick.grade === "A2") {
    strengths.push("A2級選手として堅実な実績");
  }
  if (winRate >= 6.0) {
    strengths.push(`全国勝率${pick.winRate}の高い実力`);
  }
  return strengths;
}

export function upsetFocusPickStrengths(pick, { number, localWinRate, motor2Rate }) {
  const strengths = [];
  if (number >= 4 && motor2Rate >= 38) {
    strengths.push(
      `${number}号艇ながらモーター2連率${motor2Rate.toFixed(1)}%の好機材`,
    );
  }
  if (localWinRate >= 5.5) {
    strengths.push(`当地成績${pick.localWinRate}で展開に期待`);
  }
  if (motor2Rate >= 40) {
    strengths.push("好モーターを活かした高配当の可能性");
  }
  return strengths;
}

export function generateTopPickReasoning(topPickPlayer, players, modelType) {
  const reasons = [];
  const profile = {
    number: topPickPlayer.number,
    winRate: parseFloat(topPickPlayer.winRate),
    localWinRate: parseFloat(topPickPlayer.localWinRate),
    motor2Rate: parseFloat(topPickPlayer.motor2Rate),
  };
  const headline = `${profile.number}号艇 ${topPickPlayer.name}選手を本命に選定`;

  if (modelType === "standard") {
    // スタンダード：バランス重視
    reasons.push(headline);

    const strengths = standardPickStrengths(topPickPlayer, profile);

    if (strengths.length > 0) {
      reasons.push(strengths.join("、") + "で総合評価が最高");
    } else {
      reasons.push("総合的なデータ分析により最高評価を獲得");
    }
  } else if (modelType === "safe-bet") {
    // 本命狙い：安全性重視
    reasons.push(headline);

    const strengths = safeBetPickStrengths(topPickPlayer, profile);

    if (strengths.length > 0) {
      reasons.push(strengths.join("、") + "により的中率が期待できる");
    } else {
      reasons.push("安全性を重視した評価で最高スコアを獲得");
    }
  } else if (modelType === "upset-focus") {
    // 穴狙い：高配当重視
    reasons.push(headline);

    const strengths = upsetFocusPickStrengths(topPickPlayer, profile);

    if (strengths.length > 0) {
      reasons.push(strengths.join("、"));
    } else {
      reasons.push("展開の妙と機材性能を重視した評価で最高スコア");
    }
  }

  return reasons;
}

/** 1マーク展開予測の入力（選手ごと）。枠番=進入コース（デフォルト） */
export function buildTurnPredictionPlayers(race, racerStatsMap) {
  return race.racers.map((racer) => {
    const exhibitionEntry = race.exhibitionData?.find(
      (e) => e.boatNumber === racer.lane,
    );
    const stats = racerStatsMap?.get(racer.racerId) || null;
    return {
      boatNumber: racer.lane,
      course: racer.lane, // 枠番=進入コース（デフォルト）
      exhibitionST: exhibitionEntry?.startTiming ?? null,
      avgST: stats?.avg_st ?? null,
      stStddev: stats?.st_stddev ?? null,
      attackDistribution: stats?.attack_distribution || null,
      defenseDistribution: stats?.defense_distribution || null,
      courseRaceCounts: stats?.course_race_counts || null,
      exhibitionTime: exhibitionEntry?.exhibitionTime ?? null,
      motor2Rate: racer.motor2Rate || null,
      globalWinRate: racer.globalWinRate || null,
      global2Rate: racer.global2Rate || null,
      localWinRate: racer.localWinRate || null,
      local2Rate: racer.local2Rate || null,
      grade: racer.grade || null,
    };
  });
}

/**
 * 1モデル分の予想（本命・3連単の上位3艇・信頼度・選手・理由）。展開予測パターンの top3 があればそれを使い、
 * 無ければ AI スコア順の上位を使う
 */
export function buildModelPrediction(players, turn, modelType) {
  const topPick = turn ? turn[0] : players[0].number;
  const top3 = turn || players.slice(0, 3).map((p) => p.number);
  const confidence = calculateConfidence(players);
  const topPlayer = players.find((p) => p.number === topPick) || players[0];
  const reasoning = generateTopPickReasoning(topPlayer, players, modelType);
  return { topPick, top3, confidence, players, reasoning };
}

/** 天候情報（race_conditionsテーブル用） */
export function buildRaceConditionsInfo(race) {
  return {
    weather: race.weather || null,
    airTemp: race.airTemp ?? null,
    windDirection: race.windDirection ?? null,
    windVelocity: race.windVelocity ?? null,
    waterTemp: race.waterTemp ?? null,
    waveHeight: race.waveHeight ?? null,
    raceGrade: race.raceGrade || null,
    raceTitle: race.raceTitle || null,
    raceStage: race.raceStage || null,
  };
}

/** 1マーク展開予測の要約 */
export function buildTurnPredictionSummary(turnPrediction) {
  return {
    technique: turnPrediction.technique,
    probability: turnPrediction.probability,
    winnerCourse: turnPrediction.winnerCourse,
    distribution: turnPrediction.distribution,
    patterns: turnPrediction.patterns || null,
    boatStrengths: turnPrediction.boatStrengths || null,
  };
}

/** 超展開データ（攻守の実績データ） */
export function buildRacerStatsSummary(turnPredictionPlayers) {
  return turnPredictionPlayers.map((p) => ({
    boatNumber: p.boatNumber,
    course: p.course,
    avgST: p.avgST,
    attackDistribution: p.attackDistribution,
    defenseDistribution: p.defenseDistribution,
    courseRaceCounts: p.courseRaceCounts,
  }));
}

/** 発走前の結果欄・的中欄の初期値（未確定） */
export function initialRaceOutcome() {
  return {
    result: {
      finished: false,
      rank1: null,
      rank2: null,
      rank3: null,
      updatedAt: null,
    },
    accuracy: {
      topPickHit: null,
      top3Hit: null,
      top3Included: null,
    },
  };
}

/**
 * 1レース分の予想の組み立て（generateRacePrediction の後半）。展開予測パターンをモデルにマッピングし、
 * 3モデルの予想・天候・荒れ度・展開予測・超展開データ・結果欄を1つの object にまとめる。
 */
export function assembleRacePrediction(
  race,
  date,
  turnPrediction,
  turnPredictionPlayers,
  volatility,
  { standardPlayers, safeBetPlayers, upsetFocusPlayers },
) {
  // 展開予測パターンをモデルにマッピング
  // patterns[0]（最高確率）→ safeBet（本命狙い）
  // patterns[1]（2番目）  → standard（スタンダード）
  // patterns[2]（3番目）  → upsetFocus（穴狙い）
  const patterns = turnPrediction?.patterns || [];
  const safeBetTurn = getTop3FromPattern(patterns[0] || null);
  const standardTurn = getTop3FromPattern(patterns[1] || null);
  const upsetFocusTurn = getTop3FromPattern(patterns[2] || null);

  // 本命狙い版（展開予測パターン1）・スタンダード版（パターン2）・穴狙い版（パターン3）の予想
  const safeBet = buildModelPrediction(safeBetPlayers, safeBetTurn, "safe-bet");
  const standard = buildModelPrediction(
    standardPlayers,
    standardTurn,
    "standard",
  );
  const upsetFocus = buildModelPrediction(
    upsetFocusPlayers,
    upsetFocusTurn,
    "upset-focus",
  );

  return {
    raceId: generateRaceId(date, race.placeCd, race.raceNo),
    venue: race.placeName,
    venueCode: race.placeCd,
    raceNumber: race.raceNo,
    startTime: race.startTime || "未定",

    // 天候情報（race_conditionsテーブル用）
    conditions: buildRaceConditionsInfo(race),

    // 荒れ度情報
    volatility,

    // 3モデルの予想
    predictions: { standard, safeBet, upsetFocus },

    // 1マーク展開予測
    turnPrediction: buildTurnPredictionSummary(turnPrediction),

    // 超展開データ（攻守の実績データ）
    racerStats: buildRacerStatsSummary(turnPredictionPlayers),

    // 後方互換性のため（既存のpredictionフィールドを維持）
    prediction: { ...standard },

    // 展示データ（exhibition_data upsert用）
    exhibitionData: race.exhibitionData || null,

    // 結果欄・的中欄（未確定）
    ...initialRaceOutcome(),
  };
}
