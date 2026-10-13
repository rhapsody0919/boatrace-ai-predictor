/**
 * SNS の送信の runner（sns-pdca-loop tasks 19、cron `sns_send`）。2分ごとに、送る時刻を過ぎた job を最大 maxJobs 件送る。
 *
 * 1回の流れ（plan §4）:
 *   sweep（期限切れの保留・リース切れの要照合）→ 送る時刻を過ぎた queued の job（スレッドの子は親が posted のものだけ）
 *   → job ごとに: 送る前の検査（claim の前）→ トークン（claim の前）→ claim 以降は既存の runXSendJob / runYoutubeQueueJob
 *
 * - 送る前の検査を claim の前にも1回通す。落ちたら claim しない（X の月の予約・日次の枠・YouTube のクォータを消費しない）。
 *   claim の後にも runXSendJob・runYoutubeQueueJob の中で同じ検査をもう一度行う（既存の契約）
 * - モードが live でない（shadow）か、そのチャネルの dry_run が true なら、送る前の検査までで止める（試運転、ADR 0094）
 * - トークンは claim の前に取る。取れなければ claim しない（xApiAdapter.js の説明）
 * - YouTube は同じ実行の中でアップロード→処理の確認→公開まで進める（2026-10-13 ユーザー決定）。処理の確認は1回の試行で3回まで。
 *   3回で終わらなければ非公開のまま残す（youtube_retain）
 * - 保留の理由・要照合は report.alerts に入れ、監視（scrape-monitor）が Slack に流す（同じ key は再通知の間隔ごと）
 */
import { runXSendJob } from "../../api/_lib/snsXSend.js";
import {
  runYoutubePublishJob,
  runYoutubeQueueJob,
} from "../../api/_lib/snsDeadlineQueue.js";

export const SNS_SEND_MAX_JOBS = 3;
export const YOUTUBE_MAX_POLLS = 3;
export const YOUTUBE_POLL_WAIT_SEC = 30;

const slug = (message) =>
  /^[a-z_]{1,64}$/.test(message ?? "") ? message : "unexpected_error";

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, adapters: {x: () => Promise<object>, youtube: () => Promise<object>}, preflight, loadMedia, wait?, maxJobs?, pollWaitSec?}} deps
 */
export async function runSnsSend(
  ctx,
  {
    store,
    adapters,
    preflight,
    loadMedia,
    wait = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000)),
    maxJobs = SNS_SEND_MAX_JOBS,
    pollWaitSec = YOUTUBE_POLL_WAIT_SEC,
  },
) {
  const live = ctx.mode === "live";
  // shadow では DB の状態を変えない（sweep も行わない）
  if (live) await store.sweep();
  const controls = await store.controls();
  const jobs = await store.dueJobs(ctx.now(), maxJobs);
  const results = [];
  const alerts = [];
  let posted = 0;

  for (const job of jobs) {
    if (ctx.shouldStop()) break;
    const result = { id: job.id, channel: job.channel };
    results.push(result);
    try {
      await preflight(job);
    } catch (error) {
      result.outcome = "precheck_failed";
      result.reason = slug(error.message);
      alerts.push({
        key: `precheck:${job.id}:${result.reason}`,
        text: `送る前の検査で止めた（claim していない）: ${job.channel} job ${job.id} 理由 ${result.reason}`,
      });
      continue;
    }
    // dry_run の行が無い（153 未適用など）ときも送らない（fail-closed）
    if (!live || controls[job.channel]?.dry_run !== false) {
      result.outcome = live ? "dry_run" : "shadow";
      continue;
    }
    let adapter;
    try {
      adapter = await adapters[job.channel]();
    } catch (error) {
      result.outcome = "token_failed";
      alerts.push({
        key: `token:${job.channel}`,
        text: `${job.channel} のトークンを取れないので送信していない（claim していない）: ${error.message}`,
      });
      continue;
    }
    try {
      const done =
        job.channel === "x"
          ? await runXSendJob(job.id, {
              store,
              x: adapter,
              loadMedia,
              wait,
              preflight,
            })
          : await sendYoutube(job, {
              store,
              youtube: adapter,
              preflight,
              loadMedia,
              wait,
              shouldStop: ctx.shouldStop,
              pollWaitSec,
            });
      result.outcome = done.state;
      result.error_code = done.error_code ?? null;
      if (done.state === "posted") posted += 1;
      if (done.state === "reconcile")
        alerts.push({
          key: `reconcile:${job.id}`,
          text: `要照合: ${job.channel} job ${job.id}（${done.youtube_stage ?? done.error_code ?? "結果が不明"}）。管理画面で照合する`,
        });
    } catch (error) {
      // job の状態（held・要照合）は送信の関数が DB に残している。ここでは理由を知らせるだけ
      result.outcome = "error";
      result.reason = slug(error.message);
      alerts.push({
        key: `send:${job.id}`,
        text: `送信が止まった: ${job.channel} job ${job.id}: ${error.message}`,
      });
    }
  }
  return {
    rowsWritten: posted,
    report: { jobs: results, alerts },
    body: { jobs: results },
  };
}

