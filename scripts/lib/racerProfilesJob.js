/**
 * 選手プロフィール・期別成績（B6、racer_profiles）の共通ラッパ向けハンドラー（tasks.md T4b-16-1）。
 * api/cron/racer-profiles.js が createScrapeCronHandler の run に渡す。
 *
 * 月次（JST 毎月2日03:00〜05:50。5月・11月は9日・16日も。UTC 基準の1日・8日・15日の夜）に、約1,630人を、複数の呼び出しに分けて処理する
 * （チャンク処理。位置は scrape_job_state.cursor に保存して、次の起動が再開する）:
 *   - 1回の呼び出しは、時間の許す限り（ソフトデッドラインまで。最大 RACER_PROFILES_CHUNK 人）、登録番号の昇順に、
 *     同時 RACER_PROFILES_CONCURRENCY で処理する。1ページ約8〜10秒（2026-09-20の実測）のため、同時4で1回（300秒）あたり約110人（全体で約15回）
 *   - 再開位置は「最後に処理した登録番号」（cursor.afterRacerId）。人数の増減があっても、位置がずれない
 *   - 全員を処理し終えたら、対象日（その日の指定時刻 03:00 JST から解決）を処理済みにする。それまでは incomplete
 *     （対象日を処理済みにせず、10分後の起動が続きを処理する。実行中の起動は、リースで何もしない）
 *   - cursor は、対象日・モード（shadow・live）が一致するときだけ引き継ぐ（shadow の進捗を、live が引き継がない）
 *   - 取得: politeFetch（15秒タイムアウト・429/503のバックオフ・サーキットブレーカー。fetchHtmlWithRetry の再試行は無効にして
 *     二重にしない）
 *   - 失敗: 連続20件の失敗（サイトの停止・書き込みの系統的な失敗）と、新規プロフィールの保存のDBエラーは、実行の失敗
 *     （cursor を進めず、次の起動が同じチャンクをやり直す）。散発的な失敗は、進捗を止めない。サイクルの完了時に、期別成績の
 *     失敗率が MAX_SEASON_FAIL_RATE（従来の CLI と同じ5%）を超えていれば、last_report.alerts → scrape-monitor がSlackへ通知する
 *   - git push（profile-scrape-report.json）はしない。結果は scrape_job_state.last_report
 *   - 起動しない日の未処理を誤報しないため、レジストリの runDaysOfMonth を monitor が見る
 *   - 手動の動作確認: GET /api/cron/racer-profiles?chunk=N（Authorization: Bearer {CRON_SECRET}）で、1回の処理人数を N 人にする
 */
import {
  ABORT_AFTER_CONSECUTIVE_FAILURES,
  MAX_SEASON_FAIL_RATE,
  parseArgs,
  runRacerProfileSync,
} from "./racerProfileSync.js";

/** 1回の呼び出しで処理する人数の上限（時間の許す限り、この人数まで） */
export const RACER_PROFILES_CHUNK = 300;
/** 選手ごとの取得の同時数（1ページ約9秒のため、約0.4リクエスト/秒） */
export const RACER_PROFILES_CONCURRENCY = 4;
/** 0件エラーの判定に必要な、期別成績を取得した選手数の下限 */
const MIN_SAMPLE_FOR_ZERO_GUARD = 10;
/** 手動の動作確認（?chunk=N）の上限 */
const MAX_CHUNK_OVERRIDE = 2000;
/** 期別成績の失敗率の通知を出す期間（日）。次の月次の実行まで last_report が残るため */
const ALERT_NOTIFY_DAYS = 2;
/** last_report に残す、失敗した登録番号の最大数 */
const MAX_FAILED_IDS_IN_REPORT = 20;

const zeroStats = () => ({
  seasonTargets: 0,
  seasonWritten: 0,
  seasonUnchanged: 0,
  seasonNoData: 0,
  seasonFailed: 0,
  profileSuccess: 0,
  profileFailed: 0,
  chunks: 0,
});

