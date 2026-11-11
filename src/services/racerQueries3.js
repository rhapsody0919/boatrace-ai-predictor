// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: racer）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { stDeviation } from "../utils/stDeviation.js";
import { isNoRaceResult } from "../utils/raceResultUsable.js";
import { toReturnRate } from "../utils/racerVenueBoatStats.js";
import { fetchAllByIn, withCache } from "./core.js";

/**
 * 指定選手の過去180日間の枠番別回収率を取得する（選手個人ページ用）
 * getRaceRacerBoatReturnRateと同じ集計ロジック（racer_id+boat_numberキー）を
 * racer_id単体向けに転用したもの。対象が1選手のみのためRPC化は不要
 */
export function getRacerBoatReturnRate(racerId) {
    return withCache(`racer-boat-return-rate-v2-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const { data: entries } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (!entries || entries.length === 0) {
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, race_status",
        "race_id",
        raceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // boat_numberごとに集計（同じ選手でも枠番が違えば別集計）
      const statsByBoat = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || isNoRaceResult(result)) return;

        if (!statsByBoat.has(e.boat_number)) {
          statsByBoat.set(e.boat_number, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByBoat.get(e.boat_number);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return [...statsByBoat.entries()]
        .map(([boatNumber, stats]) => ({
          boat_number: boatNumber,
          sample_count: stats.sampleCount,
          win_return_rate: toReturnRate(stats.winPayoutSum, stats.sampleCount),
          place_return_rate: toReturnRate(
            stats.placePayoutSum,
            stats.sampleCount,
          ),
        }))
        .sort((a, b) => a.boat_number - b.boat_number);
    });
  }

/**
 * 指定選手の展示ST/本番STのズレの推移を取得する（BOA-153）
 * フライングは異常値のため除外。同日複数レースは平均してグラフ用に日付単位でまとめる
 */
export function getStDeviationTrend(racerId) {
    return withCache(`st-deviation-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (!pastEntries || pastEntries.length === 0) {
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      // race_id 1件につき最大6艇分の行があるため.range()ページネーションで全件取得する
      const [actualRows, exhibitionRows] = await Promise.all([
        fetchAllByIn(
          "race_start_timings",
          "race_id, boat_number, start_timing, is_flying",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, start_timing",
          "race_id",
          raceIds,
        ),
      ]);

      const actualByKey = new Map();
      actualRows.forEach((r) => {
        if (r.is_flying) return;
        actualByKey.set(`${r.race_id}-${r.boat_number}`, r.start_timing);
      });

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.start_timing);
      });

      // 日付単位で当日の平均ズレをまとめる
      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const actual = actualByKey.get(key);
          const exhibition = exhibitionByKey.get(key);
          // 欠場艇の行（ST が NULL）・展示STの無い走は比べない（stDeviation が null）
          const deviation = stDeviation(actual, exhibition);
          if (deviation === null) return;
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(deviation);
        });

      const trend = [...byDate.entries()].map(([date, deviations]) => ({
        date,
        avg_deviation:
          deviations.reduce((sum, d) => sum + d, 0) / deviations.length,
      }));

      return { racer_id: racerId, trend };
    });
  }

/**
 * 指定選手の展示タイム（周回展示の2周目の150mのタイム）の推移を取得する（BOA-164）
 * 同日複数レースは平均してグラフ用に日付単位でまとめる
 */
export function getExhibitionTimeTrend(racerId) {
    return withCache(`exhibition-time-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr)
        .order("race_id");

      if (!pastEntries || pastEntries.length === 0) {
        return { racer_id: racerId, trend: [] };
      }

      const raceIds = pastEntries.map((e) => e.race_id);

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        raceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const byDate = new Map();
      pastEntries
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .sort((a, b) => a.race_date.localeCompare(b.race_date))
        .forEach((e) => {
          const key = `${e.race_id}-${e.boat_number}`;
          const time = exhibitionByKey.get(key);
          if (time === undefined || time === null) return;

          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, []);
          }
          byDate.get(e.race_date).push(time);
        });

      const trend = [...byDate.entries()].map(([date, times]) => ({
        date,
        avg_exhibition_time:
          times.reduce((sum, t) => sum + t, 0) / times.length,
      }));

      return { racer_id: racerId, trend };
    });
  }

/**
 * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
 * 急上昇/急下降ランキングを作成する（BOA-166）
 * 会場・レース単位の選手調子（BOA-152）とは異なり、レース選択前の発見導線として
 * 本日カード全体を横断する
 */
export function getTodaysRacerFormRanking(limit = 10) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(
      `todays-racer-form-ranking-${today}-${limit}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { rising: [], falling: [] };
        }

        const { data: races } = await supabase
          .from("races")
          .select("race_id, venue_code, race_number")
          .eq("race_date", today);

        if (!races || races.length === 0) {
          return { rising: [], falling: [] };
        }

        const raceMetaByRaceId = new Map(races.map((r) => [r.race_id, r]));
        const raceIds = races.map((r) => r.race_id);

        const entries = await fetchAllByIn(
          "race_entries",
          "race_id, boat_number, player_name, racer_id, win_rate",
          "race_id",
          raceIds,
        );

        // 同じ選手が本日複数レースに出走することは無いはずだが、念のためracer_idごとに最初の1件のみ採用
        const currentByRacer = new Map();
        entries.forEach((e) => {
          if (e.racer_id === null || e.win_rate === null) return;
          if (!currentByRacer.has(e.racer_id))
            currentByRacer.set(e.racer_id, e);
        });

        if (currentByRacer.size === 0) return { rising: [], falling: [] };

        // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
        const windowStart = new Date(ninetyDaysAgo);
        windowStart.setDate(windowStart.getDate() - 14);
        const windowStartStr = windowStart.toISOString().split("T")[0];

        // racer_idのIN句が大きくなりうるため、race_id範囲（全会場横断・2週間分）で
        // まとめて取得しracer_idでフィルタする
        const pastRows = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data } = await supabase
            .from("race_entries")
            .select("race_id, racer_id, win_rate")
            .gte("race_id", windowStartStr)
            .lte("race_id", cutoff)
            .order("race_id", { ascending: false })
            .range(from, from + pageSize - 1);
          if (!data || data.length === 0) break;
          pastRows.push(...data);
          if (data.length < pageSize) break;
          from += pageSize;
        }

        // race_id降順のため、各racer_idごとに最初に出てくるものが cutoff に最も近い記録
        const pastByRacer = new Map();
        pastRows.forEach((row) => {
          if (!currentByRacer.has(row.racer_id)) return;
          if (!pastByRacer.has(row.racer_id)) {
            pastByRacer.set(row.racer_id, row.win_rate);
          }
        });

        const withDelta = [...currentByRacer.values()]
          .map((entry) => {
            const pastWinRate = pastByRacer.get(entry.racer_id) ?? null;
            const meta = raceMetaByRaceId.get(entry.race_id);
            return {
              ...entry,
              venue_code: meta?.venue_code ?? null,
              race_number: meta?.race_number ?? null,
              past_win_rate: pastWinRate,
              delta: pastWinRate !== null ? entry.win_rate - pastWinRate : null,
            };
          })
          .filter((row) => row.delta !== null);

        const rising = [...withDelta]
          .sort((a, b) => b.delta - a.delta)
          .slice(0, limit);
        const falling = [...withDelta]
          .sort((a, b) => a.delta - b.delta)
          .slice(0, limit);

        return { rising, falling };
      },
    );
  }
