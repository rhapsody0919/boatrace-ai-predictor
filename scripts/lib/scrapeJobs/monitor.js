/**
 * データ取得の監視（完了の定義C、plan.md §7）。予定表（scrape_slots）とジョブ状態（scrape_job_state）から、
 * 次を計測し、閾値超過をSlackに通知する。
 *
 *   expired     期限+許容幅を超えて未完了になったスロット（1件でも即時通知。ジョブ・レース・窓・最終エラー付き）
 *   未実行      attempts=0 のまま expired（Cronの未配信・tickの死活・claimの不具合の兆候）
 *   窓内取得率  ジョブ×窓ごとの、done かつ done_at が窓に入っている割合（98%未満。分母は確定中止を除く、liveのみ）。
 *               許容幅3分以下のジョブ（オッズ・レース情報）は「期限〜期限+3分」、それ以外（展示・結果・公式予想）は
 *               「期限〜期限+許容幅」で数える（展示は、旧定義（30・15・10分前の各±3分）との比較のため、
 *               旧定義の集計は別途、WS2の取得時刻列で行う。plan.md §3.1）
 *   遅延        done_at − 期限 の p50・p95（日次サマリー）
 *   発売開始の遅れ  オッズの発売開始が発走60分前の窓（±3分）より遅いレースは、取得の失敗ではないため、窓内取得率の分母から
 *               除外し（件数は日次サマリー・警告に別枠で出す）、別指標「発売開始の検知の遅れ」（最初の成功取得と、直前の
 *               未公開の試行の時刻の差。5分以内の割合98%以上）で評価する。定義は expectedUnpublished.js（BOA-386・
 *               完了の定義Bの見直し）。-60の窓は、未公開の間、-30の窓が始まるまで1分間隔で再試行する（registry.js の odds）
 *   死活        ジョブごとの last_tick_at の鮮度（運用窓の中で10分以上更新なし）
 *   連続失敗・ブレーカー  consecutive_failures >= 3、breaker_open_until が未来
 *   日次の期限超過  日次ジョブが、指定時刻から3時間経っても、その日の対象日を処理していない
 *
 * 窓の外の補完のスロット（レジストリの catchupOffsets。展示の発走の10分後。BOA-382）は、取得済みのレースが
 * skipped_have_data で即完了するため、ほぼ全てヒットになり、窓内取得率（ジョブ別）を実際より高く見せてしまう。
 * ジョブ別の集計（aggregateByJob）には入れず、窓別の集計（computeWindowStats）にだけ残す。期限切れの通知は、
 * 補完の失敗（展示が最後まで取れなかった）を伝えるが、中止・順延の疑い（cancellation_status が入っている）のレースは通知しない
 *
 * 体重だけの窓（レジストリの weightOnlyOffsets。展示の発走60分前。BOA-500）は、当日体重・調整重量の前倒しの取得
 * （best effort）で、取れなくても -33 の窓が同じ行を埋める。展示の窓内取得率（ジョブ別）の分母に入れず（窓別の集計には残す）、
 * 期限切れを通知しない（体重の公開が窓より遅いだけのレースを、取得の失敗として通知しない）。未実行（attempts=0）は通知する
 * （claim・Cronの不具合の兆候で、公開の遅れでは起きない）
 *
 * 「予定表・ジョブ状態のテーブルが無い」（075未適用）、および全ジョブが off の間は、何も通知しない（誤報なし）。
 *
 * 純粋関数（evaluate*・compute*・format*・dedupe）と、IO（collectMonitorInput・postSlack・runMonitor）に分ける。
 */
import { SCRAPE_JOBS } from "./registry.js";
import { toJstDateString } from "./time.js";
import {
  EXPECTED_UNPUBLISHED,
  classifyExpectedUnpublished,
  summarizeDetectionLags,
} from "./expectedUnpublished.js";
import {
  isActiveMode,
  isHostRow,
  computeWindowStats,
} from "./monitorWindowStats.js";
import {
  evaluateExpired,
  evaluateRacesPresent,
  evaluateWindowRates,
  evaluateDetectionLag,
  evaluateJobStates,
  applyDedupe,
} from "./monitorAlerts.js";
import { formatAlertMessage, formatDailySummary } from "./monitorFormat.js";
import { collectMonitorInput } from "./monitorInput.js";

