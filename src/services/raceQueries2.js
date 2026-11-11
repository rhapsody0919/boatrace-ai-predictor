// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: race）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { officialPeriodOf } from "../components/race/basicInfoStats.js";
import { toWakuRacerStats } from "../utils/racerStats.js";
import { fetchAllByIn, withCache } from "./core.js";
import { raceOddsCacheTtl } from "./raceQueries.js";

/**
 * 本日開催中のレースの出走選手について、直近90日間の平均展示タイム（周回展示の2周目の150mのタイム）を取得する（BOA-164）
 */
export function getRaceExhibitionTimeBreakdown(raceId) {
    return withCache(`race-exhibition-time-breakdown-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // RPC優先（サーバー側集計でegressを約1/25に削減、029マイグレーション）。
      // 未適用環境では旧クライアント集計にフォールバックする
      const { data: rpcData } = await supabase.rpc(
        "get_race_exhibition_trend",
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

      const { data: todaysExhibition } = await supabase
        .from("exhibition_data")
        .select("boat_number, exhibition_time")
        .eq("race_id", raceId);
      const exhibitionByBoat = new Map(
        (todaysExhibition ?? []).map((e) => [e.boat_number, e.exhibition_time]),
      );

      const racerIds = [...new Set(entries.map((r) => r.racer_id))].filter(
        (id) => id !== null,
      );
      if (racerIds.length === 0) {
        return entries.map((row) => ({
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
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
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: null,
          sample_count: 0,
        }));
      }

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time",
        "race_id",
        pastRaceIds,
      );

      const exhibitionByKey = new Map();
      exhibitionRows.forEach((e) => {
        exhibitionByKey.set(`${e.race_id}-${e.boat_number}`, e.exhibition_time);
      });

      const timesByRacer = new Map();
      (pastEntries ?? []).forEach((e) => {
        const key = `${e.race_id}-${e.boat_number}`;
        const time = exhibitionByKey.get(key);
        if (time === undefined || time === null) return;

        if (!timesByRacer.has(e.racer_id)) {
          timesByRacer.set(e.racer_id, []);
        }
        timesByRacer.get(e.racer_id).push(time);
      });

      return entries.map((row) => {
        const times = timesByRacer.get(row.racer_id) ?? [];
        const avgTime =
          times.length > 0
            ? times.reduce((sum, t) => sum + t, 0) / times.length
            : null;
        return {
          ...row,
          exhibition_time: exhibitionByBoat.get(row.boat_number) ?? null,
          avg_exhibition_time: avgTime,
          sample_count: times.length,
        };
      });
    });
  }

/**
 * 指定レースの出走表の体重（race_entries.weight_kg、マイグレーション081）を取得する（BOA-484）。
 *
 * 直前情報タブで、展示前（exhibition_data の行がまだ無い時点）に体重を出すために使う。
 * 公式の出走表の体重は、直前情報ページの体重と同じ時刻に公開され、値も一致する
 * （2026-09-23〜27の5,075艇で99.4%一致。差は展示の直前の再計量）。race_entries へは
 * 発走60分前の出走表の取得（race_info スロット）で入る。朝の初期化の時点では NULL。
 *
 * 戻り値:
 *   { state: "published", byBoat: { [boat_number]: number } }  1艇以上の体重がある
 *   { state: "empty", byBoat: {}, fetchFailed: true }            まだ公開されていない
 * empty はキャッシュさせない（fetchFailed。公開された後もリロードまで出なくなるため）。
 * 取得の失敗は例外のまま投げる（呼び出し側で「取得失敗」として扱う）
 */
export function getRaceEntryWeights(raceId) {
    return withCache(`race-entry-weights-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      const { data } = await supabase
        .from("race_entries")
        .select("boat_number, weight_kg")
        .eq("race_id", raceId);
      const byBoat = {};
      (data ?? []).forEach((row) => {
        const weight = parseFloat(row.weight_kg);
        if (Number.isFinite(weight)) byBoat[row.boat_number] = weight;
      });
      if (Object.keys(byBoat).length === 0) {
        return { state: "empty", byBoat: {}, fetchFailed: true };
      }
      return { state: "published", byBoat };
    });
  }

