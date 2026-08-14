/**
 * データ出走表11指標のデータ取得（AI予想モデル大規模改修 Task6a）
 *
 * 11指標のデータソース調査の結果（2026-08-12、src/services/supabaseDataService.js）：
 * - winRate/localWinRate/motor: generate-predictions.js が race.racers から既に取得済み
 *   （globalWinRate/localWinRate/motor2Rate）のため、ここでの取得は不要
 * - avgSt/courseRate: racer_aggregated_stats（racerStatsMap）から取得可能。
 *   generate-predictions.js の fetchRacerStats() が既に日次バッチで一括取得しているため、
 *   ここでの取得は不要（unifiedModel.js が racerStatsMap を直接参照する）
 * - st/exSt/returnRate/technique/exhibition: 4つはSupabase RPC化済み（029マイグレーション、
 *   サーバー側集計）。フロントエンドと同じRPCをそのまま呼ぶ
 * - form: RPC化されていない軽量ロジック（race_entries.win_rateの90日前比較）のみ、
 *   Node.js版として新規実装する
 */

import { supabase } from "./supabaseClient.js";

async function callRpc(rpcName, raceId) {
  const { data, error } = await supabase.rpc(rpcName, { p_race_id: raceId });
  if (error) {
    console.warn(
      `${rpcName} RPC呼び出し失敗 (race_id=${raceId}):`,
      error.message,
    );
    return [];
  }
  return Array.isArray(data) ? data : [];
}

/** ST安定性・展示ST（st/exSt指標）。src/services/supabaseDataService.js の getRaceStPredictabilityBreakdown と同じRPC */
export async function fetchStPredictability(raceId) {
  return callRpc("get_race_st_predictability", raceId);
}

/** 単勝・複勝の回収率（returnRate指標）。同 getRaceRacerBoatReturnRate と同じRPC */
export async function fetchReturnRate(raceId) {
  return callRpc("get_race_return_rate", raceId);
}

/** 決まり手プロファイル（technique指標）。同 getRaceTechniqueProfileBreakdown と同じRPC */
export async function fetchTechniqueProfile(raceId) {
  return callRpc("get_race_technique_profile", raceId);
}

/** 展示タイム推移（exhibition指標）。同 getRaceExhibitionTimeBreakdown と同じRPC */
export async function fetchExhibitionTrend(raceId) {
  return callRpc("get_race_exhibition_trend", raceId);
}

/**
 * 調子（form指標）: 現在の全国勝率と約90日前時点の全国勝率の差分。
 * src/services/supabaseDataService.js の getRaceRacerFormBreakdown をNode.js化したもの（RPC化されていない）。
 * @param {string} raceId
 * @param {Array<{boatNumber:number, racerId:string|number}>} entries - 当該レースの出走選手（枠番・racerId）
 */
export async function fetchRacerForm(raceId, entries) {
  const racerIds = [...new Set(entries.map((e) => e.racerId))].filter(
    (id) => id != null,
  );
  if (racerIds.length === 0) {
    return entries.map((e) => ({ boatNumber: e.boatNumber, delta: null }));
  }

  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
  const windowStart = new Date(ninetyDaysAgo);
  windowStart.setDate(windowStart.getDate() - 14);
  const windowStartStr = windowStart.toISOString().split("T")[0];

  const { data: current, error: curError } = await supabase
    .from("race_entries")
    .select("boat_number, racer_id, win_rate")
    .eq("race_id", raceId);
  if (curError) {
    console.warn(
      `race_entries(current)取得失敗 (race_id=${raceId}):`,
      curError.message,
    );
    return entries.map((e) => ({ boatNumber: e.boatNumber, delta: null }));
  }
  const currentByBoat = new Map(
    (current || []).map((r) => [r.boat_number, r.win_rate]),
  );

  const { data: past, error: pastError } = await supabase
    .from("race_entries")
    .select("race_id, racer_id, win_rate")
    .in("racer_id", racerIds)
    .gte("race_id", windowStartStr)
    .lte("race_id", cutoff)
    .order("race_id", { ascending: false });
  if (pastError) {
    console.warn(
      `race_entries(past)取得失敗 (race_id=${raceId}):`,
      pastError.message,
    );
  }

  // race_id降順のため、各racer_idごとに最初に出てくるものがcutoffに最も近い記録
  const pastByRacer = new Map();
  (past || []).forEach((row) => {
    if (!pastByRacer.has(row.racer_id)) {
      pastByRacer.set(row.racer_id, row.win_rate);
    }
  });

  return entries.map((e) => {
    const currentWinRate = currentByBoat.get(e.boatNumber);
    const pastWinRate = pastByRacer.get(e.racerId) ?? null;
    const delta =
      pastWinRate !== null && currentWinRate != null
        ? currentWinRate - pastWinRate
        : null;
    return { boatNumber: e.boatNumber, delta };
  });
}

/**
 * 1レース分の指標データをまとめて取得する（RPC4種 + form）。
 * generate-predictions.js のレース単位ループから呼び出す想定。
 *
 * ⚠️ 意図的に直列実行にしている（2026-08-13判明）: Promise.allで5つを並行実行すると、
 * 日次バッチのように多数のレースを連続処理する際にNode.jsのHTTP接続プールが枯渇し、
 * 数レース処理後に完全に停止する不具合が発生した（generate-unified-trifecta-reference.js
 * の実行が9レース目で無期限にハングする形で顕在化）。直列実行に変更することで解消した。
 */
export async function fetchRaceIndicatorData(raceId, entries) {
  const stPredictability = await fetchStPredictability(raceId);
  const returnRate = await fetchReturnRate(raceId);
  const techniqueProfile = await fetchTechniqueProfile(raceId);
  const exhibitionTrend = await fetchExhibitionTrend(raceId);
  const racerForm = await fetchRacerForm(raceId, entries);
  return {
    stPredictability,
    returnRate,
    techniqueProfile,
    exhibitionTrend,
    racerForm,
  };
}