// 発売開始の遅れの判定（想定内の未公開）は、レポートと共有する（expectedUnpublished.js）。テストは monitor から読む
export { classifyExpectedUnpublished };

/** Slack Incoming Webhook へ投稿する。失敗は例外にする（通知できなかったことを、実行の失敗として残す） */
export async function postSlack(webhookUrl, payload, fetchImpl = fetch) {
  const res = await fetchImpl(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    throw new Error(`Slackへの通知に失敗しました: HTTP ${res.status}`);
  }
}

/**
 * scrape-monitor の本体（共通ラッパの run(ctx)）。
 * ctx.client: Supabase、ctx.query.mode: "daily" なら日次サマリー、ctx.state: 前回のジョブ状態（通知済みの記録）
 */
export async function runMonitor(
  ctx,
  { env = process.env, fetchImpl = fetch, collect = collectMonitorInput } = {},
) {
  const now = ctx.now();
  const isDaily = ctx.query?.mode === "daily";
  const level = isDaily ? "daily" : "tick";
  const input = await collect(ctx.client, now, level);
  if (!input.available) {
    return { rowsWritten: 0, body: { skipped: "scrape_schema_not_applied" } };
  }

  const { activeJobs, activeJobNames, liveJobs } = selectJobs(input.jobStates);
  const oddsSiblings = input.oddsSlots ?? [];
  const expectedUnpublished = classifyInputUnpublished(
    input,
    oddsSiblings,
    now,
  );
  const alerts = collectMonitorAlerts(input, {
    now,
    activeJobNames,
    liveJobs,
    expectedUnpublished,
    oddsSiblings,
  });

  const previous = ctx.state?.last_report?.notified ?? {};
  const { toSend, notified } = applyDedupe(alerts, previous, now);

  const webhook = env.SLACK_WEBHOOK_URL;
  const messages = [];
  const notifiedFinal = addAlertMessage(messages, toSend, {
    notified,
    previous,
    now,
  });
  // 日次サマリー: 取得ジョブが1つも有効でない間（移行前）は、投稿しない
  if (isDaily && activeJobs.length > 0) {
    messages.push(
      buildDailySummaryMessage(input, {
        now,
        activeJobNames,
        liveJobs,
        expectedUnpublished,
        oddsSiblings,
      }),
    );
  }

  const sent = await sendSlackMessages(
    webhook,
    messages,
    toSend.length,
    fetchImpl,
  );

  return {
    rowsWritten: 0,
    // 通知に成功した場合のみ、通知済みの記録を進める（失敗した通知は、次の実行で再送される）
    report: {
      notified: notifiedFinal,
      lastLevel: level,
      lastRunAt: now.toISOString(),
    },
    body: {
      level,
      activeJobs: activeJobs.length,
      alerts: alerts.length,
      sent,
      slackConfigured: Boolean(webhook),
    },
  };
}

/** 有効なジョブ（監視自身・ホスト行を除く shadow・live）とその名前、live のジョブの名前 */
function selectJobs(jobStates) {
  const activeJobs = jobStates.filter(
    (r) =>
      !isHostRow(r) &&
      SCRAPE_JOBS[r.job]?.kind !== "monitor" &&
      isActiveMode(r.mode),
  );
  const activeJobNames = new Set(activeJobs.map((r) => r.job));
  const liveJobs = new Set(
    jobStates.filter((r) => r.mode === "live").map((r) => r.job),
  );
  return { activeJobs, activeJobNames, liveJobs };
}

/** 発売開始の遅れ（想定内の未公開）。警告・窓内取得率・日次サマリーで同じ判定を共有する */
function classifyInputUnpublished(input, oddsSiblings, now) {
  const targetPool = [
    ...input.expiredSlots,
    ...(input.openSlots ?? []),
    ...input.todaySlots,
    ...(input.weekSlots ?? []),
  ];
  return classifyExpectedUnpublished(targetPool, {
    siblingSlots: oddsSiblings,
    now,
  });
}

/**
 * 異常の本文を messages へ足し、通知済みの記録（載せきれなかったアラートは、通知済みとして記録しない。
 * 次の実行で通知する）を返す
 */