/**
 * 指定レースの展示の値（BOA-430 思考アシスト）。exhibition_data の行をそのまま艇番順に返す。
 * 時点（展示が出走する艇の全部にそろったか、spec D-36 (1)）・欠場（D-38）・展示ST（F は start_flag）を見る。
 * 行が無い（展示前）は空の配列。0行はキャッシュに残さない（展示が出た後も空のまま返さないため）。
 * 取得の失敗は投げる（supabaseClient.js の .throwOnError() 既定）
 * @returns {Promise<Array<{boat: number, time: number|null, st: number|null, startFlag: string|null, tilt: number|null, absent: boolean}>>}
 */
export function getRaceExhibitionBasics(raceId) {
    return withCache(
      `race-exhibition-basics-${raceId}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }
        const { data } = await supabase
          .from("exhibition_data")
          .select(
            "boat_number, exhibition_time, start_timing, start_flag, tilt, is_absent",
          )
          .eq("race_id", raceId)
          .order("boat_number");
        const num = (v) => (v == null || v === "" ? null : Number(v));
        return (data ?? []).map((r) => ({
          boat: r.boat_number,
          time: num(r.exhibition_time),
          st: num(r.start_timing),
          startFlag: r.start_flag ?? null,
          tilt: num(r.tilt),
          absent: r.is_absent === true,
        }));
      },
      undefined,
      (rows) => rows.length > 0,
    );
  }

/**
 * 指定レースの選手の枠番別統計（racerStats）を取得する（BOA-168）
 * predictions.feature_contributions.racerStats に日次バッチで保存済みの
 * 平均ST・枠番別勝敗・攻め手/守り手分布を返す。
 * 超展開データタブ・データ出走表の平均ST/枠番勝率行で使用する。
 * 保存側のキー名は course 系だが中身は枠番のため、toWakuRacerStats（src/utils/racerStats.js）で
 * wakuRaceCounts に詰め替えて返す（BOA-302）
 */
export function getRaceRacerStats(raceId) {
    return withCache(`race-racer-stats-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      // shadow予測が併存する可能性があるためmaybeSingleは使わず最新1件を取る
      const { data } = await supabase
        .from("predictions")
        .select("model_id, feature_contributions, predicted_at")
        .eq("race_id", raceId)
        .eq("model_id", "standard")
        .order("predicted_at", { ascending: false })
        .limit(1);

      return toWakuRacerStats(data?.[0]?.feature_contributions?.racerStats);
    });
  }

/**
 * 指定レースの6艇の「平均ST（公式）」（BOA-815）。公式の出走表と同じ期（officialPeriodOf）の
 * racer_period_stats.avg_st（2桁）を返す。期は節の初日（race_series）で決める。公式は節の途中で
 * 期を替えないため（6/27〜7/1 の節の 7/1 は旧期）。節が取れなければレース日で決める。
 * その期の行が無い選手（新人など）は返さない。別の期の値で埋めると公式の出走表と食い違うため、
 * 埋めずに「—」にする
 * @param {string} raceId
 * @returns {Promise<{period: {periodYear: number, periodNo: number, calcFrom: string, calcTo: string}|null,
 *   rows: Array<{boatNumber: number, avgSt: number}>}>}
 */
export function getRaceOfficialAvgSt(raceId) {
    return withCache(`race-official-avg-st-v2-${raceId}`, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");
      const raceDate = raceId?.slice(0, 10);
      const venueCode = Number(raceId?.slice(11, 13));
      // クエリの失敗は .throwOnError() で例外になる（BOA-507）。useRaceAnalysisData が取得失敗として出す
      const { data: series } = await supabase
        .from("race_series")
        .select("start_date")
        .eq("venue_code", venueCode)
        .lte("start_date", raceDate)
        .gte("end_date", raceDate)
        .order("start_date", { ascending: false })
        .limit(1);
      const period = officialPeriodOf(series?.[0]?.start_date ?? raceDate);
      if (!period) return { period: null, rows: [] };
      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, racer_id")
        .eq("race_id", raceId);
      const ids = (entries ?? []).map((e) => e.racer_id).filter(Boolean);
      if (ids.length === 0) return { period, rows: [] };
      const { data } = await supabase
        .from("racer_period_stats")
        .select("racer_id, avg_st")
        .eq("period_year", period.periodYear)
        .eq("period_no", period.periodNo)
        .in("racer_id", ids);
      const byRacer = new Map(
        (data ?? [])
          .filter((r) => r.avg_st != null)
          .map((r) => [r.racer_id, Number(r.avg_st)]),
      );
      return {
        period,
        rows: (entries ?? [])
          .filter((e) => byRacer.has(e.racer_id))
          .map((e) => ({
            boatNumber: e.boat_number,
            avgSt: byRacer.get(e.racer_id),
          })),
      };
    });
  }