/** YouTube: アップロード→処理の確認（最大3回）→公開。3回で処理が終わらなければ非公開のまま残す */
async function sendYoutube(
  job,
  { store, youtube, preflight, loadMedia, wait, shouldStop, pollWaitSec },
) {
  let current = await runYoutubeQueueJob(job.id, {
    store,
    youtube,
    preflight,
    loadMedia,
  });
  for (
    let poll = 1;
    current.state === "reconcile" &&
    ["uploaded", "ready"].includes(current.youtube_stage) &&
    poll < YOUTUBE_MAX_POLLS;
    poll++
  ) {
    if (shouldStop()) break;
    await wait(pollWaitSec);
    current = await runYoutubePublishJob(current, {
      store,
      youtube,
      preflight,
    });
  }
  if (
    current.state === "reconcile" &&
    ["uploaded", "ready"].includes(current.youtube_stage)
  )
    current = await store.transition(current.id, "youtube_retain");
  return current;
}

/** PostgREST の読み取り（service_role）。失敗は握りつぶさず投げる */
export function createPostgrestReader({ url, key, fetchImpl = fetch }) {
  return async (path) => {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!response.ok)
      throw new Error(
        `送信の DB の読み取りに失敗: HTTP ${response.status} ${path.split("?")[0]}`,
      );
    return response.json();
  };
}

/** 送信の job の読み書き。xSendStore（api/_lib/snsXSendStore.js）の送信の操作に、runner の読み取りを足す */
export function createSnsSendStore({ db, xSendStore }) {
  return {
    transition: (id, action, result) =>
      xSendStore.transition(id, action, result),
    parent: (id) => xSendStore.parent(id),
    sweep: () => xSendStore.sweep(),
    async controls() {
      const rows = await db(
        "sns_auto_send_control?select=channel,mode,dry_run",
      );
      return Object.fromEntries(rows.map((row) => [row.channel, row]));
    },
    async dueJobs(now, limit) {
      const queued = await db(
        `sns_x_send_jobs?state=eq.queued&scheduled_at=lte.${encodeURIComponent(now.toISOString())}&order=scheduled_at.asc,id.asc&limit=50&select=*`,
      );
      const parentIds = [
        ...new Set(queued.map((job) => job.parent_job_id).filter(Boolean)),
      ];
      const parents = parentIds.length
        ? await db(
            `sns_x_send_jobs?id=in.(${parentIds.join(",")})&select=id,state,external_post_id`,
          )
        : [];
      return pickDueJobs(queued, parents, limit);
    },
  };
}

/** スレッドの子は、親が posted で外部 ID があるものだけ（同時に claim して parent_not_posted で保留に落ちないため。plan §2） */
export function pickDueJobs(queued, parents, limit) {
  const postedParents = new Set(
    parents
      .filter((p) => p.state === "posted" && p.external_post_id)
      .map((p) => p.id),
  );
  return queued
    .filter((job) => !job.parent_job_id || postedParents.has(job.parent_job_id))
    .slice(0, limit);
}
