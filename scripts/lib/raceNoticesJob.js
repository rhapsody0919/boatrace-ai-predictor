/**
 * レース特記事項（A5、race_special_notes）の共通ラッパ向けハンドラー（BOA-353 T4b-11-1、plan.md §2.2）。
 * api/cron/race-notices.js が createScrapeCronHandler の run に渡す。
 *
 * 従来（waitUntil で即時に 202 を返し、バックグラウンドで実行）との違い:
 *   - 応答: 処理の完了後に 200/500 を返す（失敗が HTTP ステータスと scrape_job_state に残る）
 *   - 排他: ジョブ単位のリース（cron-job.org と Vercel Cron の両方から起動されても、同時に1つだけ走る）
 *   - DB障害: getRaceSchedule は throwOnError で呼び、DBの読み書きの失敗は例外にする
 *     （「対象なし」「成功」にしない。G13）。全会場の取得に失敗したときも失敗にする
 *   - mode: shadow は取得・解析のみ（race_special_notes・race_notices_health へ書かない）。off は何もしない
 *   - 取得: politeFetch（15秒タイムアウト・429/503のバックオフ・サーキットブレーカー）、会場は並列 RACE_NOTICES_CONCURRENCY
 *   - race_notices_health は、変更のある行だけ書く（D9）
 */
import { getRaceSchedule } from "./raceSchedule.js";
import { toJstDateString } from "./scrapeJobs/time.js";
import {
  createInformationFetcher,
  run as runRaceInformation,
} from "../daily/scrape-race-information.js";

/** 会場（1ページ）の同時取得数。1ページ約8〜10秒のため、13〜24会場を、cron-job.org の30秒に近い時間で終える */
export const RACE_NOTICES_CONCURRENCY = 6;

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx）
 * @param {Object} [deps] テスト用の差し替え
 * @returns {Promise<{rowsWritten: number, report: Object, body: Object}>}
 */
export async function runRaceNoticesJob(
  ctx,
  {
    getSchedule = getRaceSchedule,
    runInformation = runRaceInformation,
    concurrency = RACE_NOTICES_CONCURRENCY,
  } = {},
) {
  // 日次ジョブ（22:30指定）。対象日は共通ラッパが指定時刻から解決する（23:00・23:30 の補足の起動も同じ日）
  const date = ctx.targetDate ?? toJstDateString(ctx.now());
  // DB障害を「開催会場なし」にしない（getRaceSchedule の既定も例外。BOA-391。意図を明示するため指定を残す）
  const schedule = await getSchedule(date, {
    throwOnError: true,
    client: ctx.client,
  });
  if (schedule.length === 0) {
    // 朝の初期化（races）の前、または開催の無い日。races が空のままの検知は、監視（plan.md §7）の役割
    return {
      rowsWritten: 0,
      report: { date, mode: ctx.mode, skipped: "no_schedule" },
      body: { date, skipped: "no_schedule" },
    };
  }

  const result = await runInformation(schedule, date, {
    client: ctx.client,
    fetchPage: createInformationFetcher(ctx.politeFetch),
    dryRun: ctx.mode === "shadow",
    strict: true,
    concurrency,
    shouldStop: ctx.shouldStop,
  });

  // 全ての会場で取得・解析に失敗した（取得できた会場が1つも無い）実行は、失敗にする。一部の会場だけの失敗は、
  // 集計行（race_notices_health）に記録され、構造変化の監視（check-race-notices-drift.js）が判定する
  if (
    result.venuesChecked > 0 &&
    result.venuesFailed.length === result.venuesChecked
  ) {
    const reasons = [...new Set(result.venuesFailed.map((v) => v.reason))];
    throw new Error(
      `全${result.venuesChecked}会場の取得・解析に失敗しました（${reasons.join(", ")}）`,
    );
  }

  const summary = {
    date,
    mode: ctx.mode,
    venuesChecked: result.venuesChecked,
    venuesFailed: result.venuesFailed,
    venuesNotAttempted: result.venuesNotAttempted,
    notesParsed: result.notesParsed,
    rowsUnparsed: result.rowsUnparsed,
    venuesWithUnparsedRows: result.venuesWithUnparsedRows,
    notesInserted: result.notesInserted,
    healthWritten: result.healthWritten,
    healthSkipped: result.healthSkipped,
    digest: result.digest,
    // N28調査用の暫定計測（2026-09-23）。通知を検出した会場×日と生HTMLの保管先を
    // last_report に残す。race_special_notesが稼働開始から0件のままで、パーサーの
    // 不具合か通知自体が無いのかを実例が出るまで判別できなかったため
    capturedPages: result.capturedPages,
  };
  // 通知の表に行があるのに解析できなかった（BOA-373）。「通知なし」の正常と区別できるよう、監視
  // （scrape-monitor の last_report.alerts）へ通知する。取得できた行は保存済みのため、実行は失敗にしない
  const alerts =
    result.rowsUnparsed > 0
      ? [
          {
            key: "rows_unparsed",
            text: `通知の表に行があるのに解析できなかった ${result.rowsUnparsed}行（${result.venuesWithUnparsedRows
              .map((v) => `会場${v.venueCode}: ${v.rows}行`)
              .join(
                "、",
              )}）。パーサーの想定外の書式か、ページの構造変化の可能性`,
          },
        ]
      : [];
  return {
    rowsWritten: result.notesInserted + result.healthWritten,
    report: alerts.length > 0 ? { ...summary, alerts } : summary,
    body: summary,
    // 取得に失敗した会場・時間切れで着手しなかった会場があれば、対象日を処理済みにしない。夜1回の取得なので、
    // 一時的な失敗で、その会場の1日分（race_notices_health の had_success）が欠けないよう、補足の起動
    // （23:00・23:30）が取り直す。had_success は前の起動の成功を引き継ぐ（scrape-race-information.js）
    incomplete:
      result.venuesFailed.length > 0 || result.venuesNotAttempted.length > 0,
  };
}