/**
 * 指定レースのオッズ全通り系スナップショット履歴を取得する（オッズ一覧タブ、BOA-311）
 * race_odds.trifecta_all/trio_all/exacta_all/quinella_all/wide_all（jsonb、ADR-0054/0057）を
 * captured_at昇順で全件返す。全窓（60/30/15/10/5/0分前）分が入る想定だが、
 * オンデマンド更新（別チケットBOA-310で予定）が加わると窓に一致しない行が
 * 混ざりうるため、呼び出し側は行数を6固定と決め打ちしないこと。
 * 全通り系5列が全てnullの行（全通り捕捉ウィンドウ外のスナップショット）は
 * オッズ一覧タブでは無意味なため除外する
 */
export function getRaceOddsSnapshots(raceId, { fresh = false } = {}) {
    // fresh: キャッシュを読まずに取り直す（結果は保存する。思考アシストの読み直し。BOA-1180）
    const ttl = fresh ? 0 : raceOddsCacheTtl(raceId);

    // v2: 単勝・複勝（odds_win_N・odds_place_N_low/high）を足した（BOA-487）。キーを変えないと、
    // localStorage に残った旧形（単勝なし）が過去レースで最大7日返る
    return withCache(
      `race-odds-snapshots-v2-${raceId}`,
      async () => {
        if (!supabase) {
          throw new Error("Supabase client not initialized");
        }

        const winPlaceColumns = [1, 2, 3, 4, 5, 6]
          .map(
            (n) => `odds_win_${n}, odds_place_${n}_low, odds_place_${n}_high`,
          )
          .join(", ");
        const { data } = await supabase
          .from("race_odds")
          .select(
            `captured_at, trifecta_all, trio_all, exacta_all, quinella_all, wide_all, ${winPlaceColumns}`,
          )
          .eq("race_id", raceId)
          .order("captured_at", { ascending: true });

        // 単勝・複勝は艇番（"1"〜"6"）→ 値。null は「票0（公式の0.0）か未取得」で、保存時に区別していない
        // （scrape-odds.js が 0.0 を null にする）。画面では「票なし（または未取得）」として扱う
        const winOf = (row) =>
          Object.fromEntries(
            [1, 2, 3, 4, 5, 6].map((n) => [String(n), row[`odds_win_${n}`]]),
          );
        const placeOf = (row) =>
          Object.fromEntries(
            [1, 2, 3, 4, 5, 6].map((n) => {
              const low = row[`odds_place_${n}_low`];
              const high = row[`odds_place_${n}_high`];
              return [
                String(n),
                low != null && high != null ? { low, high } : null,
              ];
            }),
          );
        return (data || [])
          .filter(
            (row) =>
              row.trifecta_all ||
              row.trio_all ||
              row.exacta_all ||
              row.quinella_all ||
              row.wide_all ||
              [1, 2, 3, 4, 5, 6].some((n) => row[`odds_win_${n}`] != null),
          )
          .map((row) => ({
            capturedAt: row.captured_at,
            trifectaAll: row.trifecta_all ?? null,
            trioAll: row.trio_all ?? null,
            exactaAll: row.exacta_all ?? null,
            quinellaAll: row.quinella_all ?? null,
            wideAll: row.wide_all ?? null,
            win: winOf(row),
            place: placeOf(row),
          }));
      },
      ttl,
    );
  }
