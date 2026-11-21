/**
 * 朝の初期化（job.js の runRacesInitJob）の1回の起動の報告（last_report）・応答の本文・失敗の文を作る。
 * DB・ネットワークに触れない（時刻は ctx.now で読む）。
 */

/** 会場の失敗の通知を出す連続失敗回数と、通知を出す期間（時間） */
const ALERT_AFTER_ATTEMPTS = 3;
export const ALERT_NOTIFY_HOURS = 3;
/** last_report に残す、失敗の内容の最大数 */
const MAX_FAILURES_IN_REPORT = 10;

/** 会場の連続失敗・後始末の失敗・イン崩れ注意度の打ち切りの通知 */
function runAlerts({ ctx, cursor, date, pending, finalizeError }) {
  const alerts = pending
    .filter(
      (v) =>
        (cursor.attempts[v] ?? 0) >= ALERT_AFTER_ATTEMPTS &&
        cursor.lastErrors[v],
    )
    .map((v) => ({
      key: `venue_failed:${v}`,
      until: new Date(
        ctx.now().getTime() + ALERT_NOTIFY_HOURS * 3600 * 1000,
      ).toISOString(),
      text: `朝の初期化で会場${v}が${cursor.attempts[v]}回連続で失敗しています（対象日 ${date}）: ${cursor.lastErrors[v]}`,
    }));
  if (finalizeError) {
    alerts.push({
      key: "finalize_failed",
      until: new Date(
        ctx.now().getTime() + ALERT_NOTIFY_HOURS * 3600 * 1000,
      ).toISOString(),
      text: `朝の初期化の後始末に失敗しています（対象日 ${date}）: ${finalizeError}`,
    });
  } else if (
    cursor.finalize?.inCautionAlert &&
    new Date(cursor.finalize.inCautionAlert.until) > ctx.now()
  ) {
    // イン崩れ注意度の打ち切りの通知は、次の起動の成功の報告でも残す（成功の報告が alerts を空にして、
    // scrape-monitor の運用窓 JST 07:00 より前に消えるため。2026-10-13 レビュー F1）。key は同じなので二重には出ない
    alerts.push(cursor.finalize.inCautionAlert);
  }
  return alerts;
}

/**
 * 起動の結果。failedError は、全ての試行が失敗・後始末の失敗のときの文（それ以外は null）
 * @returns {{report: Object, body: Object, failedError: string|null}}
 */
export function buildRunResult({
  ctx,
  cursor,
  date,
  run,
  wroteBefore,
  finalizeError,
}) {
  const { failures, attempted, breakerOpen } = run;
  const allFailed = attempted > 0 && failures.length === attempted;
  const pending = cursor.targets.filter((v) => !cursor.settled.includes(v));
  const alerts = runAlerts({ ctx, cursor, date, pending, finalizeError });
  const report = {
    date,
    mode: ctx.mode,
    done: cursor.done,
    existingVenues: cursor.existing.length,
    venues: cursor.venues.length,
    settled: cursor.settled.length,
    noProgram: cursor.noProgram ?? [],
    pending,
    races: cursor.races,
    entries: cursor.entries,
    wroteAny: cursor.wroteAny,
    finalize: cursor.finalize,
    breakerOpen,
    failures: failures.slice(0, MAX_FAILURES_IN_REPORT),
    alerts,
  };
  const body = {
    date,
    done: cursor.done,
    attempted,
    settledThisRun: cursor.settled.length - wroteBefore,
    settled: cursor.settled.length,
    remaining: pending.length,
    ...(breakerOpen ? { skipped: "breaker_open" } : {}),
    ...(failures.length > 0 ? { failures: failures.length } : {}),
  };
  let failedError = null;
  if (allFailed)
    failedError = `朝の初期化: 試行した${attempted}会場が全て失敗しました（${failures
      .slice(0, 3)
      .map((f) => `会場${f.venue}: ${f.error}`)
      .join(" / ")}）`;
  else if (finalizeError)
    failedError = `朝の初期化の後始末に失敗しました: ${finalizeError}`;
  return { report, body, failedError };
}
