// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: racer）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { officialPeriodOf } from "../components/race/basicInfoStats.js";
import { fetchAllPages } from "./fetchAllPages.js";
import { FETCH_ALL_BY_IN_ORDER, fetchAllByIn, withCache } from "./core.js";

/**
 * 1選手の race_entries を、race_id が sinceRaceId 以降の窓で全件取る（BOA-1051）。
 * 1選手でも730日の窓では最大で約1460走（1日2走×730日）になりうるので、1000行の上限で
 * 黙って切れないよう、主キーで並べて .range() のページを読み切る。2026-10-25 の本番の実測で
 * 最大は1人290行（DB の開始 2025-12-02 からの約11か月分）で、まだ届いていない
 */
export function fetchRacerEntriesSince(racerId, select, sinceRaceId) {
  return fetchAllPages((from, to) => {
    let query = supabase
      .from("race_entries")
      .select(select)
      .eq("racer_id", racerId)
      .gte("race_id", sinceRaceId);
    for (const key of FETCH_ALL_BY_IN_ORDER.race_entries) {
      query = query.order(key);
    }
    return query.range(from, to);
  });
}

/**
 * 指定選手の全国勝率の節ごとの推移を取得する（BOA-152）
 * race_entries.win_rate/local_win_rate は節単位でのみ更新されるため、
 * モーター調子と同じく日付単位でdedupeして推移として扱う
 */
export function getRacerFormTrend(racerId) {
    return withCache(`racer-form-trend-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, trend: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];

      const { data } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", cutoff)
        .order("race_id");

      // 日付単位でdedupe（同日の複数レースは同じ値のため最初の1件を採用）
      const byDate = new Map();
      (data ?? [])
        .map((e) => ({ ...e, race_date: e.race_id.slice(0, 10) }))
        .forEach((e) => {
          if (!byDate.has(e.race_date)) {
            byDate.set(e.race_date, {
              date: e.race_date,
              win_rate: e.win_rate,
              local_win_rate: e.local_win_rate,
            });
          }
        });

      return { racer_id: racerId, trend: [...byDate.values()] };
    });
  }

/**
 * 指定選手の現在の全国勝率と約90日前時点の全国勝率を比較する（選手個人ページ用）
 * getRaceRacerFormBreakdownと同じ比較ロジックをracer_id単体向けに転用したもの
 */
export function getRacerFormSummary(racerId) {
    return withCache(`racer-form-summary-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data: current } = await supabase
        .from("race_entries")
        .select("race_id, win_rate, local_win_rate")
        .eq("racer_id", racerId)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!current) {
        return null;
      }

      // 約90日前時点の直近の記録を探す（cutoff以前・探索窓2週間で最新のもの）
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoff = ninetyDaysAgo.toISOString().split("T")[0];
      const windowStart = new Date(ninetyDaysAgo);
      windowStart.setDate(windowStart.getDate() - 14);
      const windowStartStr = windowStart.toISOString().split("T")[0];

      const { data: past } = await supabase
        .from("race_entries")
        .select("win_rate")
        .eq("racer_id", racerId)
        .gte("race_id", windowStartStr)
        .lte("race_id", cutoff)
        .order("race_id", { ascending: false })
        .limit(1)
        .maybeSingle();

      const pastWinRate = past?.win_rate ?? null;
      return {
        racer_id: racerId,
        current_win_rate: current.win_rate,
        current_local_win_rate: current.local_win_rate,
        past_win_rate: pastWinRate,
        delta: pastWinRate !== null ? current.win_rate - pastWinRate : null,
      };
    });
  }

/**
 * 指定選手が過去90日間で勝った時の決まり手構成比を取得する（選手個人ページ用）
 * getRaceTechniqueProfileBreakdownのクライアント集計ロジックをracer_id単体向けに
 * 転用したもの。対象が1選手のみのためRPC化は不要（egress負荷が小さい）
 */
