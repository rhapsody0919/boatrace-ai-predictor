// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: venue）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { groupLosingTechniqueRows } from "../utils/losingTechnique.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import {
  tallyVenuePayouts,
  rankVenuesByPayout,
} from "../utils/venuePayoutStats.js";
import { fetchAllByIn, isPermissionDeniedError, withCache } from "./core.js";

/**
 * 本日の結果確定済みレースを会場別に横断集計し、4指標（固い場/荒れている場/
 * イン逃げ率/万舟率）でランキングする（BOA-171）
 * 消化レース数が少ない会場（minRaceCount未満）はサンプル不足のためランキング対象から除外する
 *
 * 注意: 3連単配当は race_results.payout_trio を使う（DB列名と実態が歴史的経緯で
 * 逆転しており、payout_trifecta は実態3連複のため使わない。scripts/lib/payoutCalculator.js参照）
 */
export function getTodaysVenueRanking(limit = 5, minRaceCount = 3) {
    const now = new Date();
    const jstOffset = 9 * 60;
    const jstNow = new Date(now.getTime() + jstOffset * 60 * 1000);
    const today = jstNow.toISOString().split("T")[0];

    const empty = { stable: [], rough: [], nigeRate: [], manshu: [] };

    // 本日限定のリアルタイム集計のため、グローバルの30分キャッシュ（inferTtlFromKey）
    // ではなく短めのTTLを明示指定する。特に「まだ結果確定レースが無い」空状態が
    // 30分間キャッシュされ続けると、レース確定後もリアルタイム性が損なわれるため
    const VENUE_RANKING_CACHE_TTL = 5 * 60 * 1000; // 5分

    return withCache(
      `todays-venue-ranking-v2-${today}-${limit}-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const { data: races } = await supabase
          .from("races")
          .select("race_id, venue_code")
          .eq("race_date", today);

        if (!races || races.length === 0) {
          return empty;
        }

        const venueByRaceId = new Map(
          races.map((r) => [r.race_id, r.venue_code]),
        );
        const raceIds = races.map((r) => r.race_id);

        const results = await fetchAllByIn(
          "race_results",
          "race_id, rank1, payout_trio, winning_technique, race_status",
          "race_id",
          raceIds,
        );

        // 集計は src/utils/venuePayoutStats.js（BOA-1242。龍神ボート番付と共有するため手を加えずに移した）
        const byVenue = tallyVenuePayouts(results, (raceId) =>
          venueByRaceId.get(raceId),
        );
        return rankVenuesByPayout(byVenue, limit, minRaceCount);
      },
      VENUE_RANKING_CACHE_TTL,
    );
  }

/**
 * 指定会場・指定日の結果確定済みレースを集計し、平均配当・万舟率・1号艇の逃げ率・
 * 決まり手別回数・進入コース別1着回数を返す（BOA-304。2026-09-24のFR-5で
 * 直前情報タブから結果タブ・会場ページへ移設、`VenueDaySummaryCard`が使う）。
 *
 * nigeRateは `rank1 === 1 && winning_technique === "逃げ"` の**艇番基準**で、
 * 「1コース逃げ」ではない。決まり手が逃げの有効23,892レースのうち
 * rank1 !== 1（前づけで他艇が1コースを取って逃げた）が238件＝1.0%あり、
 * これを分子から落としている（2026-09-24実測。逆にrank1===1かつ逃げで
 * 実進入コースが1でない例は0件）。実進入コース基準に寄せると、当日の
 * レースはactual_course_*が100%NULLのため算出できなくなるため据え置き、
 * 画面のラベルを「1号艇の逃げ率」にして実装に合わせている
 *
 * byRaceは「この日の傾向 vs このレース」の比較文（FR-5 / T4-4）のために
 * レース単位の決まり手・1着艇の実進入コースを返す。actual_course_1〜6は
 * 既にselectしているので**追加クエリは0本**。当日のレースはバックフィルが
 * 未了でwinnerCourseがnullになる（会場×日単位でオール・オア・ナッシングに
 * 入るため、当日は必ずnull）。courseOfBoat()は使わない——未バックフィルの
 * 艇番を暫定コースとみなすと、当日レースで「3コースまくり」と断定してしまう
 *
 * 平均配当/万舟率/イン逃げ率の定義・除外条件（不成立=race_status no_race/
 * rank1===null除外、3連単配当はpayout_trio列を使う歴史的経緯）は
 * getTodaysVenueRanking（BOA-171）と完全に同じにする。あちらは「本日」
 * 固定・全24会場横断ランキング用、こちらは任意の日付・単一会場の
 * サマリー表示用という違いのみで、集計ロジックの重複・食い違いを避ける
 */
export function getVenueDaySummary(venueCode, date) {
    if (!venueCode || !date) {
      return Promise.resolve({
        raceCount: 0,
        payoutCount: 0,
        avgPayout: null,
        manshuRate: null,
        nigeRate: null,
        techniqueCounts: {},
        entryCourseWinCounts: {},
        byRace: {},
      });
    }

    return withCache(
      `venue-day-summary-v2-${venueCode}-${date}`,
      async () => {
        const empty = {
          raceCount: 0,
          payoutCount: 0,
          avgPayout: null,
          manshuRate: null,
          nigeRate: null,
          techniqueCounts: {},
          entryCourseWinCounts: {},
          byRace: {},
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          // 環境変数の未設定は「その日は0レース」ではないため、キャッシュに
          // 焼き付けない（.claude/rules/frontend-data-fetch.md §4）
          return { ...empty, fetchFailed: true };
        }

        const { data: races } = await supabase
          .from("races")
          .select("race_id")
          .eq("race_date", date)
          .eq("venue_code", venueCode);

        if (!races || races.length === 0) {
          return empty;
        }

        const raceIds = races.map((r) => r.race_id);
        const results = await fetchAllByIn(
          "race_results",
          "race_id, rank1, payout_trio, winning_technique, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
          "race_id",
          raceIds,
        );

        let raceCount = 0;
        let payoutCount = 0;
        let payoutSum = 0;
        let manshuCount = 0;
        let nigeCount = 0;
        const techniqueCounts = {};
        const entryCourseWinCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
        const byRace = {};

        results.forEach((r) => {
          if (!isUsableRaceResult(r)) return;
          raceCount += 1;
          byRace[r.race_id] = {
            rank1: r.rank1,
            winningTechnique: r.winning_technique ?? null,
            // 1着艇が実際に進入したコース。当日・未バックフィル日はnull
            winnerCourse: r[`actual_course_${r.rank1}`] ?? null,
          };
          if (r.payout_trio !== null) {
            payoutCount += 1;
            payoutSum += r.payout_trio;
            if (r.payout_trio >= 10000) manshuCount += 1;
          }
          if (r.rank1 === 1 && r.winning_technique === "逃げ") nigeCount += 1;
          if (r.winning_technique) {
            techniqueCounts[r.winning_technique] =
              (techniqueCounts[r.winning_technique] ?? 0) + 1;
          }
          // 進入コース別1着回数（BOA-257の実進入コース列を使う。バックフィル対象外の
          // 古いレース・欠場艇はactual_course_Nがnullのため、そのレースは対象外になる）
          for (let boat = 1; boat <= 6; boat++) {
            const course = r[`actual_course_${boat}`];
            if (course !== null && course !== undefined && boat === r.rank1) {
              entryCourseWinCounts[course] =
                (entryCourseWinCounts[course] ?? 0) + 1;
              break;
            }
          }
        });

        return {
          raceCount,
          payoutCount,
          avgPayout: payoutCount > 0 ? payoutSum / payoutCount : null,
          manshuRate:
            payoutCount > 0 ? (manshuCount / payoutCount) * 100 : null,
          nigeRate: raceCount > 0 ? (nigeCount / raceCount) * 100 : null,
          techniqueCounts,
          entryCourseWinCounts,
          byRace,
        };
      },
      5 * 60 * 1000, // 当日分は結果反映のたびに変わりうるため短めのTTL
    );
  }

/**
 * 全24会場の1号艇勝率ランキングを取得する（BOA-267、venuerankingタブの追加指標）
 * 直近90日の値は日次バッチ update-venue-stats.js が venues.avg_first_win_rate と母数
 * avg_first_win_rate_race_count に保存している（BOA-303、マイグレーション122）。以前は
 * races×race_results の90日分を画面から毎回スキャンしていた
 */
export function getVenueFirstWinRateRanking(minRaceCount = 3) {
    return withCache(
      `venue-first-win-rate-ranking-v3-${minRaceCount}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const { data } = await supabase
          .from("venues")
          .select("code, avg_first_win_rate, avg_first_win_rate_race_count")
          .not("avg_first_win_rate", "is", null)
          .gte("avg_first_win_rate_race_count", minRaceCount);
        return (data ?? [])
          .map((v) => ({
            venue_code: v.code,
            race_count: v.avg_first_win_rate_race_count,
            first_win_rate: v.avg_first_win_rate * 100,
          }))
          .sort((a, b) => b.first_win_rate - a.first_win_rate);
      },
    );
  }

