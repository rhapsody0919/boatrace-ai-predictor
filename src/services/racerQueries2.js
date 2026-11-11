// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: racer）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";
import { buildRacerScopedRaceRows } from "./racerScopedRaceRows.js";
import { buildRacerRaceHistoryRows } from "./racerRaceHistoryRows.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import { racerHistoryCutoff } from "../utils/racerVenueBoatStats.js";
import { fetchAllByIn, withCache } from "./core.js";
import { fetchRacerEntriesSince } from "./racerQueries.js";

/**
 * 指定選手の会場別（当地）成績を取得する（選手個人ページ用）
 * racer_aggregated_statsは本番では venue_code=0（全会場合算）の行しか
 * 存在せず（会場別集計は日次自動化に未組み込み、2026-09-06確認）、
 * 会場別行を前提にはできない。そのためgetRacerBoatReturnRate等と同じ
 * 「対象は1選手のみなのでその場でライブ集計する」方式で
 * race_entries×races×race_resultsから直接算出する
 */
export function getRacerVenueStats(racerId) {
    // v3: race_entries を1000行で切らずに取り切るようにした（BOA-1051）
    return withCache(`racer-venue-stats-v3-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      // 過去2年分を対象（他のracer_id単体集計は90〜180日窓だが、
      // 会場別成績は会場ごとの出走機会自体が少ないため長めに取る）。
      // 窓は730日だが、DBは2025-12-02からしか無いので実際はそれ以降になる。
      // 画面の注記は「2025年12月以降・最大過去2年」と開始月を直書きしている
      // （BOA-503。getRacerScopedRaceStats/getRacerRaceHistoryも同じ窓）。
      // 2027-12-03以降は窓の始点がデータの開始日を越えて直書きが誤りになるため、
      // その時点で注記（locales の basicInfo/wakuInfo.periodCaveat、
      // beforeInfo.detailTableNote、locales の termHints.*、RacerPerformanceStats.jsx）を見直す
      const cutoffStr = racerHistoryCutoff();

      const entries = await fetchRacerEntriesSince(
        racerId,
        "race_id, boat_number",
        cutoffStr,
      );

      if (entries.length === 0) {
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows] = await Promise.all([
        fetchAllByIn("races", "race_id, venue_code", "race_id", raceIds),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, race_status",
          "race_id",
          raceIds,
        ),
      ]);

      const venueByRaceId = new Map(
        raceRows.map((r) => [r.race_id, r.venue_code]),
      );
      const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

      const byVenue = new Map();
      entries.forEach((entry) => {
        const venueCode = venueByRaceId.get(entry.race_id);
        const result = resultByRaceId.get(entry.race_id);
        if (!venueCode || !isUsableRaceResult(result)) return;

        if (!byVenue.has(venueCode)) {
          byVenue.set(venueCode, { total: 0, wins: 0, top2: 0, top3: 0 });
        }
        const stat = byVenue.get(venueCode);
        stat.total += 1;
        if (result.rank1 === entry.boat_number) stat.wins += 1;
        if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
          stat.top2 += 1;
        }
        if (
          isShowHit(entry.boat_number, result.rank1, result.rank2, result.rank3)
        ) {
          stat.top3 += 1;
        }
      });

      // 出走数が同じ会場は会場コードの順（BOA-1051）。以前は race_entries を並びなしで取っていたので、
      // 同数の会場の並びが DB の返す順で決まり、取り方を変えると入れ替わった
      return [...byVenue.entries()]
        .map(([venueCode, stat]) => ({
          venue_code: venueCode,
          total_races: stat.total,
          win_rate: stat.total > 0 ? stat.wins / stat.total : null,
          top2_rate: stat.total > 0 ? stat.top2 / stat.total : null,
          top3_rate: stat.total > 0 ? stat.top3 / stat.total : null,
        }))
        .filter((row) => row.total_races >= 5)
        .sort(
          (a, b) =>
            b.total_races - a.total_races ||
            Number(a.venue_code) - Number(b.venue_code),
        );
    });
  }

/**
 * 指定選手の過去2年分の出走履歴を、レース詳細ページ「基本情報」タブ
 * （BOA-306）の会場/グレード/期間フィルタ用にフラットな形で1回だけ取得する。
 * getRacerVenueStats/getRacerRaceHistoryと同じ「対象は1選手のみなのでその場で
 * ライブ集計する」方式（BOA-303が問題視する全選手×全会場の横断集計とは
 * スコープが異なる）。フィルタの絞り込み・集計自体はクライアント側の
 * aggregateBasicInfoStats（basicInfoStats.js）が担い、この関数はracerId単位で
 * キャッシュ可能な生データの取得のみ担当する
 *
 * 2026-09-16追記(BOA-304、直前情報タブ): actualCourse（実進入コース、BOA-257の
 * race_results.actual_course_N）とisFastestExhibition（当該レースで自分の
 * 展示タイムが単独最速だったか）を追加した。直前情報タブの「平均進入順」
 * 「展示タイム1位勝率」が、基本情報タブと同じこの生データを再利用して
 * クライアント側で集計する（beforeInfoStats.js）。同着最速は
 * scripts/daily/update-exhibition-time-top-stats.jsの既存集計と同じ規約で
 * スキップする（isFastestExhibitionをnullにし分母から除外）
 *
 * 2026-09-16追記(BOA-333「直近5走」レビュー指摘): raceTitle/raceStage
 * （race_conditions）とwinningTechnique/payoutWin（race_results）を追加した。
 * 「直近5走」がgetRacerRaceHistory()由来のRaceHistoryTable（BOA-159）と
 * 同じ列を表示するようになったため、この関数もそれと同じ列を取得する必要が
 * 生じたため（元々はBOA-306の勝率/2連対率/3連対率/平均ST集計にしか
 * 使っておらず不要だった）
 */
export function getRacerScopedRaceStats(racerId) {
    // v2: 条件別タブ（phase a FR-2）のために waveHeight / seriesDay / isFinalDay を
    // 足したので版を上げる。古い形のキャッシュが返ると、これらが undefined になって
    // 「波5cm以上 n=0」のような誤った値が出る。このキーは inferTtlFromKey に
    // マッチせず30分TTLなので、旧エントリが残る窓は最大30分
    // v3: 今節タブの展示タイム推移（phase a FR-3のPhase A）のために
    // exhibitionTime を足した。同じ理由で版を上げる
    // v4: 展示は絶対値でなく同レース内の順位で見ることにしたので
    // exhibitionRank を足した（水面の影響を相殺するため）
    // v5: 欠場（absent）を足した（BOA-504）
    // v6: 着順が付かない走の公式の記号（finishMark）を足した（BOA-537）
    // v7: 同じ日の走を R の古い順に並べ直した（BOA-588）
    // v8: フライングの走の ST（flyingStartTiming）を足した（BOA-583。直近10走・今節の表で「F.01」と出すため）
    // v11: race_entries を1000行で切らずに取り切るようにした（BOA-1051）
    // v12: 出遅れの ST を平均から除き、表用の lateStartTiming に持つ（BOA-1052）
    return withCache(`racer-scoped-race-stats-v12-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const cutoffStr = racerHistoryCutoff();

      // gradeはST考察のベースライン（st_course_baselineの(course, grade)セル）を
      // 引くのに使う（phase a FR-1）。race_entries.gradeは実測でnull 0件・4値（A1/A2/B1/B2）
      const entries = await fetchRacerEntriesSince(
        racerId,
        "race_id, boat_number, grade, f_count",
        cutoffStr,
      );

      if (entries.length === 0) {
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      // race_gradeはraces側のカラム（race_conditions側は017マイグレーションで
      // 削除済み）。race_conditions.series_day/is_final_dayは**下記で取得する**。
      // 以前ここには「generate-predictions.jsが常にnullを書くため取得しない」と
      // 書いてあったが、BOA-226（update-race-info.jsのscrapeSeriesDay()）と
      // BOA-390のバックフィルで埋まり、条件別タブ（phase a FR-2）の初日・最終日行が
      // 実際にこの2列を読んでいる（2026-09-28実測で2026-02-01以降
      // 36,607/36,629行＝99.94%。残る22行は当日＝スクレイプ前の分）。
      // ただし2025-12は12行・2026-01は0行で、選手の窓の前半はrace_conditionsの
      // 行そのものが無い（BOA-498）。
      // rank4〜6はBOA-238で追加（過去データは未バックフィルのためnullのままの
      // 行がある）。start_timingは平均ST（BOA-306フィードバック#1で会場/グレード
      // フィルタ対応が必要になったため追加、race_start_timingsから取得）。
      // actual_course_1〜6はBOA-257（Kファイル方式の実進入コース、2025-12-04以降
      // のみバックフィル済み）
      const [
        raceRows,
        resultRows,
        startTimingRows,
        exhibitionRows,
        conditionRows,
      ] = await Promise.all([
        fetchAllByIn(
          "races",
          "race_id, race_date, venue_code, race_grade",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, rank4, rank5, rank6, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6, winning_technique, payout_win",
          "race_id",
          raceIds,
        ),
        fetchAllByIn(
          "race_start_timings",
          // finish_mark: 欠場の走を「着外」でなく「欠場」と出すため（BOA-504）
          "race_id, boat_number, start_timing, is_flying, is_late_start, finish_mark, entry_course",
          "race_id",
          raceIds,
        ),
        // 展示タイム1位判定には自艇だけでなく同レースの全艇分が必要
        fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time",
          "race_id",
          raceIds,
        ),
        // レース名・レース種別（「直近5走」表示用、BOA-333レビュー指摘）。
        // 勝率/2連対率/3連対率/平均ST/得意会場等の既存機能はこのクエリに依存
        // していないため、ここだけ失敗してもPromise.all全体を巻き込んで
        // 既存機能まで空にしないよう、個別にcatchしてフォールバックする
        fetchAllByIn(
          "race_conditions",
          "race_id, race_stage, race_title, wave_height, series_day, is_final_day",
          "race_id",
          raceIds,
        ).catch((err) => {
          console.error(
            "race_conditions取得エラー（レース名・種別は「-」表示にフォールバック）:",
            err?.message ?? String(err),
          );
          // [] ではなく null を返す。[] だと「取得できなかった」と「その期間は
          // race_conditions の行が無い」が区別できず、条件別タブ（FR-2）が
          // 波・初日・最終日の行に誤った n=0 を出してしまう（.claude/rules/
          // frontend-data-fetch.md §2）。null のときは該当行ごと出さない
          return null;
        }),
      ]);

      // 整形は src/services/racerScopedRaceRows.js（BOA-1022、手を加えずに移した）
      return buildRacerScopedRaceRows({
        entries,
        raceRows,
        resultRows,
        startTimingRows,
        exhibitionRows,
        conditionRows,
      });
    });
  }

