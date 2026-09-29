/**
 * 会場別ルールマッチングサービス
 *
 * ルール定義（15会場・34ルール）と判定関数は src/config/venueRules.js が唯一の正本（BOA-567）。
 * 管理画面の運用成績（全体・ルール別・週別）は RPC get_admin_rule_performance に移した
 * （src/services/adminRulePerformance.js）。
 */

import { supabase } from "./supabaseClient";
import {
  VENUE_RULES_BY_VENUE as VENUE_RULES,
  VENUE_NAMES,
  ruleMatches,
} from "../config/venueRules.js";

// ========================================
// 公開関数
// ========================================

/**
 * 予測に対してマッチするルールを取得
 * @param {Object} prediction - 予測データ
 * @param {string} venueCode - 会場コード（2桁の文字列）
 * @param {number} raceNo - レース番号（1-12）
 * @returns {Array} マッチしたルールの配列
 */
export function getMatchingRules(prediction, venueCode, raceNo) {
  const rules = VENUE_RULES[venueCode];
  if (!rules) return [];

  const top3 = prediction.top3 || [
    prediction.topPick,
    prediction.top2nd,
    prediction.top3rd,
  ];
  const normalized = { ...prediction, top3 };

  const matchedRules = rules
    .filter((rule) => ruleMatches(rule, normalized, venueCode, raceNo))
    .map((rule) => ({
      id: rule.id,
      patternName: rule.patternName,
      description: rule.description,
      betType: rule.betType,
      stats: rule.stats,
      reliability: rule.reliability,
    }));

  // 回収率順にソート（高い順）
  matchedRules.sort((a, b) => b.stats.recovery - a.stats.recovery);

  return matchedRules;
}

/**
 * 賭け方の日本語名を取得
 */
export function getBetTypeName(betType) {
  // ⚠️ 命名注意: DB列名と英語名が逆転（歴史的経緯）
  //   trio → 実態: 3連複, trifecta → 実態: 3連単
  const names = {
    trio: "3連複",
    trifecta: "3連単",
    exacta: "3連単",
    win: "単勝",
    place: "複勝",
  };
  return names[betType] || betType;
}

/**
 * 信頼性レベルの日本語名を取得
 */
export function getReliabilityName(reliability) {
  const names = {
    highest: "最高",
    high: "高",
    medium: "中",
    low: "低",
  };
  return names[reliability] || reliability;
}

/**
 * ルールが登録されている会場かどうか
 */
export function hasRulesForVenue(venueCode) {
  return !!VENUE_RULES[venueCode];
}

/**
 * 会場のルール一覧を取得
 */
export function getRulesForVenue(venueCode) {
  return VENUE_RULES[venueCode] || [];
}

/**
 * 会場名を取得
 */
export function getVenueName(venueCode) {
  return VENUE_NAMES[venueCode] || `会場${venueCode}`;
}

/**
 * 今日のルールマッチレースを取得
 * @param {string} date - 日付（YYYY-MM-DD形式）
 * @returns {Promise<Array>} マッチしたレースの配列
 */