const addStats = (stats, summary) => {
  const { season, profile } = summary;
  return {
    seasonTargets:
      stats.seasonTargets +
      season.successCount +
      season.unchangedCount +
      season.noDataCount +
      season.failCount,
    seasonWritten: stats.seasonWritten + season.successCount,
    seasonUnchanged: stats.seasonUnchanged + season.unchangedCount,
    seasonNoData: stats.seasonNoData + season.noDataCount,
    seasonFailed: stats.seasonFailed + season.failCount,
    profileSuccess: stats.profileSuccess + profile.successCount,
    profileFailed: stats.profileFailed + profile.failCount,
    chunks: stats.chunks + 1,
  };
};

/** ?chunk=N の解釈（不正な値は例外にする。無視して全件処理にしない） */
export function resolveChunkSize(query, defaultSize = RACER_PROFILES_CHUNK) {
  const raw = query?.chunk;
  if (raw === undefined || raw === "") return defaultSize;
  if (
    !/^\d+$/.test(String(raw)) ||
    Number(raw) < 1 ||
    Number(raw) > MAX_CHUNK_OVERRIDE
  ) {
    throw new Error(
      `chunk は1〜${MAX_CHUNK_OVERRIDE}の整数で指定してください: ${String(raw)}`,
    );
  }
  return Number(raw);
}

/**
 * @param {Object} ctx 共通ラッパが渡す実行の文脈（cronWrapper.js の ctx。state.cursor は前回までの進捗）
 * @param {Object} [deps] テスト用の差し替え
 */
