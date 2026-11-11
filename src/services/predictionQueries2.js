// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: prediction）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { toWakuRacerStats } from "../utils/racerStats.js";
import { EDGE_API_BASE, fetchVenueWinRateMap, withCache } from "./core.js";
import {
  VENUE_NAMES,
  buildFetchFailedPredictions,
  buildRaceResult,
  generateReasoning,
} from "./predictionQueries.js";

/**
 * Edge APIレスポンスをフロント期待形式に変換
 * Edge API(RPC)とSupabase直接クエリの構造差異を吸収する
 */
function transformEdgeResponse(edgeData, date, venueWinRateMap = {}) {
  const transformedRaces = (edgeData.races || []).map((race) => {
    const entries = race.entries || [];
    const predictions = race.predictions || {};

    // players配列を作成（艇番順。廃止した3モデルの点 aiScore は /api が返さないので持たない。BOA-1110）
    const createPlayers = () =>
      entries.map((e) => ({
        number: e.number,
        name: e.name,
        racerId: e.racerId ?? null,
        grade: e.grade,
        age: e.age,
        winRate: String(e.winRate || ""),
        localWinRate: String(e.localWinRate || ""),
        global2Rate: e.global2Rate != null ? String(e.global2Rate) : null,
        motorNumber: e.motorNumber,
        motor2Rate: String(e.motor2Rate || ""),
        boatNumber: e.boatNumber,
        boat2Rate: String(e.boat2Rate || ""),
      }));

    // turnPrediction を取得（standardの予測に含まれる）
    const stdPred = predictions.standard;
    const rawTurn = stdPred?.turnPrediction || null;
    const turnPrediction = rawTurn
      ? {
          ...rawTurn,
          patterns: rawTurn.patterns || [
            {
              technique: rawTurn.technique,
              winnerCourse: rawTurn.winnerCourse,
              probability: rawTurn.probability,
            },
          ],
        }
      : null;

    const raceData = {
      raceId: race.raceId,
      venue:
        race.venue || VENUE_NAMES[race.venueCode] || `会場${race.venueCode}`,
      venueCode: race.venueCode,
      raceNumber: race.raceNumber,
      startTime: race.startTime || "",
      cancellationStatus: race.cancellationStatus ?? null,
      raceGrade: race.raceGrade ?? null,
      raceTitle: race.raceTitle ?? null,
      seriesDay: race.seriesDay ?? null,
      isFinalDay: race.isFinalDay ?? null,
      raceStage: race.raceStage ?? null,
      // 直前情報タブの気象カード用（BOA-304）。get_predictions_by_date/_light RPC
      // （066マイグレーション）が UI 用の形で既に組み立てて返すため、そのまま渡すだけでよい
      // （Edge API が失敗したときも同じ RPC を直接呼ぶ。BOA-355）
      weather: race.weather ?? null,
      // BOA-822 イン崩れ注意度（RPC 157。unified の feature_contributions.inCaution をそのまま）。
      // 画面は raceData.unified からは読まず、この値だけを読む。157 の適用前・値が無いレースは null
      inCaution: race.inCaution ?? null,
      volatility: race.volatility
        ? {
            ...race.volatility,
            venueWinRate: venueWinRateMap[race.venueCode] ?? null,
          }
        : null,
      turnPrediction,
      racerStats: toWakuRacerStats(stdPred?.racerStats),
      exhibitionData:
        race.exhibitionData?.map((ed) => ({
          boat_number: ed.boatNumber,
          exhibition_time: ed.exhibitionTime,
          start_timing: ed.startTiming,
        })) || null,
      // モデル非依存の選手一覧（race_entriesから直接構築、DataRaceTable等がunifiedモデルの
      // predictions行が無い過去日付でも表示できるようにするため）
      players: createPlayers(),
    };

    // 予測データ（モデル別）
    raceData.predictions = {};
    for (const [modelId, pred] of Object.entries(predictions)) {
      if (!pred) continue;
      // 廃止した3モデルの点（aiScoreStandard/SafeBet/UpsetFocus）は /api/predictions が返さない（BOA-1110）。
      // RPC 直のフォールバックでも同じ形にするため、ここでも読まない（aiScore=0、並びは艇番順のまま）
      const players = createPlayers();
      const topPickPlayer = players.find((p) => p.number === pred.topPick);
      raceData.predictions[modelId] = {
        topPick: pred.topPick,
        top3: pred.top3 || [pred.topPick],
        confidence: Number(pred.confidence) || 0,
        players,
        reasoning: generateReasoning(topPickPlayer, modelId),
      };
    }

    // unifiedモデル（AI予想モデル大規模改修）: turnPrediction/volatilityPercentile/reasonsは
    // 019マイグレーション時点でturnPredictionのみRPCから汎用的に取得できていたが、
    // volatilityPercentile/volatilityReasonsは031マイグレーション未適用の間はundefinedになる
    // （docs/db-migration/031_add_unified_fields_to_predictions_rpc.sql参照、SUPABASE_ACCESS_TOKEN
    // 失効中のため2026-08-13時点で未適用。適用後はEdge API経由でも取得できるようになる）
    const unifiedRaw = predictions.unified;
    if (unifiedRaw) {
      const rawUnifiedTurn = unifiedRaw.turnPrediction || null;
      raceData.unified = {
        topPick: unifiedRaw.topPick,
        top2nd: unifiedRaw.top3?.[1] ?? null,
        players: raceData.predictions.unified?.players || [],
        turnPrediction: rawUnifiedTurn
          ? {
              ...rawUnifiedTurn,
              patterns: rawUnifiedTurn.patterns || [
                {
                  technique: rawUnifiedTurn.technique,
                  winnerCourse: rawUnifiedTurn.winnerCourse,
                  probability: rawUnifiedTurn.probability,
                },
              ],
            }
          : null,
        volatilityPercentile: unifiedRaw.volatilityPercentile ?? null,
        volatilityPercentileIsFallback:
          unifiedRaw.volatilityPercentileIsFallback ?? null,
        volatilityReasons: unifiedRaw.volatilityReasons || [],
      };
    }

    // 結果データ（051マイグレーションでresultのjson_build_objectに追加したキーは
    // 既にcamelCaseのためbuildRaceResult()にそのまま渡せる）
    raceData.result = buildRaceResult(race.result);

    return raceData;
  });

  return {
    date,
    generatedAt: edgeData.generatedAt || new Date().toISOString(),
    updatedAt: edgeData.updatedAt || new Date().toISOString(),
    races: transformedRaces,
  };
}