export async function getTodaysMatchingRaces(date) {
  if (!supabase) {
    console.warn("Supabaseが設定されていません");
    return [];
  }

  // 予測データを取得（standardモデルのみ）
  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select(
      "race_id, model_id, confidence, top_pick, top_2nd, top_3rd, predicted_at",
    )
    .like("race_id", `${date}-%`)
    .eq("model_id", "standard");

  if (predError) {
    console.error("予測取得エラー:", predError.message);
    return [];
  }

  if (!predictions || predictions.length === 0) {
    return [];
  }

  // 結果データを取得
  const raceIds = predictions.map((p) => p.race_id);
  const { data: results, error: resError } = await supabase
    .from("race_results")
    .select(
      "race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio",
    )
    .in("race_id", raceIds);

  const resultsMap = {};
  if (!resError && results) {
    results.forEach((r) => {
      resultsMap[r.race_id] = r;
    });
  }

  // レース情報を取得（締切時刻）
  const { data: races, error: raceError } = await supabase
    .from("races")
    .select("race_id, start_time")
    .in("race_id", raceIds);

  const racesMap = {};
  if (!raceError && races) {
    races.forEach((r) => {
      racesMap[r.race_id] = r;
    });
  }

  // ルールマッチング
  const matchedRaces = [];

  for (const pred of predictions) {
    // race_id形式: YYYY-MM-DD-XX-RR (XX=会場コード, RR=レース番号)
    const parts = pred.race_id.split("-");
    const venueCode = parts[3];
    const raceNo = parseInt(parts[4]);

    // 予測データをフロントエンド形式に変換
    const prediction = {
      confidence: pred.confidence,
      topPick: pred.top_pick,
      top3: [pred.top_pick, pred.top_2nd, pred.top_3rd],
    };

    const rules = getMatchingRules(prediction, venueCode, raceNo);

    if (rules.length > 0) {
      const result = resultsMap[pred.race_id];
      const raceInfo = racesMap[pred.race_id];

      // 的中判定
      let hitInfo = null;
      if (result) {
        const predSorted = [...prediction.top3].sort((a, b) => a - b).join("-");
        const resultSorted = [result.rank1, result.rank2, result.rank3]
          .sort((a, b) => a - b)
          .join("-");

        for (const rule of rules) {
          if (rule.betType === "trio") {
            // 3連複: 順不同で3艇を当てる（payout_trifecta）
            const isHit = predSorted === resultSorted;
            if (isHit) {
              hitInfo = { hit: true, payout: result.payout_trifecta || 0 };
              break;
            }
          } else if (rule.betType === "exacta") {
            // 3連単: 順序通りで3艇を当てる（payout_trio）
            const predExact = prediction.top3.join("-");
            const resultExact = `${result.rank1}-${result.rank2}-${result.rank3}`;
            const isHit = predExact === resultExact;
            if (isHit) {
              hitInfo = { hit: true, payout: result.payout_trio || 0 };
              break;
            }
          } else if (rule.betType === "win") {
            const isHit = prediction.topPick === result.rank1;
            if (isHit) {
              hitInfo = { hit: true, payout: result.payout_win || 0 };
              break;
            }
          } else if (rule.betType === "place") {
            const isHit =
              prediction.topPick === result.rank1 ||
              prediction.topPick === result.rank2;
            if (isHit) {
              const payout =
                prediction.topPick === result.rank1
                  ? result.payout_place_1 || 0
                  : result.payout_place_2 || 0;
              hitInfo = { hit: true, payout };
              break;
            }
          }
        }

        if (!hitInfo) {
          hitInfo = { hit: false, payout: 0 };
        }
      }

      matchedRaces.push({
        raceId: pred.race_id,
        venueCode,
        venueName: getVenueName(venueCode),
        raceNo,
        startTime: raceInfo?.start_time || null,
        prediction,
        rules,
        result: result
          ? {
              finished: true,
              rank1: result.rank1,
              rank2: result.rank2,
              rank3: result.rank3,
              payout_trifecta: result.payout_trifecta,
              payout_trio: result.payout_trio,
              payout_win: result.payout_win,
              payout_place_1: result.payout_place_1,
              payout_place_2: result.payout_place_2,
            }
          : null,
        hitInfo,
      });
    }
  }

  // レース番号順にソート
  matchedRaces.sort((a, b) => {
    if (a.venueCode !== b.venueCode) {
      return a.venueCode.localeCompare(b.venueCode);
    }
    return a.raceNo - b.raceNo;
  });

  return matchedRaces;
}

/**
 * ルールが登録されている会場のリストを取得
 */
export function getAvailableVenues() {
  return Object.keys(VENUE_RULES).map((code) => ({
    code,
    name: VENUE_NAMES[code],
  }));
}

/**
 * 会場別ルール運用成績を取得
 * @param {string} venueCode - 会場コード
 * @param {string} startDate - 運用開始日（YYYY-MM-DD形式）
 * @returns {Promise<Object>} ルール別成績と全体成績
 */
