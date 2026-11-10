// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: schedule）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { getTodayJST, getDaysAgoJST } from "../utils/dateUtils.js";
import { supabase } from "./supabaseClient";
import { seriesCoveringDate } from "../utils/meetPageModel.js";
import { transformTodayRaces } from "../utils/todayRaces.js";
import {
  CACHE_TTL,
  EDGE_API_BASE,
  PAST_RACE_CACHE_TTL,
  fetchVenueWinRateMap,
  withCache,
} from "./core.js";

/**
 * レースデータを取得（races.json形式で返す）
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */
export async function getRaces() {
    // 今日の日付（JST）
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`races-${today}`, async () => {
      // Phase 2: まずEdge APIを試行（CDNキャッシュ活用）
      try {
        const edgeResponse = await fetch(`${EDGE_API_BASE}/api/races/today`);
        if (edgeResponse.ok) {
          const data = await edgeResponse.json();
          if (data.success && data.data) {
            console.log("[getRaces] Edge API success");
            return transformTodayRaces(data, await fetchVenueWinRateMap());
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaces] Edge API failed, falling back to direct query:",
          edgeError.message,
        );
      }

      // フォールバック: Edge API と同じ RPC（get_today_races）を Supabase へ直接呼び、同じ transformTodayRaces で整形する。
      // 以前は別実装のネストクエリで、RPC との二重実装になっていた（BOA-355 の getPredictions と同じ形に寄せる。BOA-668）。
      // RPC の失敗は .throwOnError() 既定（ADR-0069）で例外になり、呼び出し側のエラー表示に届く
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { success: false, data: [], scrapedAt: null };
      }
      const { data: rpcData } = await supabase.rpc("get_today_races");
      if (!rpcData?.success || !rpcData.data) {
        throw new Error("get_today_races が有効なデータを返しませんでした");
      }
      return transformTodayRaces(rpcData, await fetchVenueWinRateMap());
    }); // withCache end
  }

/**
 * 期間中・これからの節（race_series）を返す。非開催会場の次開催日に使う（BOA-225）。
 * 1会場あたり翌月末までで数節なので、全会場で100行に届かない
 */
export async function getUpcomingSeries(today) {
    return withCache(`upcoming-series-${today}`, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");
      const { data } = await supabase
        .from("race_series")
        .select("venue_code,start_date,end_date")
        .gte("end_date", today)
        .order("start_date");
      return data ?? [];
    });
  }

/**
 * その日の会場の節（race_series）を1件返す。レース詳細の 1R〜12R の帯で、節ページ
 * （/venue/N/meet/初日）へのリンクの初日に使う（BOA-1189 GS01-c）。初日は seriesDay から逆算しない
 * （中止で日目が振り直されるため。memory boatrace_series_day_renumbering_on_cancellation）。
 *
 * race_series は月間スケジュールの「予定」で、順延した節の日程は直らない（docs/db-migration/084）。
 * 順延で予定の最終日より後に走る日（優勝戦など）も同じ節として返すため、その日以前に始まった
 * いちばん新しい節を取り、最終日から SERIES_POSTPONE_TOLERANCE_DAYS（meetPageModel.js の seriesCoveringDate）日以内なら同じ節とみなす。
 * 次の節が始まっていれば、そちらが先に取れる。
 * 行が無ければ null。クエリの失敗は supabase クライアントが例外にする
 * @param {number} venueCode
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<{start_date: string, end_date: string, title: string|null, grade: string|null} | null>}
 */
export async function getSeriesOfDate(venueCode, date) {
    return withCache(`venue-series-of-date-${venueCode}-${date}`, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");
      const { data } = await supabase
        .from("race_series")
        .select("start_date,end_date,title,grade")
        .eq("venue_code", venueCode)
        .lte("start_date", date)
        .order("start_date", { ascending: false })
        .limit(1);
      return seriesCoveringDate(data?.[0] ?? null, date);
    });
  }

/**
 * 予想データが存在する日付リストを取得
 * @param {number} days - 過去何日分を取得するか
 */