export function getRacerTechniqueProfile(racerId) {
    return withCache(`racer-technique-profile-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      const cutoffStr = ninetyDaysAgo.toISOString().split("T")[0];

      const { data: entries } = await supabase
        .from("race_entries")
        .select("race_id, boat_number")
        .eq("racer_id", racerId)
        .gte("race_id", cutoffStr);

      if (!entries || entries.length === 0) {
        return { racer_id: racerId, win_count: 0, techniques: [] };
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const resultRows = await fetchAllByIn(
        "race_results",
        "race_id, rank1, winning_technique",
        "race_id",
        raceIds,
      );

      const resultByRaceId = new Map();
      resultRows.forEach((r) => {
        if (!r.winning_technique || r.rank1 === null) return;
        resultByRaceId.set(r.race_id, r);
      });

      const counts = new Map();
      entries.forEach((e) => {
        const result = resultByRaceId.get(e.race_id);
        if (!result || result.rank1 !== e.boat_number) return; // この選手が勝ったレースのみ集計
        counts.set(
          result.winning_technique,
          (counts.get(result.winning_technique) ?? 0) + 1,
        );
      });

      const winCount = [...counts.values()].reduce((s, c) => s + c, 0);
      const techniques = [...counts.entries()]
        .map(([technique, count]) => ({
          technique,
          count,
          percentage: winCount > 0 ? (count / winCount) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      return { racer_id: racerId, win_count: winCount, techniques };
    });
  }

/**
 * 指定選手の平均ST等の集計統計を取得する（選手個人ページ用）
 * scripts/analysis/aggregate-racer-stats.jsが日次で事前集計したracer_aggregated_stats
 * （venue_code=0は全会場合算のレコード）を参照する
 */
export function getRacerAggregatedStats(racerId) {
    return withCache(`racer-aggregated-stats-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return null;
      }

      const { data } = await supabase
        .from("racer_aggregated_stats")
        .select(
          "avg_st, avg_st_last_30, st_stddev, flying_rate, total_races, course_race_counts",
        )
        .eq("racer_id", racerId)
        .eq("venue_code", 0)
        .maybeSingle();

      return data;
    });
  }

/**
 * 選手ページの「平均ST（公式）」（BOA-815）。公式の出走表がその日に出している期（officialPeriodOf）の
 * racer_period_stats.avg_st（2桁）。選手ページは節に紐づかないので、期は日付だけで決める
 * （節の途中で期が替わる数日だけ、出走表の値と1期ずれることがある）。行が無い選手（新人など）は null
 * @param {number|string} racerId
 * @param {string} date `YYYY-MM-DD`（JST の今日）
 * @returns {Promise<{period: {periodYear: number, periodNo: number, calcFrom: string, calcTo: string}|null, avgSt: number|null}>}
 */
export function getRacerOfficialAvgSt(racerId, date) {
    const period = officialPeriodOf(date);
    if (!period || !racerId) return Promise.resolve({ period, avgSt: null });
    return withCache(
      `racer-official-avg-st-v1-${racerId}-${period.periodYear}-${period.periodNo}`,
      async () => {
        if (!supabase) throw new Error("Supabase client not initialized");
        const { data } = await supabase
          .from("racer_period_stats")
          .select("avg_st")
          .eq("racer_id", racerId)
          .eq("period_year", period.periodYear)
          .eq("period_no", period.periodNo)
          .maybeSingle();
        return {
          period,
          avgSt: data?.avg_st != null ? Number(data.avg_st) : null,
        };
      },
    );
  }

/**
 * 選手ページの公式の期別成績・進入コース別成績（GS00）用に、racer_period_stats の全期を取る。
 * 1選手あたり最大15行（2019年後期〜）。表示用の整形は src/utils/racerOfficialPeriodStats.js
 */
