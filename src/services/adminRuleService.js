/**
 * 管理者向けルール分析サービス
 * 履歴取得（運用成績の集計は adminRulePerformance.js → RPC get_admin_rule_performance、BOA-567）
 */

import { supabase } from "./supabaseClient";
import {
  getMatchingRules,
} from "./ruleMatchService";

// 会場コードから会場名への変換（ローカル定義）
const VENUE_NAMES = {
  "01": "桐生",
  "02": "戸田",
  "03": "江戸川",
  "04": "平和島",
  "05": "多摩川",
  "06": "浜名湖",
  "07": "蒲郡",
  "08": "常滑",
  "09": "津",
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

// 終了日の翌日（race_id文字列比較用）
function nextDayString(endDate) {
  const endDateNext = new Date(endDate);
  endDateNext.setDate(endDateNext.getDate() + 1);
  return `${endDateNext.getFullYear()}-${String(endDateNext.getMonth() + 1).padStart(2, "0")}-${String(endDateNext.getDate()).padStart(2, "0")}`;
}

// 予測データを取得（race_idで日付範囲フィルタ）
// race_id形式: YYYY-MM-DD-venueCode-raceNo
// supabase クライアントは throwOnError 既定（src/services/supabaseClient.js）のため、
// 取得失敗はここで例外になる。BOA-676以前はここをtry/catchで囲い、
// 失敗を { data: [], total: 0 }（=「対象期間に履歴なし」）に化けさせていた
async function fetchPredictions(startDate, endDateNextStr, limit, offset) {
  const { data: predictions } = await supabase
    .from("predictions")
    .select(
      "race_id, model_id, confidence, top_pick, top_2nd, top_3rd, predicted_at",
      { count: "exact" },
    )
    .gte("race_id", startDate)
    .lt("race_id", endDateNextStr)
    .eq("model_id", "standard")
    .order("race_id", { ascending: false })
    .range(offset, offset + limit - 1);
  return predictions;
}

// 結果データを取得
async function fetchResultsMap(raceIds) {
  const { data: results } = await supabase
    .from("race_results")
    .select(
      "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio",
    )
    .in("race_id", raceIds);

  const resultsMap = {};
  if (results) {
    results.forEach((r) => {
      resultsMap[r.race_id] = r;
    });
  }
  return resultsMap;
}

// 賭け式ごとの的中判定と払戻（出力は { isHit, payout }）
const BET_JUDGES = {
  trio(prediction, result) {
    const predSorted = [...prediction.top3].sort((a, b) => a - b).join("-");
    const resultSorted = [result.rank1, result.rank2, result.rank3]
      .sort((a, b) => a - b)
      .join("-");
    const isHit = predSorted === resultSorted;
    return { isHit, payout: isHit ? result.payout_trifecta || 0 : 0 };
  },
  exacta(prediction, result) {
    const predExact = prediction.top3.join("-");
    const resultExact = `${result.rank1}-${result.rank2}-${result.rank3}`;
    const isHit = predExact === resultExact;
    return { isHit, payout: isHit ? result.payout_trio || 0 : 0 };
  },
  win(prediction, result) {
    const isHit = prediction.topPick === result.rank1;
    return { isHit, payout: isHit ? result.payout_win || 0 : 0 };
  },
  place(prediction, result) {
    const isHit =
      prediction.topPick === result.rank1 ||
      prediction.topPick === result.rank2;
    let payout = 0;
    if (isHit) {
      payout =
        prediction.topPick === result.rank1
          ? result.payout_place_1 || 0
          : result.payout_place_2 || 0;
    }
    return { isHit, payout };
  },
};

function judgeBet(rule, prediction, result) {
  const judge = result ? BET_JUDGES[rule.betType] : undefined;
  return judge ? judge(prediction, result) : { isHit: false, payout: 0 };
}

// 1予測 × 1ルール → 履歴1行
function buildHistoryItem(pred, rule, prediction, result, race) {
  const { isHit, payout } = judgeBet(rule, prediction, result);
  return {
    raceId: pred.race_id,
    date: race.date,
    venueCode: race.venueCode,
    venueName: VENUE_NAMES[race.venueCode] || `会場${race.venueCode}`,
    raceNo: race.raceNo,
    ruleId: rule.id,
    betType: rule.betType,
    prediction: prediction.top3.join("-"),
    result: result ? `${result.rank1}-${result.rank2}-${result.rank3}` : null,
    isHit,
    payout,
  };
}

// 1予測 → マッチしたルールごとの履歴行
function buildItemsForPrediction(pred, result) {
  const parts = pred.race_id.split("-");
  const race = {
    date: `${parts[0]}-${parts[1]}-${parts[2]}`,
    venueCode: parts[3],
    raceNo: parseInt(parts[4]),
  };

  const prediction = {
    confidence: pred.confidence,
    topPick: pred.top_pick,
    top3: [pred.top_pick, pred.top_2nd, pred.top_3rd],
  };

  const rules = getMatchingRules(prediction, race.venueCode, race.raceNo);
  return rules.map((rule) =>
    buildHistoryItem(pred, rule, prediction, result, race),
  );
}

/**
 * ルール適用履歴を取得（日付範囲指定）
 * @param {string} startDate - 開始日 (YYYY-MM-DD)
 * @param {string} endDate - 終了日 (YYYY-MM-DD)
 * @param {number} limit - 取得件数
 * @param {number} offset - オフセット
 * @returns {Promise<{data: Array, total: number}>}
 */
export async function getRuleApplicationHistory(
  startDate,
  endDate,
  limit = 50,
  offset = 0,
) {
  if (!supabase) {
    console.warn("Supabaseが設定されていません");
    return { data: [], total: 0 };
  }

  const predictions = await fetchPredictions(
    startDate,
    nextDayString(endDate),
    limit,
    offset,
  );

  if (!predictions || predictions.length === 0) {
    return { data: [], total: 0 };
  }

  const resultsMap = await fetchResultsMap(predictions.map((p) => p.race_id));

  // ルールマッチング & フラット化
  const historyItems = predictions.flatMap((pred) =>
    buildItemsForPrediction(pred, resultsMap[pred.race_id]),
  );

  // totalはルール適用数を返す（予測データ数ではない）
  // 注: ページネーションは予測データベースで行われるため、
  // totalは現在のページのルール適用数のみ反映
  return { data: historyItems, total: historyItems.length };
}