/**
 * 予測データを取得（predictions/YYYY-MM-DD.json形式で返す）
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */
export async function getPredictions(date, { light = false } = {}) {
    const cacheKey = light
      ? `predictions-light-${date}`
      : `predictions-${date}`;
    return withCache(cacheKey, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      const lightParam = light ? "?light=true" : "";
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/predictions/${date}${lightParam}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.races && edgeData.races.length > 0) {
            console.log(
              `[getPredictions] Edge API success: ${edgeData.races.length} races${light ? " (light)" : ""}`,
            );
            // Edge APIはvenuesテーブルをjoinしないためvenueWinRateを別途取得
            const venueWinRateMap = await fetchVenueWinRateMap();
            return transformEdgeResponse(edgeData, date, venueWinRateMap);
          }
        }
      } catch (edgeError) {
        console.log(
          "[getPredictions] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: Edge API と同じ RPC を Supabase へ直接呼び、同じ transformEdgeResponse で整形する。
      // 以前は別実装のネストクエリで、RPCとの二重実装が乖離し、片方にだけ項目が入る不具合が
      // 繰り返された（BOA-304・BOA-254・BOA-114）。経路が違っても、出力は1つの実装から作る（BOA-355）
      if (!supabase) {
        console.error("Supabase client not initialized");
        return buildFetchFailedPredictions(date);
      }
      try {
        const rpcName = light
          ? "get_predictions_by_date_light"
          : "get_predictions_by_date";
        const { data: rpcData } = await supabase.rpc(rpcName, {
          target_date: date,
        });
        const venueWinRateMap = await fetchVenueWinRateMap();
        return transformEdgeResponse(rpcData ?? {}, date, venueWinRateMap);
      } catch (rpcError) {
        console.error("[getPredictions] RPC直接呼び出しエラー:", rpcError);
        return buildFetchFailedPredictions(date);
      }
    }); // withCache end
  }
