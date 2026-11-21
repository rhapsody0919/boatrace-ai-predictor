import {
  categorizeWinRate,
  categorizeMotor,
  categorizeConfidence,
} from "./collectVenueStatsMath.js";

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

export { createVenueStats, createAccumulator, collectPrediction };
