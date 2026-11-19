/**
 * SNS の 48h・7d の取り込み（sns-pdca-loop tasks 21、cron `sns_metrics`、plan §5）。
 * 5分ごとに、due_at を過ぎた pending の sns_metric_jobs（154 のトリガーが posted のときに2件作る）を処理する。
 *
 * - YouTube: videos.list(statistics) の累積値（views・likes・comments）。50件ずつまとめて1回で読む（クォータ1）
 * - X: GET /2/users/{id}/tweets（自分の投稿の読み取りは Owned Reads、1件 $0.001）を since_id・until_id で対象の1件に絞る。
 *   public_metrics・non_public_metrics を読む。読む前に reserve_sns_x_read で送信と同じ月の台帳に予約する
 * - 累積値は窓の終わりから15分以内に取れたものだけ値として保存する（SQL154）。observed_at は実際に応答を受けた時刻、
 *   data_through も同じ値。15分を過ぎてから処理する job は、外部を読まずに「取得が遅れた」の欠測で閉じる（費用をかけない）
 * - 失敗は attempts を増やして pending のまま次の実行でやり直す。3回目の失敗でその場で Slack に知らせる（spec C4）。
 *   15分を過ぎたら、最後の失敗の理由を欠測理由に入れて閉じる
 * - 投稿の行が足りない（draft が posted でない・外部 ID が無い）job は、やり直しても直らないので failed で閉じて知らせる
 * - shadow では外部を読まず、DB も変えない（対象の件数だけを返す）
 * - 継続監視: 毎回、直近5日に閉じた job のうち欠測・失敗の割合が2%を超えたら report.alerts に入れる（監視が再通知の間隔ごとに Slack へ）
 */
import {
  observationPeriod,
  withinSnapshotTolerance,
} from "../../src/utils/snsObservations.js";
import { X_API_BASE } from "../../api/_lib/xApiAdapter.js";
import { createXMetricsReader as createXReaderWith } from "./snsMetricsRunnerReaders.js";
import {
  SOURCE_BY_CHANNEL,
  YOUTUBE_BATCH,
  brokenReason,
  chunks,
  missingRows,
  shortError,
  valueRows,
} from "./snsMetricsRunnerParts.js";

export {
  YOUTUBE_API_BASE,
  createYoutubeMetricsReader,
  dailySendMicrousd,
} from "./snsMetricsRunnerReaders.js";
export {
  createSnsMetricsStore,
  joinDueJobs,
} from "./snsMetricsRunnerStore.js";

/** X の読み取り（API の基点は api/ の物なので、ここで渡す） */
export const createXMetricsReader = (options) =>
  createXReaderWith({ ...options, xApiBase: X_API_BASE });

export const SNS_METRICS_MAX_JOBS = 50;
export const SNS_METRICS_ALERT_ATTEMPTS = 3;
export const SNS_METRICS_MONITOR_DAYS = 5;
export const SNS_METRICS_MISSING_RATE_LIMIT = 0.02;
// X の読み取り1回の予約額（since_id・until_id で1件に絞る。Owned Reads $0.001/件）
export const X_READ_MICROUSD = 1000;

/** job を閉じる（close）・やり直しに回す（fail）関数を作る。書いた行数は tally.written に足す */
function createJobClosers({ store, tell, results, tally }) {
  const close = async (job, state, rows, lastError = null) => {
    for (const row of rows) await store.append(job.draft.id, row);
    tally.written += rows.length;
    await store.finish(job.id, state, lastError);
    results.push({
      id: job.id,
      window: job.window,
      outcome: state,
      ...(lastError ? { reason: lastError } : {}),
    });
  };
  // quiet: 続いている状態（トークンを取れない）は report.alerts で知らせるので、job ごとの Slack は出さない
  const fail = async (job, error, { quiet = false } = {}) => {
    const attempts = job.attempts + 1;
    const reason = shortError(error);
    await store.retry(job.id, attempts, reason);
    results.push({ id: job.id, window: job.window, outcome: "retry", reason });
    if (!quiet && attempts === SNS_METRICS_ALERT_ATTEMPTS)
      await tell(
        `SNS の取り込みが${attempts}回続けて失敗: ${job.channel} ${job.window} job ${job.id}: ${reason}`,
      );
  };
  return { close, fail };
}

/** 1 job の振り分け: 不備は閉じる・15分以内は読む対象（live）に入れる・過ぎたら欠測で閉じる */
async function classifyJob(job, { now, store, close, tell, live }) {
  const broken = brokenReason(job);
  if (broken) {
    await close(job, "failed", [], broken);
    await tell(`SNS の取り込みを閉じた（直らない不備）: job ${job.id} ${broken}`);
    return;
  }
  const period = observationPeriod(job.draft.posted_at, job.window);
  // due_at と posted_at がずれた行は次の実行で
  if (Date.parse(period.period_end) > now.getTime()) return;
  if (withinSnapshotTolerance(now.toISOString(), period.period_end)) {
    live[job.channel].push({ job, period });
    return;
  }
  // 値は保存できたが閉じる（finish）のに失敗した job は、欠測で上書きせずに閉じる（比較は最新の revision を使うため）
  if (
    await store.hasValues(job.draft.id, job.window, SOURCE_BY_CHANNEL[job.channel])
  ) {
    await close(job, "done", []);
    return;
  }
  const reason = `取得が遅れた（窓の終わりから15分を過ぎた）${job.last_error ? `。最後の失敗: ${job.last_error}` : ""}`;
  await close(job, "missing", missingRows(job, period, now, reason));
}