export async function getRulePerformanceByVenue(
  venueCode,
  startDate = "2026-01-16",
) {
  if (!supabase) {
    console.warn("Supabaseが設定されていません");
    return {
      byRule: [],
      total: { samples: 0, hits: 0, hitRate: 0, recovery: 0 },
      startDate,
    };
  }

  const rules = VENUE_RULES[venueCode];
  if (!rules) {
    return {
      byRule: [],
      total: { samples: 0, hits: 0, hitRate: 0, recovery: 0 },
      startDate,
    };
  }

  // 予測データを取得（クエリレベルで会場フィルタ）
  const { data: predictions, error: predError } = await supabase
    .from("predictions")
    .select(
      "race_id, model_id, confidence, top_pick, top_2nd, top_3rd, predicted_at",
    )
    .like("race_id", `%-${venueCode}-%`)
    .gte("predicted_at", startDate)
    .eq("model_id", "standard");

  if (predError || !predictions) {
    console.error("予測取得エラー:", predError?.message);
    return {
      byRule: [],
      total: { samples: 0, hits: 0, hitRate: 0, recovery: 0 },
      startDate,
    };
  }

  // 結果データを取得
  const raceIds = predictions.map((p) => p.race_id);
  if (raceIds.length === 0) {
    return {
      byRule: rules.map((r) => ({
        ruleId: r.id,
        description: r.description,
        betType: r.betType,
        samples: 0,
        hits: 0,
        hitRate: 0,
        recovery: 0,
      })),
      total: { samples: 0, hits: 0, hitRate: 0, recovery: 0 },
      startDate,
    };
  }

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

  // ルール別に集計
  const ruleStats = {};
  rules.forEach((r) => {
    ruleStats[r.id] = {
      ruleId: r.id,
      description: r.description,
      betType: r.betType,
      samples: 0,
      hits: 0,
      totalPayout: 0,
    };
  });

  // LIKEクエリは日付にもマッチする可能性があるため、JS側で会場コードを再検証
  const filteredPredictions = predictions.filter((pred) => {
    const parts = pred.race_id.split("-");
    return parts[3] === venueCode;
  });

  for (const pred of filteredPredictions) {
    const parts = pred.race_id.split("-");
    const raceNo = parseInt(parts[4]);

    const prediction = {
      confidence: pred.confidence,
      topPick: pred.top_pick,
      top3: [pred.top_pick, pred.top_2nd, pred.top_3rd],
    };

    const top3 = prediction.top3;
    const predSorted = [...top3].sort((a, b) => a - b).join("-");

    const result = resultsMap[pred.race_id];

    for (const rule of rules) {
      try {
        if (ruleMatches(rule, prediction, venueCode, raceNo)) {
          // 結果確定分のみカウント
          if (result) {
            ruleStats[rule.id].samples++;

            // 的中判定
            let isHit = false;
            let payout = 0;

            if (rule.betType === "trio") {
              // 3連複: 順不同で3艇を当てる（payout_trifecta）
              const resultSorted = [result.rank1, result.rank2, result.rank3]
                .sort((a, b) => a - b)
                .join("-");
              isHit = predSorted === resultSorted;
              payout = result.payout_trifecta || 0;
            } else if (rule.betType === "exacta") {
              // 3連単: 順序通りで3艇を当てる（payout_trio）
              const predExact = top3.join("-");
              const resultExact = `${result.rank1}-${result.rank2}-${result.rank3}`;
              isHit = predExact === resultExact;
              payout = result.payout_trio || 0;
            } else if (rule.betType === "win") {
              isHit = prediction.topPick === result.rank1;
              payout = result.payout_win || 0;
            } else if (rule.betType === "place") {
              isHit =
                prediction.topPick === result.rank1 ||
                prediction.topPick === result.rank2;
              payout =
                prediction.topPick === result.rank1
                  ? result.payout_place_1 || 0
                  : result.payout_place_2 || 0;
            }

            if (isHit) {
              ruleStats[rule.id].hits++;
              ruleStats[rule.id].totalPayout += payout;
            }
          }
        }
      } catch (e) {
        // ルールチェック中のエラーは無視
      }
    }
  }

  // 集計結果をフォーマット
  const byRule = Object.values(ruleStats).map((stat) => ({
    ruleId: stat.ruleId,
    description: stat.description,
    betType: stat.betType,
    samples: stat.samples,
    hits: stat.hits,
    hitRate:
      stat.samples > 0 ? Math.round((stat.hits / stat.samples) * 100) : 0,
    recovery:
      stat.samples > 0
        ? Math.round((stat.totalPayout / (stat.samples * 100)) * 100)
        : 0,
  }));

  // 全体集計
  const totalSamples = byRule.reduce((sum, r) => sum + r.samples, 0);
  const totalHits = byRule.reduce((sum, r) => sum + r.hits, 0);
  const totalPayout = Object.values(ruleStats).reduce(
    (sum, r) => sum + r.totalPayout,
    0,
  );

  return {
    byRule,
    total: {
      samples: totalSamples,
      hits: totalHits,
      hitRate:
        totalSamples > 0 ? Math.round((totalHits / totalSamples) * 100) : 0,
      recovery:
        totalSamples > 0
          ? Math.round((totalPayout / (totalSamples * 100)) * 100)
          : 0,
    },
    startDate,
  };
}
