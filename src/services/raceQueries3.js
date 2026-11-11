// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: race）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isNoRaceResult } from "../utils/raceResultUsable.js";
import { toReturnRate } from "../utils/racerVenueBoatStats.js";
import { fetchAllByIn, withCache } from "./core.js";
import { raceOddsCacheTtl } from "./raceQueries.js";

/**
 * 指定レースの締切時オッズ（公式）を取得する（BOA-496）。締切の後に Cron（api/cron/odds-final.js）が公式の
 * 「締切時オッズ」表示のページを取り直して race_odds_final に保存した値。券種ごとに取れたものだけが入る
 * （取れなかった券種は null）。票0は 0 のまま（スナップショットと違い、キーが無いのは欠場・未発売）。
 *
 * 戻り値: { capturedAt, win, place, trifectaAll, trioAll, exactaAll, quinellaAll, wideAll }、行が無ければ null。
 * 本日のレースは、締切後に値が入るため短いTTLにする（getRaceOddsSnapshots と同じ理由）
 */
export function getRaceFinalOdds(raceId, { fresh = false } = {}) {
    const ttl = fresh ? 0 : raceOddsCacheTtl(raceId);
    return withCache(
      `race-odds-final-v1-${raceId}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        const nonEmpty = (v) =>
          v && typeof v === "object" && Object.keys(v).length > 0 ? v : null;
        let data;
        try {
          ({ data } = await supabase
            .from("race_odds_final")
            .select(
              "captured_at, win_all, place_all, trifecta_all, trio_all, exacta_all, quinella_all, wide_all",
            )
            .eq("race_id", raceId)
            .maybeSingle());
        } catch (err) {
          // マイグレーション108が未適用（テーブルが無い）のときだけ「締切時オッズなし」に倒す。画面は従来の
          // スナップショットの表示のまま動く（適用とデプロイの順序を問わないため）。それ以外は上流に流す
          if (err?.code === "PGRST205" || err?.code === "42P01") return null;
          throw err;
        }
        if (!data) return null;
        const final = {
          capturedAt: data.captured_at,
          win: nonEmpty(data.win_all),
          place: nonEmpty(data.place_all),
          trifectaAll: nonEmpty(data.trifecta_all),
          trioAll: nonEmpty(data.trio_all),
          exactaAll: nonEmpty(data.exacta_all),
          quinellaAll: nonEmpty(data.quinella_all),
          wideAll: nonEmpty(data.wide_all),
        };
        // 一部の券種だけの行は、Cron の再試行で後から埋まる。キャッシュに保存しない（withCache は TTL を読み出し時に
        // キーの日付から決め直すため、今日3分で保存した途中の行が、翌日には過去レースの7日TTLで返り続ける）
        const complete = [
          final.win,
          final.trifectaAll,
          final.trioAll,
          final.exactaAll,
          final.quinellaAll,
          final.wideAll,
        ].every(Boolean);
        return complete ? final : { ...final, fetchFailed: true };
      },
      ttl,
    );
  }

/**
 * 指定レースの出走表詳細（race_entriesの全選手データ）を取得する（BOA-168）
 * 分析ツールの「出走表データ」タブで使用する。AIスコアは含めない
 */
export function getRaceEntriesDetail(raceId) {
    return withCache(`race-entries-detail-v2-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const [entriesRes, exhibitionRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, grade, age, win_rate, local_win_rate, global_2rate, motor_number, motor_2rate",
          )
          .eq("race_id", raceId)
          .order("boat_number"),
        supabase
          .from("exhibition_data")
          .select("boat_number, exhibition_time, start_timing, start_flag")
          .eq("race_id", raceId),
      ]);

      if (!entriesRes.data) {
        return [];
      }
      const exByBoat = new Map(
        (exhibitionRes.data ?? []).map((e) => [e.boat_number, e]),
      );
      return entriesRes.data.map((row) => ({
        ...row,
        exhibition_time: exByBoat.get(row.boat_number)?.exhibition_time ?? null,
        exhibition_st: exByBoat.get(row.boat_number)?.start_timing ?? null,
        // 展示のフライング・出遅れの印（BOA-759）
        exhibition_start_flag:
          exByBoat.get(row.boat_number)?.start_flag ?? null,
      }));
    });
  }

/**
 * 指定レースの結果サマリー（着順・決まり手）を取得する（BOA-168）
 * Edge Function経由のpredictionデータにはwinning_techniqueが含まれないため、
 * 「データで振り返る」はこの関数で確実に決まり手を取得する
 */
