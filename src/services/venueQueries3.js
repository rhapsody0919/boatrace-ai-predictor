// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: venue）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isPermissionDeniedError, withCache } from "./core.js";

/**
 * 逃げシミュレーション（この会場で1コースが逃げたときの2着コース分布）を
 * 取得する（phase a FR-6、ADR-0068）。会場別・5行だけ。
 *
 * 既存の getNigeOutcomeDistribution（027、艇番基準・90日・3連単粒度）とは
 * 粒度も期間も違う別物（あちらはBOA-158の「逃げ成功時分布」タブが使用中）。
 */
export function getNigeSimulation(venueCode) {
    return withCache(`nige-simulation-v1-${venueCode}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      try {
        const { data } = await supabase
          .from("nige_second_by_course")
          .select(
            "venue_code, second_course, window_start, window_end, window_days, total_races, nige_races, second_count, second_rate, exacta_rate",
          )
          .eq("venue_code", venueCode)
          .order("second_course");
        return data ?? [];
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          return { state: "forbidden", rows: [], fetchFailed: true };
        }
        throw error;
      }
    });
  }

/**
 * 逃げ成功時（winning_technique='逃げ'）の複勝分布を取得する（BOA-158）
 * 既存のgetOutcomeDistributionと対になるが、テーブル・集計とも分離されている
 */
export function getNigeOutcomeDistribution(venueCode) {
    return withCache(`nige-outcome-distribution-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

      const { data } = await supabase
        .from("nige_outcome_distribution")
        .select("*")
        .eq("venue_code", venueCode)
        .order("first_boat")
        .order("count_90days", { ascending: false });

      if (!data || data.length === 0) {
        return {
          venue_code: venueCode,
          venue_name: "",
          total_races: 0,
          last_updated: null,
          data: {},
        };
      }

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
        total_races: totalRaces,
        last_updated: lastUpdated,
        data: outcomesData,
      };
    });
  }

/**
 * 会場別・枠番別の展示タイム最速実績（回数/確率、最速時の1着率）を取得する（BOA-160）
 * 日次バッチ（scripts/daily/update-exhibition-time-top-stats.js）で事前集計したテーブルを参照する
 */
export function getExhibitionTimeTopStats(venueCode) {
    return withCache(`exhibition-time-top-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data } = await supabase
        .from("exhibition_time_top_stats")
        .select("*")
        .eq("venue_code", venueCode)
        .order("boat_number");

      return {
        venue_code: venueCode,
        last_updated: data?.[0]?.last_updated ?? null,
        data: data ?? [],
      };
    });
  }

/**
 * 指定会場の「グレード×艇番」横断統計を取得する（BOA-263）
 * scripts/daily/calculate-venue-grade-stats.jsが日次バッチで事前集計した
 * venue_grade_boat_statsテーブルを読むだけ（全会場横断のためライブ集計はしない。
 * BOA-267のコードレビューで指摘された「全会場集計は必ずバッチ事前集計する」
 * という既存規約に最初から従っている）。boat_number=0はレース全体（艇番非依存）
 * の集計行を表すセンチネル値
 */
export function getVenueGradeBoatStats(venueCode) {
    return withCache(`venue-grade-boat-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }
      const { data } = await supabase
        .from("venue_grade_boat_stats")
        .select(
          "race_grade, boat_number, race_count, wins, top2, top3, technique_breakdown, manshu_count, payout_count, payout_trio_sum",
        )
        .eq("venue_code", venueCode);
      return data ?? [];
    });
  }

/**
 * 会場×グレード統計データを保持する全会場のコード一覧を取得する（BOA-263）
 * venue_grade_boat_statsに1件でも行がある会場のみを選択肢として提示するため
 */
export function getVenuesWithGradeStats() {
    return withCache("venues-with-grade-stats", async () => {
      if (!supabase) return [];
      const { data } = await supabase
        .from("venue_grade_boat_stats")
        .select("venue_code");
      return [...new Set((data ?? []).map((r) => r.venue_code))].sort(
        (a, b) => a - b,
      );
    });
  }