export async function runRacerProfilesJob(
  ctx,
  {
    sync = runRacerProfileSync,
    chunkSize = RACER_PROFILES_CHUNK,
    concurrency = RACER_PROFILES_CONCURRENCY,
    log = console.log,
    logError = console.error,
  } = {},
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");
  const size = resolveChunkSize(ctx.query, chunkSize);

  // 前回までの進捗。対象日・モードが一致するときだけ引き継ぐ
  const previous = ctx.state?.cursor ?? null;
  const resume =
    previous && previous.targetDate === date && previous.mode === ctx.mode
      ? previous
      : null;
  if (resume?.done) {
    // shadow の完了後の起動（live は、共通ラッパが last_target_date で、ここへ来ない）
    return {
      rowsWritten: 0,
      cursor: previous,
      report: ctx.state?.last_report ?? undefined,
      body: { skipped: "cycle_done", date },
    };
  }
  const afterRacerId = resume?.afterRacerId ?? null;
  const stats = resume?.stats ?? zeroStats();

  const options = {
    ...parseArgs([]),
    dryRun: ctx.mode === "shadow",
    limit: size,
    afterRacerId,
    concurrency,
  };
  const { summary } = await sync({
    client: ctx.client,
    options,
    deps: {
      fetchImpl: ctx.politeFetch,
      fetchRetries: 0, // 再試行は politeFetch が行う
      shouldStop: ctx.shouldStop,
      now: () => ctx.now().getTime(),
      log,
      logError,
    },
  });

  // 系統的な失敗は、cursor を進めずに、実行の失敗にする（次の起動が、同じチャンクをやり直す）
  const systemic = [];
  if (summary.aborted) {
    systemic.push(
      `期別成績の失敗が${ABORT_AFTER_CONSECUTIVE_FAILURES}件連続したため中断（取得先の停止・書き込みの系統的な失敗の疑い）`,
    );
  }
  if (summary.profile.saveErrorCount > 0) {
    systemic.push(
      `新規選手のプロフィール保存でDBエラー${summary.profile.saveErrorCount}件`,
    );
  }
  const parsed =
    summary.season.successCount +
    summary.season.unchangedCount +
    summary.season.noDataCount;
  const attempts = parsed + summary.season.failCount;
  if (systemic.length > 0) {
    return {
      outcome: "error",
      error: `選手プロフィール・期別成績の取得に失敗（再開位置: ${afterRacerId ?? "先頭"}）: ${systemic.join(" / ")}`,
      rowsWritten: 0,
      report: { date, mode: ctx.mode, afterRacerId, summary: brief(summary) },
    };
  }

  // 最初のチャンクで対象が0人＝racer_profiles・race_entries が空（0件を成功にしない）
  if (!resume && summary.targetCount === 0) {
    return {
      outcome: "error",
      error: "対象選手が0件でした（racer_profiles・直近の race_entries が空の疑い）",
      report: { date, mode: ctx.mode, summary: brief(summary) },
    };
  }

  const nextStats = addStats(stats, summary);
  const done = summary.remaining === 0;
  const nextAfter = summary.lastProcessedRacerId ?? afterRacerId;
  const cursor = {
    targetDate: date,
    mode: ctx.mode,
    afterRacerId: nextAfter,
    done,
    stats: nextStats,
  };

  const alerts = [];
  if (done && nextStats.seasonTargets > 0) {
    const failRate = nextStats.seasonFailed / nextStats.seasonTargets;
    if (failRate > MAX_SEASON_FAIL_RATE) {
      alerts.push({
        key: "season_fail_rate",
        // 月次の1回きりの事象のため、last_report が残る間ずっと再通知しない（monitor は until を過ぎた通知を出さない）
        until: new Date(
          ctx.now().getTime() + ALERT_NOTIFY_DAYS * 24 * 3600 * 1000,
        ).toISOString(),
        text: `選手期別成績の失敗率が${(failRate * 100).toFixed(1)}%（${nextStats.seasonFailed}/${nextStats.seasonTargets}人、上限${MAX_SEASON_FAIL_RATE * 100}%）。対象日 ${date}`,
      });
    }
  }

  const report = {
    date,
    mode: ctx.mode,
    done,
    chunk: brief(summary),
    cycle: nextStats,
    afterRacerId: nextAfter,
    alerts,
  };

  return {
    rowsWritten:
      ctx.mode === "live"
        ? summary.season.successCount + summary.profile.successCount
        : 0,
    // 0件エラー: 期別成績を取得した選手が十分（MIN_SAMPLE_FOR_ZERO_GUARD人以上）いるのに、1件も解析できなかった
    // （共通ラッパの判定。最後の数人だけのチャンクが、一時的な失敗で止まらないよう、母数が小さいときは判定しない）
    rowsExpected: attempts >= MIN_SAMPLE_FOR_ZERO_GUARD ? attempts : 0,
    rowsParsed: parsed,
    // 全員を処理し終えるまでは、対象日を処理済みにしない（10分後の起動が続きを処理する）
    incomplete: !done,
    cursor,
    report,
    body: {
      date,
      done,
      remaining: summary.remaining,
      processed: summary.processedPrefix,
      afterRacerId: nextAfter,
      chunkSize: size,
    },
  };
}

/** last_report に残す、チャンクの要約（失敗した登録番号は先頭の数件だけ） */
function brief(summary) {
  return {
    targetCount: summary.targetCount,
    processed: summary.processedPrefix,
    remaining: summary.remaining,
    deadlineStopped: summary.deadlineStopped,
    aborted: summary.aborted,
    durationSeconds: summary.durationSeconds,
    profile: {
      success: summary.profile.successCount,
      failed: summary.profile.failCount,
      saveErrors: summary.profile.saveErrorCount,
      failedRacerIds: summary.profile.failedRacerIds.slice(
        0,
        MAX_FAILED_IDS_IN_REPORT,
      ),
    },
    season: {
      written: summary.season.successCount,
      unchanged: summary.season.unchangedCount,
      noData: summary.season.noDataCount,
      failed: summary.season.failCount,
      failedRacerIds: summary.season.failedRacerIds.slice(
        0,
        MAX_FAILED_IDS_IN_REPORT,
      ),
    },
  };
}
