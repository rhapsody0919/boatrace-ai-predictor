/**
 * 管理者向けルール分析サービス
 * 履歴取得（運用成績の集計は adminRulePerformance.js → RPC get_admin_rule_performance、BOA-567）
 */

import { supabase } from "./supabaseClient";
import {
  getMatchingRules,
  getBetTypeName,
  getVenueName,
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

  // 終了日の翌日（race_id文字列比較用）
  const endDateNext = new Date(endDate);
  endDateNext.setDate(endDateNext.getDate() + 1);
  const endDateNextStr = `${endDateNext.getFullYear()}-${String(endDateNext.getMonth() + 1).padStart(2, "0")}-${String(endDateNext.getDate()).padStart(2, "0")}`;

  // 予測データを取得（race_idで日付範囲フィルタ）
  // race_id形式: YYYY-MM-DD-venueCode-raceNo
  // supabase クライアントは throwOnError 既定（src/services/supabaseClient.js）のため、
  // 取得失敗はここで例外になる。BOA-676以前はここをtry/catchで囲い、
  // 失敗を { data: [], total: 0 }（=「対象期間に履歴なし」）に化けさせていた
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

  if (!predictions || predictions.length === 0) {
    return { data: [], total: 0 };
  }

  // 結果データを取得
  const raceIds = predictions.map((p) => p.race_id);
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

  // ルールマッチング & フラット化
  const historyItems = [];

  for (const pred of predictions) {
    const parts = pred.race_id.split("-");
    const date = `${parts[0]}-${parts[1]}-${parts[2]}`;
    const venueCode = parts[3];
    const raceNo = parseInt(parts[4]);

    const prediction = {
      confidence: pred.confidence,
      topPick: pred.top_pick,
      top3: [pred.top_pick, pred.top_2nd, pred.top_3rd],
    };

    const rules = getMatchingRules(prediction, venueCode, raceNo);
    if (rules.length === 0) continue;

    const result = resultsMap[pred.race_id];
    const predSorted = [...prediction.top3].sort((a, b) => a - b).join("-");

    for (const rule of rules) {
      let isHit = false;
      let payout = 0;

      if (result) {
        const resultSorted = [result.rank1, result.rank2, result.rank3]
          .sort((a, b) => a - b)
          .join("-");

        if (rule.betType === "trio") {
          isHit = predSorted === resultSorted;
          if (isHit) payout = result.payout_trifecta || 0;
        } else if (rule.betType === "exacta") {
          const predExact = prediction.top3.join("-");
          const resultExact = `${result.rank1}-${result.rank2}-${result.rank3}`;
          isHit = predExact === resultExact;
          if (isHit) payout = result.payout_trio || 0;
        } else if (rule.betType === "win") {
          isHit = prediction.topPick === result.rank1;
          if (isHit) payout = result.payout_win || 0;
        } else if (rule.betType === "place") {
          isHit =
            prediction.topPick === result.rank1 ||
            prediction.topPick === result.rank2;
          if (isHit) {
            payout =
              prediction.topPick === result.rank1
                ? result.payout_place_1 || 0
                : result.payout_place_2 || 0;
          }
        }
      }

      historyItems.push({
        raceId: pred.race_id,
        date,
        venueCode,
        venueName: VENUE_NAMES[venueCode] || `会場${venueCode}`,
        raceNo,
        ruleId: rule.id,
        betType: rule.betType,
        prediction: prediction.top3.join("-"),
        result: result
          ? `${result.rank1}-${result.rank2}-${result.rank3}`
          : null,
        isHit,
        payout,
      });
    }
  }

  // totalはルール適用数を返す（予測データ数ではない）
  // 注: ページネーションは予測データベースで行われるため、
  // totalは現在のページのルール適用数のみ反映
  return { data: historyItems, total: historyItems.length };
}
