// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: venue）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { venueWaterProfile } from "../data/venueWaterProfiles.js";
import {
  nationalWinRateByBoat,
  groupWinningTechniqueRows,
} from "../utils/venuePlaceRates.js";
import { EDGE_API_BASE, withCache } from "./core.js";

/**
 * 会場の決まり手の直近90日・365日の件数（BOA-430 思考アシスト、ADR 0088、表 venue_technique_period_stats）。
 * 毎日のスクリプト（update-winning-technique-stats.js）が書く。取得の失敗（表が無い等）は投げる。
 * 0行（書き込み前・書き直しの途中）は空の配列で返し、キャッシュに残さない（次の表示で取り直す）
 * @returns {Promise<Array<{period_days: 90|365, winning_technique: string, race_count: number, total_races: number, period_from: string, period_to: string, last_updated: string}>>}
 */
export function getVenueTechniquePeriodStats(venueCode) {
    const code = Number(venueCode);
    return withCache(
      `venue-technique-period-${code}`,
      async () => {
        const { data } = await supabase
          .from("venue_technique_period_stats")
          .select(
            "period_days, winning_technique, race_count, total_races, period_from, period_to, last_updated",
          )
          .eq("venue_code", code)
          .order("period_days")
          .order("winning_technique");
        return data ?? [];
      },
      undefined,
      (rows) => rows.length > 0,
    );
  }

/**
 * 会場固有の水面特性（水質・干満差・イン/アウト傾向のクラスタ分類）を取得する
 * 水質・干満差は公式の場データを写した src/data/venueWaterProfiles.js を使う。
 * venues.water_type は初期データが7会場で公式と食い違っていた（唐津を海水とする等）ため
 * 画面には出さない。cluster は venues から読む（update_venue_stats が直近90日の
 * 1号艇1着率で毎日決める龍神の分類で、公式の分類ではない）
 * @param {number} venueCode - 会場コード（1-24）
 * @returns {Promise<{ waterType: string|null, tidal: boolean|null, cluster: string } | null>}
 */
export function getVenueCharacteristics(venueCode) {
    // v2: 水質を公式の値に直し tidal を足した（古い形の localStorage を読まない）
    return withCache(`venue-characteristics-v2-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data } = await supabase
        .from("venues")
        .select("cluster")
        .eq("code", venueCode)
        .maybeSingle();

      if (!data) return null;

      const water = venueWaterProfile(venueCode);
      return {
        waterType: water?.waterType ?? null,
        tidal: water?.tidal ?? null,
        cluster: data.cluster,
      };
    });
  }

/**
 * 枠番別の1着率の全国平均（24会場プール値）を取得する
 * outcome_distributionは会場ごとの行を持つが、first_boatでgroup byして
 * count_90daysを合算すれば1クエリで全国平均が算出できる（24会場を
 * 個別に取得する必要はない）。会場を問わず同じ値のためracer_id等と
 * 違い引数を取らず、キャッシュキーも固定にする
 */
export function getNationalAverageOutcomeDistribution() {
    return withCache("national-average-outcome-distribution", async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // outcome_distributionは2500行超あり、Supabaseのデフォルトlimit(1000行)を
      // 超えるため.range()でページネーションして全件取得する必要がある
      // （2026-09-07、ページネーション漏れで全国平均が偏っていたバグを発見・修正）
      const data = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data: page } = await supabase
          .from("outcome_distribution")
          .select("first_boat, count_90days")
          .range(from, from + pageSize - 1);

        if (!page || page.length === 0) break;
        data.push(...page);
        if (page.length < pageSize) break;
        from += pageSize;
      }
      // 計算は全貌動画の材料（fetch-materials.mjs）と共通の純関数（src/utils/venuePlaceRates.js）
      return nationalWinRateByBoat(data);
    });
  }

// VENUE_NAMES マッピング
const OUTCOME_VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
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

function emptyOutcomeDistribution(venueCode) {
  return {
    venue_code: venueCode,
    venue_name: "",
    total_races: 0,
    last_updated: null,
    data: {},
  };
}

// Phase 1: Edge API を試行（CDNキャッシュ活用）。失敗・不正は null
async function fetchOutcomeDistributionFromEdge(venueCode) {
  try {
    const edgeResponse = await fetch(
      `${EDGE_API_BASE}/api/outcome-distribution?venue_code=${venueCode}`,
    );
    if (edgeResponse.ok) {
      const edgeData = await edgeResponse.json();
      if (edgeData.venue_code) {
        console.log("[getOutcomeDistribution] Edge API success");
        return edgeData;
      }
    }
  } catch (edgeError) {
    console.log(
      "[getOutcomeDistribution] Edge API failed, falling back:",
      edgeError.message,
    );
  }
  return null;
}

// 1着別にグループ化
function groupOutcomeRows(venueCode, data) {
  const outcomesData = {};
  let totalRaces = 0;
  let lastUpdated = null;

  data.forEach((row) => {
    const firstBoat = row.first_boat;
    if (!outcomesData[firstBoat]) {
      outcomesData[firstBoat] = [];
    }

    outcomesData[firstBoat].push({
      second_boat: row.second_boat,
      third_boat: row.third_boat,
      count: row.count_90days,
      probability: row.probability,
      avg_payout: row.avg_payout,
    });

    if (!totalRaces) {
      totalRaces = row.total_races;
      lastUpdated = row.last_updated;
    }
  });

  return {
    venue_code: venueCode,
    venue_name: OUTCOME_VENUE_NAMES[venueCode] || "",
    total_races: totalRaces,
    last_updated: lastUpdated,
    data: outcomesData,
  };
}

/**
 * 出目分布データを取得（会場別の3連単パターン）
 * @param {number} venueCode - 会場コード（1-24）
 * @returns {Promise<Object>} - { venue_code, venue_name, total_races, last_updated, data: { first_boat: [...] } }
 */
export function getOutcomeDistribution(venueCode) {
    return withCache(`outcome-distribution-${venueCode}`, async () => {
      const edgeData = await fetchOutcomeDistributionFromEdge(venueCode);
      if (edgeData) return edgeData;

      // フォールバック: Supabase 直接クエリ
      if (!supabase) {
        console.error("Supabase client not initialized");
        return emptyOutcomeDistribution(venueCode);
      }

      const { data } = await supabase
        .from("outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (!data || data.length === 0) {
        return emptyOutcomeDistribution(venueCode);
      }

      return groupOutcomeRows(venueCode, data);
    });
  }

/**
 * 会場別・枠番別の決まり手（逃げ/差し/まくり等）出現割合を取得する（BOA-150）
 * v1ではEdge API連携は行わず、Supabase直接クエリのみ
 */
export function getWinningTechniqueStats(venueCode) {
    return withCache(`winning-technique-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      const { data } = await supabase
        .from("winning_technique_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number")
        .order("percentage", { ascending: false });

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          last_updated: null,
          data: {},
        };
      }

      // 枠番別にグループ化（全貌動画の材料 fetch-materials.mjs と共通の純関数）
      const { last_updated: lastUpdated, data: techniqueData } =
        groupWinningTechniqueRows(data);

      const VENUE_NAMES = {
        1: "桐生",
        2: "戸田",
        3: "江戸川",
        4: "平和島",
        5: "多摩川",
        6: "浜名湖",
        7: "蒲郡",
        8: "常滑",
        9: "津",
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

      return {
        venue_code: venueCode,
        venue_name: VENUE_NAMES[venueCode] || "",
        last_updated: lastUpdated,
        data: techniqueData,
      };
    });
  }

