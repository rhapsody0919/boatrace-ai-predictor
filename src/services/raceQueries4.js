// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: race）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { shapeOriginalExhibition } from "../utils/originalExhibition.js";
import { isPermissionDeniedError, withCache } from "./core.js";
import { NON_TERMINAL_PIT_REPORT } from "./raceQueries.js";

/**
 * 1レース分の各艇スタートタイミングを取得する（BOA-238）。
 * race_start_timingsは1レースにつき最大6行の1対多テーブルのため、一覧表示用の
 * getPredictions()/RPCには含めず、レース詳細ページ表示時にRaceResult.jsxから
 * この関数で個別に軽量フェッチする
 */
export async function getRaceStartTimings(raceId) {
    if (!supabase || !raceId) return [];
    // 進入は本番STの entry_course（2026-09-21 からほぼ全件）を先に、無ければ Kファイル由来の
    // race_results.actual_course_<艇番>（翌日以降に入る）で埋める（BOA-625。徳山 9/14 7R は
    // entry_course が無いが actual_course はある）
    const [{ data }, { data: courseRow }] = await Promise.all([
      supabase
        .from("race_start_timings")
        .select(
          "boat_number, start_timing, is_flying, is_late_start, finish_mark, finish_rank, entry_course",
        )
        .eq("race_id", raceId)
        .order("boat_number"),
      supabase
        .from("race_results")
        .select(
          "actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
        )
        .eq("race_id", raceId)
        .maybeSingle(),
    ]);

    if (!data) return [];

    // finish_mark / finish_rank（077、2026-09-21から全件）は結果タブの着順の組み立てに使う
    // （BOA-543）。rank1〜rank6 は公式ページの並び順のままで返還艇（F・L・欠）が混ざるため
    return data.map((row) => ({
      boatNumber: row.boat_number,
      startTiming: row.start_timing,
      isFlying: row.is_flying,
      isLateStart: row.is_late_start,
      finishMark: row.finish_mark ?? null,
      finishRank: row.finish_rank ?? null,
      // 進入コース（結果ページのスタート情報の行順、077）。結果タブの進入の表示に使う（BOA-625）。
      // race_results.course_1〜6 は枠番と同じ値の旧列なので使わない
      entryCourse:
        row.entry_course ??
        courseRow?.[`actual_course_${row.boat_number}`] ??
        null,
    }));
  }

/**
 * レースのピットレポート（選手コメント）を取得する（BOA-379）
 * 設計: docs/design/pit-comments/screens.md §9（データの契約）
 *
 * RPCを増やさず、race_id単位の単独SELECTを2本（レース単位・艇単位）で読む。
 * 呼ぶ前に、画面側で isPitReportCandidate（src/utils/pitReportUrl.js）を必ず通すこと
 * （G3・一般戦・G1/G2の1R〜6Rでは呼ばない）。
 *
 * 戻り値の state:
 *   "published"  コメントあり
 *   "not_target" 公式ページが「対象外」と答えたレース（行はあるがコメント0件）
 *   "pending"    行が無い＝まだ公開されていない（または対象外の判定もまだ）
 *   "forbidden"  匿名にSELECT権限が無い（マイグレーション086が未適用）。
 *                画面はセクションごと出さない。「対象外」「未公開」に化けさせない
 * 取得失敗（ネットワーク等）は例外を投げる（BOA-359。空・対象外に化けさせない）
 */