/** 読み取りの1回分（YouTube は50件・X は1件）を読み、job ごとに閉じる */
async function readChunk(channel, chunk, reader, { store, close, fail }) {
  let read;
  try {
    if (channel === "x" && !(await store.reserveXRead(X_READ_MICROUSD)))
      throw new Error("x_read_budget: 月の残りが送信の分を割るので読まない");
    read = await reader.read(chunk.map(({ job }) => job.external_post_id));
  } catch (error) {
    for (const { job } of chunk) await fail(job, error);
    return;
  }
  for (const { job, period } of chunk) {
    const found = read.get(job.external_post_id);
    if (!found) {
      await fail(
        job,
        new Error("対象の投稿が応答に無い（削除・非公開の可能性）"),
      );
      continue;
    }
    try {
      await close(job, "done", valueRows(job, period, found));
    } catch (error) {
      await fail(job, error);
    }
  }
}

/** チャネルごとに読む。トークンを取れなければ、そのチャネルの job を全部やり直しに回す */
async function readChannel(channel, targets, env) {
  const { ctx, readers, fail, alerts } = env;
  let reader;
  try {
    reader = await readers[channel]();
  } catch (error) {
    for (const { job } of targets) await fail(job, error, { quiet: true });
    alerts.push({
      key: `token:${channel}`,
      text: `${channel} のトークンを取れないので取り込みを止めている: ${shortError(error)}`,
    });
    return;
  }
  for (const chunk of chunks(
    targets,
    channel === "youtube" ? YOUTUBE_BATCH : 1,
  )) {
    if (ctx.shouldStop()) break;
    await readChunk(channel, chunk, reader, env);
  }
}

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, readers: {x: () => Promise<{read: Function}>, youtube: () => Promise<{read: Function}>}, notify?, maxJobs?}} deps
 * readers.{channel}() は1回の実行でチャネルごとに1回だけ呼ぶ（トークンの取得）。read(targets) は
 * Map<external_post_id, {observedAt, values: {metric_name: number|null}}> を返す。応答に無い ID は Map に入れない
 */
export async function runSnsMetrics(
  ctx,
  { store, readers, notify = async () => {}, maxJobs = SNS_METRICS_MAX_JOBS },
) {
  const now = ctx.now();
  const jobs = await store.dueJobs(now, maxJobs);
  if (ctx.mode !== "live")
    return {
      rowsWritten: 0,
      report: { due: jobs.length, alerts: [] },
      body: { mode: ctx.mode, due: jobs.length },
    };

  const tell = async (text) => {
    try {
      await notify(text);
    } catch (error) {
      console.error(`Slack に通知できません（${text}）: ${error.message}`);
    }
  };
  const results = [];
  const alerts = [];
  const tally = { written: 0 };
  const { close, fail } = createJobClosers({ store, tell, results, tally });
  const env = { ctx, now, store, readers, tell, close, fail, alerts };

  // 1. 投稿の行を確かめ、15分を過ぎた job は外部を読まずに欠測で閉じる
  const live = { x: [], youtube: [] };
  for (const job of jobs) {
    if (ctx.shouldStop()) break;
    try {
      await classifyJob(job, { ...env, live });
    } catch (error) {
      await fail(job, error);
    }
  }

  // 2. チャネルごとに読む。トークンを取れなければ、そのチャネルの job を全部やり直しに回す
  for (const channel of ["youtube", "x"]) {
    const targets = live[channel];
    if (!targets.length || ctx.shouldStop()) continue;
    await readChannel(channel, targets, env);
  }

  const rate = await store.recentOutcomes(now, SNS_METRICS_MONITOR_DAYS);
  const bad = rate.missing + rate.failed;
  const closed = bad + rate.done;
  if (closed > 0 && bad / closed > SNS_METRICS_MISSING_RATE_LIMIT)
    alerts.push({
      key: "missing_rate",
      text: `SNS の取り込みの欠測が多い: 直近${SNS_METRICS_MONITOR_DAYS}日で ${bad}/${closed} 件（欠測 ${rate.missing}・失敗 ${rate.failed}、上限 ${SNS_METRICS_MISSING_RATE_LIMIT * 100}%）`,
    });

  return {
    rowsWritten: tally.written,
    report: { jobs: results, recent: rate, alerts },
    body: { jobs: results },
  };
}