function addAlertMessage(messages, toSend, { notified, previous, now }) {
  if (toSend.length === 0) return notified;
  const { message, includedCount } = formatAlertMessage(toSend, now);
  messages.push(message);
  if (includedCount >= toSend.length) return notified;
  const notifiedFinal = { ...notified };
  for (const alert of toSend.slice(includedCount)) {
    if (previous[alert.key] === undefined) delete notifiedFinal[alert.key];
    else notifiedFinal[alert.key] = previous[alert.key];
  }
  return notifiedFinal;
}

/** 今回の入力から出す異常の一覧（期限切れ・窓内取得率・検知の遅れ・ジョブ状態・当日のレース） */
function collectMonitorAlerts(
  input,
  { now, activeJobNames, liveJobs, expectedUnpublished, oddsSiblings },
) {
  const todayStats = computeWindowStats(input.todaySlots, SCRAPE_JOBS, {
    liveJobs,
    expectedUnpublished,
  });
  const today = toJstDateString(now);
  const detectionLagToday = summarizeDetectionLags(
    input.todaySlots,
    expectedUnpublished,
    oddsSiblings,
  );
  return [
    ...evaluateExpired([...input.expiredSlots, ...(input.openSlots ?? [])], {
      activeJobs: activeJobNames,
      now,
      expectedUnpublished,
    }),
    ...evaluateWindowRates(todayStats, today),
    ...evaluateDetectionLag(detectionLagToday, today),
    ...evaluateJobStates(input.jobStates, now),
    ...(input.todayRaceCount === undefined
      ? []
      : evaluateRacesPresent({
          jobStates: input.jobStates,
          todayRaceCount: input.todayRaceCount,
          now,
        })),
  ];
}

/** 日次サマリーの本文（前の1時間が属する日の分と直近7日） */
function buildDailySummaryMessage(
  input,
  { now, activeJobNames, liveJobs, expectedUnpublished, oddsSiblings },
) {
  const summaryDate = toJstDateString(new Date(now.getTime() - 3600 * 1000));
  const weekSlots = input.weekSlots ?? [];
  const oddsActive = activeJobNames.has(EXPECTED_UNPUBLISHED.job);
  return formatDailySummary({
    date: summaryDate,
    detectionLagDay: oddsActive
      ? summarizeDetectionLags(
          weekSlots.filter((s) => s.race_date === summaryDate),
          expectedUnpublished,
          oddsSiblings,
        )
      : undefined,
    detectionLag7d: oddsActive
      ? summarizeDetectionLags(weekSlots, expectedUnpublished, oddsSiblings)
      : undefined,
    stats7d: computeWindowStats(input.weekSlots ?? [], SCRAPE_JOBS, {
      liveJobs,
      expectedUnpublished,
    }),
    statsDay: computeWindowStats(
      (input.weekSlots ?? []).filter((s) => s.race_date === summaryDate),
      SCRAPE_JOBS,
      { liveJobs, expectedUnpublished },
    ),
    jobStates: input.jobStates,
    now,
  });
}

/** 本文を順に Slack へ送り、送れた件数を返す。通知先が無いのに送る物があるなら投げる */
async function sendSlackMessages(webhook, messages, alertCount, fetchImpl) {
  let sent = 0;
  if (messages.length > 0) {
    if (!webhook) {
      // 通知先が無いことを、成功に見せない（異常があるのに通知できない）。通知済みの記録は更新しない
      throw new Error(
        `SLACK_WEBHOOK_URL が設定されていないため、${alertCount}件の異常を通知できません（Vercelの環境変数に設定してください）`,
      );
    }
    for (const message of messages) {
      await postSlack(webhook, message, fetchImpl);
      sent++;
    }
  }
  return sent;
}

export {
  THRESHOLDS,
  OPERATING_START_MIN,
  OPERATING_END_MIN,
  livenessCheckable,
  percentile,
  deadlineOf,
  computeWindowStats,
  aggregateByJob,
} from "./monitorWindowStats.js";

export {
  evaluateExpired,
  evaluateRacesPresent,
  evaluateWindowRates,
  evaluateDetectionLag,
  HOOK_JOBS,
  evaluateJobStates,
  applyDedupe,
} from "./monitorAlerts.js";

export { formatAlertMessage, formatDailySummary } from "./monitorFormat.js";

export { collectMonitorInput } from "./monitorInput.js";