/**
 * 全選手の同じコースの1着率（national、直近3期）と、会場の同じコースの1着率（venue、当地）
 * （BOA-1290、マイグレーション 199 の RPC get_course_win_rate_baseline）。
 * 6艇の想定コース別成績（docs/design/course-grid-six-boats/spec.md §1.1）の「差」と「平均の値」に使う。
 *
 * - national: racer_period_stats の calc_to < raceDate の新しい3期、出走のある全選手の Σc{n}_p1 ÷ Σc{n}_entries
 * - venue: 実進入コースで、その会場の [raceDate − 730日, raceDate) の1着率。venueCode が null なら venue も null
 * - winRate は百分率。entries が0のコースは null（0% にしない）
 *
 * 取得の失敗（関数が未適用の PGRST202 を含む）は例外で返す。0 や null の平均に化けさせない
 * （.claude/rules/frontend-data-fetch.md §2）。
 *
 * @param {string} raceDate YYYY-MM-DD（レースの日。この日に終わる期・この日のレースは入らない）
 * @param {number|null} venueCode 1〜24、または null（当地の値が要らないとき）
 * @returns {Promise<{
 *   terms: Array<{calc_from: string, calc_to: string}>,
 *   national: Record<string, {wins: number, entries: number, winRate: number|null}>,
 *   venue: {venueCode: number, from: string|null, to: string|null,
 *     byCourse: Record<string, {wins: number, entries: number, winRate: number|null}>} | null
 * }>}
 */
export function getCourseWinRateBaseline(raceDate, venueCode) {
    if (typeof raceDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raceDate)) {
      return Promise.reject(
        new Error(
          `getCourseWinRateBaseline: raceDate が YYYY-MM-DD ではない: ${raceDate}`,
        ),
      );
    }
    const venue =
      venueCode === null || venueCode === undefined ? null : Number(venueCode);
    if (
      venue !== null &&
      !(Number.isInteger(venue) && venue >= 1 && venue <= 24)
    ) {
      return Promise.reject(
        new Error(
          `getCourseWinRateBaseline: venueCode が 1〜24 ではない: ${venueCode}`,
        ),
      );
    }
    return withCache(
      `course-win-rate-baseline-v1-${raceDate}-${venue ?? "none"}`,
      async () => {
        if (!supabase) throw new Error("Supabase client not initialized");
        const { data } = await supabase.rpc("get_course_win_rate_baseline", {
          p_race_date: raceDate,
          p_venue_code: venue,
        });
        if (
          data === null ||
          typeof data !== "object" ||
          !Array.isArray(data.terms) ||
          data.national === null ||
          typeof data.national !== "object"
        ) {
          throw new Error(
            "get_course_win_rate_baseline の返り値の形が違う（terms・national が無い）",
          );
        }
        return data;
      },
    );
  }
