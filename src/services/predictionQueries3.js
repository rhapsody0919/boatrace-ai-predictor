// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: prediction）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { EDGE_API_BASE, withCache } from "./core.js";

/**
 * 精度統計データを取得（summary.json形式で返す）
 */
export async function getAccuracy() {
    // 精度データは日1回更新のため24時間キャッシュ（Edge CDNと合わせる）
    const ACCURACY_TTL = 24 * 60 * 60 * 1000;
    return withCache(
      "accuracy",
      fetchAccuracyUncached,
      ACCURACY_TTL,
    ); // withCache end
  }

// getAccuracy のキャッシュ未命中時の本体（Edge → Supabase 直接の順）
async function fetchAccuracyUncached() {
  // Phase D: まずEdge APIを試行（CDNキャッシュ活用）
  const edgeData = await tryFetchEdgeAccuracy();
  if (edgeData) return edgeData;

  // フォールバック: 従来のSupabase直接クエリ
  if (!supabase) {
    console.error("Supabase client not initialized");
    return { lastUpdated: null, models: {} };
  }

  const { jstNow, thisYear, thisMonth, thisMonthStart, thisMonthEnd } =
    calcThisMonthRange();

  // モデル情報を取得
  const models = await fetchModelsInfo();

  const monthsToFetch = buildMonthsToFetch(thisYear, thisMonth);

  const [thisMonthPredictions, monthlyResults, recentPredictions, allPredictions] =
    await fetchPredictionSets(
      jstNow,
      thisMonthStart,
      thisMonthEnd,
      monthsToFetch,
    );

  const monthlyPredictionsMap = buildMonthlyPredictionsMap(
    monthsToFetch,
    monthlyResults,
  );

  // 先月のデータ（互換性のため）
  const lastMonthKey = `${monthsToFetch[0].year}-${String(monthsToFetch[0].month).padStart(2, "0")}`;
  const lastMonthPredictions =
    monthlyPredictionsMap[lastMonthKey]?.predictions || [];

  const modelStats = buildModelStats({
    models,
    thisMonthPredictions,
    lastMonthPredictions,
    recentPredictions,
    allPredictions,
    monthlyPredictionsMap,
    thisYear,
    thisMonth,
    lastMonth: monthsToFetch[0],
  });

  const volatilityStats = await fetchVolatilityStats();

  return {
    lastUpdated: new Date().toISOString(),
    volatilityStats,
    models: modelStats,
  };
}

// Edge API から精度データを取得。取れなければ null（呼び手が直接クエリへ落とす）
async function tryFetchEdgeAccuracy() {
  try {
    const edgeResponse = await fetch(`${EDGE_API_BASE}/api/accuracy`);
    if (edgeResponse.ok) {
      const edgeData = await edgeResponse.json();
      if (edgeData.models) {
        console.log("[getAccuracy] Edge API success");
        return edgeData;
      }
    }
  } catch (edgeError) {
    console.log(
      "[getAccuracy] Edge API failed, falling back to direct query:",
      edgeError.message,
    );
  }
  return null;
}

function calcThisMonthRange() {
  // 今月の日付範囲を計算
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
  const thisYear = jstNow.getUTCFullYear();
  const thisMonth = jstNow.getUTCMonth() + 1;
  const thisMonthStart = `${thisYear}-${String(thisMonth).padStart(2, "0")}-01`;
  const thisMonthEnd = `${thisYear}-${String(thisMonth).padStart(2, "0")}-31`;
  return { jstNow, thisYear, thisMonth, thisMonthStart, thisMonthEnd };
}

async function fetchModelsInfo() {
  const { data: models } = await supabase
    .from("models")
    .select(
      "model_id, display_name, total_predictions, hit_rate_win, hit_rate_place, hit_rate_trifecta, hit_rate_trio, recovery_rate_win, recovery_rate_place, recovery_rate_trifecta, recovery_rate_trio",
    );
  return models;
}