export function getRacePitReport(raceId) {
    return withCache(`pit-report-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      // supabaseClient.js が .throwOnError() を既定で適用するため、取得エラーは
      // ここに到達する前に例外になる。権限エラー（086未適用）だけは例外にせず
      // 「セクションを出さない」に倒したいので、ここで捕まえて分岐する
      let reportRes;
      let commentsRes;
      try {
        [reportRes, commentsRes] = await Promise.all([
          supabase
            .from("race_pit_reports")
            .select(
              "status, target_from, target_to, reporter_name, comment_count, created_at, updated_at",
            )
            .eq("race_id", raceId)
            .maybeSingle(),
          supabase
            .from("race_pit_comments")
            .select(
              "boat_number, racer_id, comment_text, confidence_stars, previous_race_number",
            )
            .eq("race_id", raceId)
            .order("boat_number", { ascending: true }),
        ]);
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 086（匿名へのSELECT公開）が未適用の間は、ここを通る。本番の公開順序の保険で、
          // エラー表示ではなく「セクションを出さない」に倒す
          return { ...NON_TERMINAL_PIT_REPORT, state: "forbidden" };
        }
        throw error;
      }

      const report = reportRes.data;
      if (!report) return { ...NON_TERMINAL_PIT_REPORT, state: "pending" };
      const comments = (commentsRes.data ?? []).map((row) => ({
        boatNumber: row.boat_number,
        racerId: row.racer_id ?? null,
        text: row.comment_text,
        stars: row.confidence_stars ?? null,
        previousRaceNumber: row.previous_race_number ?? null,
      }));

      return {
        // 行はあるがコメントが0件なら、公式が「対象外」と答えたレース
        state: comments.length > 0 ? "published" : "not_target",
        reporterName: report.reporter_name ?? null,
        capturedAt: report.created_at ?? null,
        updatedAt: report.updated_at ?? null,
        targetRange:
          report.target_from != null && report.target_to != null
            ? { from: report.target_from, to: report.target_to }
            : null,
        comments,
      };
    });
  }

/**
 * オリジナル展示（一周・半周ラップ・まわり足・直線）を1レース分取得する
 * （phase a FR-4b / [BOA-452](https://linear.app/boat-ai/issue/BOA-452)）。
 *
 * 出所はBOATCAST（`race.boatcast.jp`、BOATRACE振興会の公式Web映像サービス）。
 * [ADR-0067](docs/adr/0067-official-site-content-redisplay-policy.md) が
 * 「取得した値は保存のみ。画面に再表示するには別途ユーザーの承認と出典表記の
 * 設計が要る」としている区分なので、画面側は必ず出典を添えて出す。
 *
 * 戻り値の `state`:
 *   "published" 値がある
 *   "empty"     まだ取得できていない（計測前・未公開）→ 行を出さない
 *   "forbidden" 匿名にSELECT権限が無い（マイグレーション096が未適用）→ 行を出さない
 * 取得失敗（ネットワーク等）は例外を投げる（BOA-359。空に化けさせない）
 *
 * クエリは**2本**（ヘッダ1・値1）。値は6艇 × 最大4項目 = 最大24行。
 * 直前情報タブを開いたときだけ走る（RaceTabs は非アクティブタブを
 * アンマウントする）。
 */
export function getRaceOriginalExhibition(raceId) {
    return withCache(`original-exhibition-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      let headerRes;
      let valueRes;
      try {
        [headerRes, valueRes] = await Promise.all([
          supabase
            .from("race_original_exhibition")
            .select("item_labels, updated_at")
            .eq("race_id", raceId)
            .maybeSingle(),
          supabase
            .from("race_original_exhibition_values")
            .select("boat_number, kind, value")
            .eq("race_id", raceId),
        ]);
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 096（匿名へのSELECT公開）が未適用の間はここを通る。
          // 「データ無し」ではなく forbidden として返し、画面は行ごと出さない
          // fetchFailed を付けて withCache に保存させない。付け忘れると、
          // 096の適用前に開いた過去レースが7日間ずっと forbidden のまま固着する
          return {
            state: "forbidden",
            capturedAt: null,
            kinds: [],
            byBoat: {},
            fetchFailed: true,
          };
        }
        throw error;
      }

      // 整形は src/utils/originalExhibition.js（2026-10-25、全貌動画の材料と共有するため手を加えずに移した）
      return shapeOriginalExhibition(headerRes.data, valueRes.data ?? []);
    });
  }