export async function getAvailableDates(days = 90) {
    return withCache(`availableDates-${days}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 日付範囲を計算
      const startDateStr = getDaysAgoJST(days);

      // 日付ごとのレースを取得（ページネーションで1000行制限を回避）
      const allData = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data } = await supabase
          .from("races")
          .select("race_date")
          .gte("race_date", startDateStr)
          .order("race_date", { ascending: false })
          .range(offset, offset + pageSize - 1);

        if (!data || data.length === 0) break;

        allData.push(...data);
        offset += pageSize;

        if (data.length < pageSize) break;
      }

      // ユニークな日付を抽出
      const uniqueDates = [...new Set(allData.map((r) => r.race_date))];
      return uniqueDates;
    }); // withCache end
  }

/**
 * レース履歴サマリーを取得（日付ごとのモデル別的中統計）
 * /races ページ用。従来の N+1 フェッチを 1 リクエストに集約
 * @param {number} days - 過去何日分を取得するか（デフォルト 90）
 */
export async function getRaceHistorySummary(days = 90) {
    return withCache(`raceHistorySummary-${days}`, async () => {
      // Phase 1: Edge API を試行
      try {
        const edgeResponse = await fetch(
          `${EDGE_API_BASE}/api/race-history/summary?days=${days}`,
        );
        if (edgeResponse.ok) {
          const edgeData = await edgeResponse.json();
          if (edgeData.days) {
            console.log("[getRaceHistorySummary] Edge API success");
            return edgeData;
          }
        }
      } catch (edgeError) {
        console.log(
          "[getRaceHistorySummary] Edge API failed, falling back:",
          edgeError.message,
        );
      }

      // フォールバック: race_history_cache テーブルから直接取得（RPC廃止）
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { days: [] };
      }

      const { data: rows } = await supabase
        .from("race_history_cache")
        .select("data")
        .eq("key", "race_history_summary_90")
        .single();

      return rows?.data || { days: [] };
    });
  }

/**
 * 本日レースが開催されている会場一覧を取得する（BOA-151）
 * races テーブルは当日分のカードしか保持していないため、モーター調子の
 * レース単位表示は「本日開催中の会場」に限定する
 */
export function getVenuesWithTodaysRaces() {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`venues-with-races-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data } = await supabase
        .from("races")
        .select("venue_code")
        .eq("race_date", today);

      return [...new Set(data.map((r) => r.venue_code))].sort((a, b) => a - b);
    });
  }

/**
 * 指定会場の本日のレース一覧を取得する（BOA-151）
 */
export function getTodaysRacesForVenue(venueCode) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    return withCache(`todays-races-${venueCode}-${today}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const { data } = await supabase
        .from("races")
        .select("race_id, race_number, start_time")
        .eq("venue_code", venueCode)
        .eq("race_date", today)
        .order("race_number");

      return data ?? [];
    });
  }

/**
 * 「本日のデータ一覧」（BOA-402）の1日ぶんを取得する。
 *
 * ページは morning_digest_days / morning_digest_rows の **2表だけ**を読む
 * （ADR-0070）。抽出ロジックは早朝バッチ generate-morning-digest.js の
 * 1箇所にしか存在しないため、ここでは整形しかしない。
 *
 * 戻り値の `state`:
 *   - "generated": 生成済み（rows がある）
 *   - "not_generated": その日の行が無い、または generated_at が NULL（生成途中で落ちた）
 *     → 画面は「該当0件」と**区別して**表示する（spec §6）
 *
 * TTLは呼び出し側で明示的に渡す。`inferTtlFromKey` は race_id 形式の末尾
 * （YYYY-MM-DD-VV-RR）を要求する正規表現のため、`morning-digest-YYYY-MM-DD`
 * ではマッチせず、過去日でも当日TTL（30分）になってしまう。
 *
 * @param {string} date YYYY-MM-DD（JST）
 */
export function getMorningDigest(date) {
    const jstToday = getTodayJST();
    const ttl =
      date < jstToday ? PAST_RACE_CACHE_TTL : /* 当日は30分 */ CACHE_TTL;

    return withCache(
      `morning-digest-${date}`,
      async () => {
        const [{ data: day }, { data: rows }] = await Promise.all([
          supabase
            .from("morning_digest_days")
            .select("*")
            .eq("digest_date", date)
            .maybeSingle(),
          supabase
            .from("morning_digest_rows")
            .select("*")
            .eq("digest_date", date)
            .order("section")
            .order("rank"),
        ]);

        // generated_at は書き込み完了のマーク（ADR-0070）。NULLなら生成途中で
        // 落ちた状態なので「未生成」として扱い、「該当0件」と混同しない
        if (!day || !day.generated_at) {
          return { state: "not_generated", day: day ?? null, sections: {} };
        }

        const sections = {
          featured: [],
          nige: [],
          makuri: [],
          nigashi: [],
          flying: [],
          returned: [],
        };
        for (const row of rows ?? []) {
          if (!sections[row.section]) sections[row.section] = [];
          sections[row.section].push(row);
        }

        return { state: "generated", day, sections };
      },
      ttl,
    );
  }