export function getRaceResultSummary(raceId) {
    return withCache(`race-result-summary-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data } = await supabase
        .from("race_results")
        .select("race_id, rank1, rank2, rank3, winning_technique, race_status")
        .eq("race_id", raceId)
        .maybeSingle();

      return data ?? null;
    });
  }

/**
 * 本日開催中のレースの出走選手について、過去180日間・同じ艇番で出走した
 * レースでの単勝回収率・複勝回収率を取得する（BOA-167）
 * AI予想モデルの確率は使わず、race_results.payout_win/payout_place_1/2の
 * 過去の実績払戻金のみを集計する（期待値分析のようなモデル較正は不要）
 */
export function getRaceRacerBoatReturnRate(raceId) {
    return withCache(`race-racer-boat-return-rate-v2-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData } = await supabase.rpc("get_race_return_rate", {
        p_race_id: raceId,
      });
      if (Array.isArray(rpcData)) {
        return rpcData;
      }

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (!entries || entries.length === 0) {
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 180);
      const cutoffStr = cutoffDate.toISOString().split("T")[0];

      const relevantPastEntries = [];
      const pageSize = 1000;
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("race_entries")
          .select("race_id, boat_number, racer_id")
          .in("racer_id", racerIds)
          .gte("race_id", cutoffStr)
          .lt("race_id", raceId)
          .range(from, from + pageSize - 1);
        if (!data || data.length === 0) break;
        relevantPastEntries.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }

      if (relevantPastEntries.length === 0) {
        return entries.map((row) => ({
          ...row,
          sample_count: 0,
          win_return_rate: null,
          place_return_rate: null,
        }));
      }

      const pastRaceIds = [
        ...new Set(relevantPastEntries.map((e) => e.race_id)),
      ];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, rank2, payout_win, payout_place_1, payout_place_2, race_status",
        "race_id",
        pastRaceIds,
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      // racer_id + boat_number ごとに集計（同じ選手でも艇番が違えば別集計）
      const statsByRacerBoat = new Map();
      relevantPastEntries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || isNoRaceResult(result)) return;

        const key = `${e.racer_id}-${e.boat_number}`;
        if (!statsByRacerBoat.has(key)) {
          statsByRacerBoat.set(key, {
            sampleCount: 0,
            winPayoutSum: 0,
            placePayoutSum: 0,
          });
        }
        const stats = statsByRacerBoat.get(key);
        stats.sampleCount += 1;

        if (result.rank1 === e.boat_number) {
          stats.winPayoutSum += result.payout_win ?? 0;
          stats.placePayoutSum += result.payout_place_1 ?? 0;
        } else if (result.rank2 === e.boat_number) {
          stats.placePayoutSum += result.payout_place_2 ?? 0;
        }
      });

      return entries.map((row) => {
        const stats = statsByRacerBoat.get(
          `${row.racer_id}-${row.boat_number}`,
        );
        if (!stats || stats.sampleCount === 0) {
          return {
            ...row,
            sample_count: 0,
            win_return_rate: null,
            place_return_rate: null,
          };
        }
        return {
          ...row,
          sample_count: stats.sampleCount,
          win_return_rate: toReturnRate(stats.winPayoutSum, stats.sampleCount),
          place_return_rate: toReturnRate(
            stats.placePayoutSum,
            stats.sampleCount,
          ),
        };
      });
    });
  }

/**
 * 本日開催中のレースの出走選手について、過去90日間で勝った時の決まり手構成比を取得する（BOA-165）
 * 会場・枠番単位の決まり手データ分析（BOA-150）とは異なり、選手個人単位の勝ちパターンを見る機能
 */
export function getRaceTechniqueProfileBreakdown(raceId) {
    return withCache(`race-technique-profile-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData } = await supabase.rpc(
        "get_race_technique_profile",
        { p_race_id: raceId },
      );
      if (Array.isArray(rpcData)) {
        return rpcData;
      }

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, player_name, racer_id")
        .eq("race_id", raceId)
        .order("boat_number");

      if (!entries || entries.length === 0) {
        return [];
      }

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: pastEntries } = await supabase
        .from("race_entries")
        .select("race_id, boat_number, racer_id")
        .in("racer_id", racerIds)
        .gte("race_id", cutoffStr)
        .lt("race_id", raceId);

      const pastRaceIds = [
        ...new Set((pastEntries ?? []).map((e) => e.race_id)),
      ];

      if (pastRaceIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          win_count: 0,
          techniques: [],
        }));
      }

      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        pastRaceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const techniqueCountsByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計

        if (!techniqueCountsByRacer.has(e.racer_id)) {
          techniqueCountsByRacer.set(e.racer_id, new Map());
        }
        const counts = techniqueCountsByRacer.get(e.racer_id);
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      return entries.map((row) => {
        const counts = techniqueCountsByRacer.get(row.racer_id) ?? new Map();
        const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
        const techniques = [...counts.entries()]
          .map(([technique, count]) => ({
            technique,
            count,
            percentage: winCount > 0 ? (count / winCount) * 100 : 0,
          }))
          .sort((a, b) => b.count - a.count);
        return {
          ...row,
          win_count: winCount,
          techniques,
        };
      });
    });
  }