// ページネーション付きでデータを取得するヘルパー関数
// race_id形式: YYYY-MM-DD-VV-RR なので、endDateには末尾を追加して正しく比較
const fetchAllPredictions = async (startDate, endDate) => {
  let allData = [];
  let from = 0;
  const pageSize = 1000;

  // endDateをrace_id形式で比較できるよう調整（例: 2025-12-31 → 2025-12-31-99-99）
  const adjustedEndDate = endDate ? `${endDate}-99-99` : null;

  while (true) {
    let query = supabase
      .from("predictions")
      .select(
        "race_id, model_id, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio, payout_win, payout_place, payout_trifecta, payout_trio",
      )
      .gte("race_id", startDate)
      .not("is_hit_win", "is", null)
      .range(from, from + pageSize - 1);

    if (adjustedEndDate) {
      query = query.lte("race_id", adjustedEndDate);
    }

    const { data: page } = await query;

    if (!page || page.length === 0) break;
    allData = allData.concat(page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return allData;
};

// 過去6ヶ月分の月別データを取得するためのヘルパー
const getMonthRange = (year, month) => {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-31`;
  return { start, end, year, month };
};

const getPreviousMonth = (year, month) => {
  if (month === 1) {
    return { year: year - 1, month: 12 };
  }
  return { year, month: month - 1 };
};

function buildMonthsToFetch(thisYear, thisMonth) {
  // 過去6ヶ月分の月情報を生成
  const monthsToFetch = [];
  let currentYear = thisYear;
  let currentMonth = thisMonth;

  for (let i = 0; i < 6; i++) {
    const prev = getPreviousMonth(currentYear, currentMonth);
    currentYear = prev.year;
    currentMonth = prev.month;
    monthsToFetch.push(getMonthRange(currentYear, currentMonth));
  }
  return monthsToFetch;
}

// 今月・過去6ヶ月・直近7日・直近90日の予測を並列取得（戻りは [今月, 月別, 7日, 90日]）
function fetchPredictionSets(
  jstNow,
  thisMonthStart,
  thisMonthEnd,
  monthsToFetch,
) {
  // 過去7日分・過去90日分の開始日
  const sevenDaysAgo = new Date(
    jstNow.getTime() - 7 * 24 * 60 * 60 * 1000,
  );
  const sevenDaysAgoStr = sevenDaysAgo.toISOString().split("T")[0];

  const ninetyDaysAgo = new Date(
    jstNow.getTime() - 90 * 24 * 60 * 60 * 1000,
  );
  const ninetyDaysAgoStr = ninetyDaysAgo.toISOString().split("T")[0];

  // 2026-08-15修正（BOA-193）: 以下9件のfetchAllPredictions呼び出しは互いに
  // 独立したデータ取得なのに直列awaitされており、predictionsテーブルの
  // 行数増加に伴って/accuracyの応答が数十秒〜1分以上に悪化していた。
  // Promise.allで並列化し、体感速度を「合計時間」から「最長1件分の時間」に短縮する
  return Promise.all([
    fetchAllPredictions(thisMonthStart, thisMonthEnd),
    Promise.all(
      monthsToFetch.map((monthInfo) =>
        fetchAllPredictions(monthInfo.start, monthInfo.end),
      ),
    ),
    fetchAllPredictions(sevenDaysAgoStr, null),
    fetchAllPredictions(ninetyDaysAgoStr, null),
  ]);
}

function buildMonthlyPredictionsMap(monthsToFetch, monthlyResults) {
  // 各月の予測データをマップ化
  const monthlyPredictionsMap = {};
  monthsToFetch.forEach((monthInfo, i) => {
    const key = `${monthInfo.year}-${String(monthInfo.month).padStart(2, "0")}`;
    monthlyPredictionsMap[key] = {
      predictions: monthlyResults[i],
      year: monthInfo.year,
      month: monthInfo.month,
    };
  });
  return monthlyPredictionsMap;
}

// race_idから日付を抽出するヘルパー関数
const extractDate = (raceId) => raceId.substring(0, 10);

// race_idから会場コードを抽出するヘルパー関数 (YYYY-MM-DD-VV-RR形式)
const extractVenueCode = (raceId) =>
  parseInt(raceId.substring(11, 13), 10);

// 統計を計算する関数
const calculateStats = (predictions) => {
  if (!predictions || predictions.length === 0) {
    return {
      totalRaces: 0,
      topPickHitRate: 0,
      topPickPlaceRate: 0,
      top3HitRate: 0,
      top3IncludedRate: 0,
      actualRecovery: {
        win: { recoveryRate: 0 },
        place: { recoveryRate: 0 },
        trifecta: { recoveryRate: 0 },
        trio: { recoveryRate: 0 },
      },
    };
  }

  const total = predictions.length;
  const winHits = predictions.filter((p) => p.is_hit_win).length;
  const placeHits = predictions.filter((p) => p.is_hit_place).length;
  const trifectaHits = predictions.filter(
    (p) => p.is_hit_trifecta,
  ).length;
  const trioHits = predictions.filter((p) => p.is_hit_trio).length;

  const winPayout = predictions.reduce(
    (sum, p) => sum + (p.payout_win || 0),
    0,
  );
  const placePayout = predictions.reduce(
    (sum, p) => sum + (p.payout_place || 0),
    0,
  );
  const trifectaPayout = predictions.reduce(
    (sum, p) => sum + (p.payout_trifecta || 0),
    0,
  );
  const trioPayout = predictions.reduce(
    (sum, p) => sum + (p.payout_trio || 0),
    0,
  );

  return {
    totalRaces: total,
    topPickHitRate: winHits / total,
    topPickPlaceRate: placeHits / total,
    top3HitRate: trifectaHits / total,
    top3IncludedRate: trioHits / total,
    actualRecovery: {
      win: { recoveryRate: winPayout / (total * 100) },
      place: { recoveryRate: placePayout / (total * 100) },
      trifecta: { recoveryRate: trifectaPayout / (total * 100) },
      trio: { recoveryRate: trioPayout / (total * 100) },
    },
  };
};

// 日別履歴を計算する関数
const calculateDailyHistory = (predictions, modelId) => {
  const modelPreds =
    predictions?.filter((p) => p.model_id === modelId) || [];
  const dateMap = new Map();

  for (const pred of modelPreds) {
    const date = extractDate(pred.race_id);
    if (!dateMap.has(date)) {
      dateMap.set(date, []);
    }
    dateMap.get(date).push(pred);
  }

  return Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, preds]) => ({
      date,
      ...calculateStats(preds),
    }));
};

// 会場別統計を計算する関数
const calculateByVenue = (predictions, modelId) => {
  const modelPreds =
    predictions?.filter((p) => p.model_id === modelId) || [];
  const venueMap = new Map();

  for (const pred of modelPreds) {
    const venueCode = extractVenueCode(pred.race_id);
    if (!venueMap.has(venueCode)) {
      venueMap.set(venueCode, []);
    }
    venueMap.get(venueCode).push(pred);
  }

  const byVenue = {};
  for (const [venueCode, preds] of venueMap) {
    byVenue[venueCode] = {
      overall: calculateStats(preds),
    };
  }

  return byVenue;
};

// 各モデルの統計を構築
function buildModelStats(src) {
  const modelStats = {};
  const modelIds = ["standard", "safeBet", "upsetFocus"];

  for (const modelId of modelIds) {
    modelStats[modelId] = buildOneModelStats(modelId, src);
  }
  return modelStats;
}

function buildOneModelStats(modelId, src) {
  const modelInfo = src.models?.find((m) => m.model_id === modelId);
  const thisMonthPreds =
    src.thisMonthPredictions?.filter((p) => p.model_id === modelId) || [];
  const thisMonthStats = calculateStats(thisMonthPreds);
  const lastMonthPreds =
    src.lastMonthPredictions?.filter((p) => p.model_id === modelId) || [];
  const lastMonthStats = calculateStats(lastMonthPreds);
  const dailyHistory = calculateDailyHistory(
    src.recentPredictions,
    modelId,
  );
  const byVenue = calculateByVenue(src.allPredictions, modelId);

  const monthlyHistory = buildMonthlyHistory(
    src.monthlyPredictionsMap,
    modelId,
  );

  return {
    overall: buildOverall(modelInfo),
    thisMonth: {
      year: src.thisYear,
      month: src.thisMonth,
      ...thisMonthStats,
    },
    lastMonth: {
      year: src.lastMonth.year,
      month: src.lastMonth.month,
      ...lastMonthStats,
    },
    monthlyHistory,
    dailyHistory,
    byVenue,
  };
}

function buildMonthlyHistory(monthlyPredictionsMap, modelId) {
  // 月別履歴を構築（過去6ヶ月分）
  return Object.entries(monthlyPredictionsMap)
    .map(([, data]) => {
      const monthPreds =
        data.predictions?.filter((p) => p.model_id === modelId) || [];
      const stats = calculateStats(monthPreds);
      return {
        year: data.year,
        month: data.month,
        ...stats,
      };
    })
    .filter((m) => m.totalRaces > 0)
    .sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
}

function buildOverall(modelInfo) {
  return {
    totalRaces: modelInfo?.total_predictions || 0,
    finishedRaces: modelInfo?.total_predictions || 0,
    topPickHitRate: modelInfo?.hit_rate_win || 0,
    topPickPlaceRate: modelInfo?.hit_rate_place || 0,
    top3HitRate: modelInfo?.hit_rate_trifecta || 0,
    top3ExactHitRate: modelInfo?.hit_rate_trio || 0,
    actualRecovery: buildOverallRecovery(modelInfo),
  };
}

function buildOverallRecovery(modelInfo) {
  return {
    win: { recoveryRate: modelInfo?.recovery_rate_win || 0 },
    place: { recoveryRate: modelInfo?.recovery_rate_place || 0 },
    trifecta: {
      recoveryRate: modelInfo?.recovery_rate_trifecta || 0,
    },
    trio: { recoveryRate: modelInfo?.recovery_rate_trio || 0 },
  };
}

// accuracy_cache から volatilityStats を取得（フォールバックパスでも表示できるよう）
async function fetchVolatilityStats() {
  let volatilityStats = null;
  try {
    const { data: cacheRow } = await supabase
      .from("accuracy_cache")
      .select("data")
      .eq("key", "accuracy_summary")
      .single();
    volatilityStats = cacheRow?.data?.volatilityStats ?? null;
  } catch {
    // 取得失敗時は非表示のまま
  }
  return volatilityStats;
}

/**
 * unifiedモデルの実測精度（複勝的中率・回収率、展開的中率）を取得する（BOA-179関連）
 * scripts/daily/calculate-unified-model-accuracy.js が日次で accuracy_cache に
 * 保存した集計値を読むだけなので軽量。AIデータ分析の複勝予想/展開予測カードで
 * 「過去の実測実績」を動的に表示するために使う
 */
export function getUnifiedModelAccuracy() {
    return withCache(
      "unified-model-accuracy",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }
        const { data } = await supabase
          .from("accuracy_cache")
          .select("data")
          .eq("key", "unified_model_accuracy")
          .single();

        return data?.data ?? null;
      },
      6 * 60 * 60 * 1000, // 6時間キャッシュ（日次バッチでしか更新されないため長め）
    );
  }