/**
 * 指定選手の過去2年分の出走履歴を、会場×枠番クロス集計用にフラットな形で
 * 1回だけ取得する（選手個人ページの会場×枠番フィルタ用）。
 * venueCode/boatNumberによる絞り込みは行わない（=racerIdだけでキャッシュ
 * できる）。フィルタ変更のたびに毎回re-fetchするのではなく、この関数を
 * racerId単位で1回だけ呼び、絞り込み・集計はaggregateRacerVenueBoatStats
 * （src/utils/racerVenueBoatStats.js の純関数）でクライアント側メモリ上に行う設計にして
 * いる（フィルタ操作をネットワークI/O無しの即時計算にするため）。
 * 不成立レース（race_status=no_race。BOA-477）とrank1未確定行は
 * ここで除外し、以降の集計側では意識しなくて済むようにする
 */
export function getRacerRaceHistory(racerId) {
    // v2: ST を展示ST（exhibition_data）から本番ST（race_start_timings）に替え、isFlying・finishMark を足した（BOA-576）
    // v5: 天候・風速・波高を足した（レース条件別の成績、BOA-336）
    // v6: race_entries を1000行で切らずに取り切るようにした（BOA-1051）
    return withCache(`racer-race-history-v6-${racerId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }

      const entries = await fetchRacerEntriesSince(
        racerId,
        "race_id, boat_number",
        racerHistoryCutoff(),
      );

      if (entries.length === 0) {
        return [];
      }

      const raceIds = [...new Set(entries.map((e) => e.race_id))];
      const [raceRows, resultRows, exhibitionRows, conditionRows, stRows] =
        await Promise.all([
          fetchAllByIn(
            "races",
            "race_id, venue_code, race_grade",
            "race_id",
            raceIds,
          ),
          fetchAllByIn(
            "race_results",
            "race_id, rank1, rank2, rank3, rank4, rank5, rank6, winning_technique, payout_win, payout_place_1, payout_place_2, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
            "race_id",
            raceIds,
          ),
          // 展示タイムだけ使う。ここの start_timing は展示ST（本番STではない。BOA-576）
          fetchAllByIn(
            "exhibition_data",
            "race_id, boat_number, exhibition_time",
            "race_id",
            raceIds,
          ),
          fetchAllByIn(
            "race_conditions",
            "race_id, race_stage, race_title, weather, wind_speed, wave_height",
            "race_id",
            raceIds,
          ),
          // 本番ST・フライング・公式の着欄の記号（落・転・妨・欠など）。今節タブ（getRacerScopedRaceStats）と
          // 同じ出どころにそろえる（BOA-576: 展示STを本番STとして出し、記号の走を「着外(順位不明)」と出していた）
          fetchAllByIn(
            "race_start_timings",
            "race_id, boat_number, start_timing, is_flying, finish_mark, entry_course",
            "race_id",
            raceIds,
          ),
        ]);

      // 整形は src/services/racerRaceHistoryRows.js（2026-10-25、全貌動画の材料と共有するため手を加えずに移した）
      return buildRacerRaceHistoryRows({
        entries,
        raceRows,
        resultRows,
        exhibitionRows,
        conditionRows,
        stRows,
      });
    });
  }