export function getRacerAllPeriodStats(racerId) {
    const courseCols = [1, 2, 3, 4, 5, 6]
      .flatMap((c) =>
        [
          "entries",
          "p1",
          "p2",
          "p3",
          "avg_st",
          "f",
          "l0",
          "l1",
          "k0",
          "k1",
        ].map((k) => `c${c}_${k}`),
      )
      .join(", ");
    return withCache(`racer-period-stats-v1-${racerId}`, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");
      try {
        const { data } = await supabase
          .from("racer_period_stats")
          .select(
            `period_year, period_no, calc_from, calc_to, grade, win_rate, top2_rate, starts, first_count, second_count, finals, wins, avg_st, ${courseCols}`,
          )
          .eq("racer_id", racerId)
          .order("period_year", { ascending: false })
          .order("period_no", { ascending: false });
        return data ?? [];
      } catch (error) {
        throw new Error(
          "racer_period_stats の読み込みに失敗: " + error.message,
          {
            cause: error,
          },
        );
      }
    });
  }

/**
 * 選手検索UI向けに全選手の軽量一覧を取得する。
 * 対象約1,627件・数十KB程度のため都度クエリではなく一括取得し長期キャッシュする
 * （選手数の変動は月数件程度、egress削減のため24時間キャッシュ）。
 * 検索自体はこのデータをクライアント側でフィルタする（RacerSearchBox.jsx参照）。
 * racer_profilesは1,627件でSupabaseのデフォルトlimit(1000行)を超えるため、
 * .range()でページネーションして全件取得する必要がある
 * （2026-09-08、ページネーション漏れで約4割の選手が検索に出てこないバグを発見・修正）。
 * キャッシュキーは取得列を変更するたびにサフィックスを上げる（v2で列追加）。
 * 24時間TTLのため、キー名を変えずに列だけ増やすと、変更前にキャッシュ済みの
 * ブラウザが新しい列（登録期・出身地等）を含まない古いデータを最大24時間
 * 表示し続けてしまう（2026-09-08、実機確認で発覚）
 */
export function getAllRacersLite() {
    return withCache(
      "all-racers-lite-v2",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const data = [];
        const pageSize = 1000;
        let from = 0;
        while (true) {
          const { data: page } = await supabase
            .from("racer_profiles")
            .select(
              "racer_id, name, name_kana, branch, height_cm, weight_kg, registration_period, hometown, birth_date",
            )
            .order("racer_id")
            .range(from, from + pageSize - 1);

          if (!page || page.length === 0) break;
          data.push(...page);
          if (page.length < pageSize) break;
          from += pageSize;
        }
        return data;
      },
      24 * 60 * 60 * 1000,
    );
  }

/**
 * 選手ごとの最新級別・勝率（race_entriesの最新行、ADR-0023準拠）を
 * racer_grade_cache（scripts/daily/update-racer-grade-cache.jsが夜間更新）
 * から取得する（docs/adr/0052-racer-grade-win-rate-cache-strategy.md）
 */
export function getRacerGradeCache() {
    return withCache(
      "racer-grade-cache",
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }
        const { data } = await supabase
          .from("racer_grade_cache")
          .select("data")
          .eq("key", "latest_grades")
          .single();

        return data?.data ?? [];
      },
      24 * 60 * 60 * 1000,
    );
  }

/**
 * 選手検索・一覧（RacerSearchBox・/racers）向けに、選手プロフィールと
 * 最新級別・勝率をマージした一覧を取得する
 * （docs/design/racer-search-and-list/plan.md参照）
 */
export async function getAllRacersWithGrade() {
    const [racers, grades] = await Promise.all([
      getAllRacersLite(),
      getRacerGradeCache(),
    ]);
    const gradeByRacerId = new Map(grades.map((g) => [g.racer_id, g]));
    return racers.map((racer) => {
      const gradeInfo = gradeByRacerId.get(racer.racer_id);
      return {
        ...racer,
        grade: gradeInfo?.grade ?? null,
        winRate: gradeInfo?.win_rate ?? null,
      };
    });
  }