/**
 * 会場別・枠番別のトップスタート実績（回数/確率、トップスタート時の1着率）を取得する（BOA-154）
 * 日次バッチ（scripts/daily/update-top-start-stats.js）で事前集計したテーブルを参照する
 */
export function getTopStartStats(venueCode) {
    return withCache(`top-start-stats-${venueCode}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { venue_code: venueCode, last_updated: null, data: [] };
      }

      const { data } = await supabase
        .from("top_start_stats")
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
 * 会場別・枠番別の負け決まり手（1着を逃した際、勝者がどの決まり手で勝ったか）を取得する（BOA-157）
 * 既存のgetWinningTechniqueStatsと対になる。v1ではEdge API連携は行わず、Supabase直接クエリのみ
 */
export function getLosingTechniqueStats(venueCode) {
    return withCache(`losing-technique-stats-${venueCode}`, async () => {
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
        .from("losing_technique_stats")
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

      // 枠ごとのまとめは src/utils/losingTechnique.js（2026-10-25、全貌動画の材料と共有するため手を加えずに移した）
      const { last_updated: lastUpdated, data: techniqueData } =
        groupLosingTechniqueRows(data);

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
 * ST考察の「同コース・同級別の平均」ベースラインを取得する（phase a FR-1、ADR-0068）。
 *
 * `st_course_baseline` はコース(1〜6) × 級別(A1/A2/B1/B2) の24行だけの
 * 事前集計テーブル（日次バッチ update-course-baseline-stats.js が更新する）。
 * レース詳細を開くたびに約56万行を集計するのは非機能要件（Disk IO予算・
 * +3クエリ以内）に反するため、画面は単純なSELECTで読む。
 *
 * 取得エラーは例外になる（supabaseClient.js が .throwOnError() を既定適用）。
 * 094未適用の環境では権限エラーになるので、呼び出し側は
 * 「セクションを出さない」に倒す（ピットレポートと同じ扱い）。
 *
 * キーにスキーマ版（-v1）を含める: 094をロールバックした場合、成功レスポンスが
 * クライアントのlocalStorageに残りうるため、キーを変えて無効化できるようにする
 */
export function getStCourseBaseline() {
    return withCache("st-course-baseline-v1", async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      try {
        const { data } = await supabase
          .from("st_course_baseline")
          .select(
            "course, grade, window_start, window_end, window_days, runs, avg_st, stable_rate, late_rate, breakout_count, breakout_rate, st_histogram",
          )
          .order("course")
          .order("grade");
        return data ?? [];
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 094（匿名へのSELECT公開）が未適用の間はここを通る。
          // withCacheに保存させないためfetchFailedを付ける
          return { state: "forbidden", rows: [], fetchFailed: true };
        }
        throw error;
      }
    });
  }
