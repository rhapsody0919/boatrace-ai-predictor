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
 *   - 要照合は、毎回 DB の状態（state='reconcile'）から作る。オーナーが照合して解けるまで出し続ける。
 *     実行のメモリに置いた通知は、途中で落ちると保存されず、sweep（DB の now()）と runner の時刻のずれでも漏れるため
 *     （開発の補助の点検 2026-10-13-28 の D2）
 *   - 送る前の検査・トークンの失敗は、候補を20件ずつ巡回するので、次にその job・チャネルを見直すまで（最長 CONTINUING_ALERT_MINUTES）残す
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

/** 1回の実行で読む候補（queued の行）の上限。送る前の検査に落ちた job は送信の件数（maxJobs）に数えない */
export const SNS_SEND_MAX_CANDIDATES = 20;
/** 届かなかった一度きりの通知を report.alerts に残す時間（監視が再通知の間隔ごとに流す） */
export const UNDELIVERED_ALERT_HOURS = 24;
const UNDELIVERED_PREFIX = "undelivered:";
/** 送る前の検査・トークンの失敗の通知を、見直すまで残す時間（候補の巡回が一周するより長く） */
export const CONTINUING_ALERT_MINUTES = 30;

/** 走査位置（scrape_job_state.cursor）: 送る時刻と id の組。次の実行はこの位置の後から読む（開発の補助の点検 D1） */
const positionOf = (job) => ({ scheduled_at: job.scheduled_at, id: job.id });

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, adapters: {x: () => Promise<object>, youtube: () => Promise<object>}, preflight, loadMedia, notify?, wait?, maxJobs?, pollWaitSec?}} deps
 * notify(text): 一度きりの事象（要照合・送信の失敗）を Slack に直接知らせる。続いている状態（検査で止まっている・トークンを取れない）は
 * report.alerts に入れ、監視（scrape-monitor、5分ごと）が同じ key を再通知の間隔ごとに知らせる。
 * report は2分ごとの実行で上書きされるので、一度きりの事象を report だけに入れると監視が読む前に消える
 */
export async function runSnsSend(
  ctx,
  {
    store,
    adapters,
    preflight,
    loadMedia,
    notify = async () => {},
    wait = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000)),
    maxJobs = SNS_SEND_MAX_JOBS,
    maxCandidates = SNS_SEND_MAX_CANDIDATES,
    pollWaitSec = YOUTUBE_POLL_WAIT_SEC,
  },
) {
  const live = ctx.mode === "live";
  const now = ctx.now();
  const results = [];
  const previous = (ctx.state?.last_report?.alerts ?? []).filter(
    (a) => a?.key && Date.parse(a.until) > now.getTime(),
  );
  // 前の実行で届かなかった一度きりの通知は、期限まで report.alerts に持ち越す（report は毎回上書きされるため）
  const alerts = previous.filter((a) => a.key.startsWith(UNDELIVERED_PREFIX));
  const continuingUntil = new Date(
    now.getTime() + CONTINUING_ALERT_MINUTES * 60000,
  ).toISOString();
  // 一度きりの事象はその場で Slack に知らせる。届かなければ（Webhook 未設定を含む）report.alerts に残し、監視に流してもらう
  const tell = async (key, text) => {
    try {
      await notify(text);
    } catch (error) {
      console.error(`Slack に通知できません（${text}）: ${error.message}`);
      if (!alerts.some((a) => a.key === `${UNDELIVERED_PREFIX}${key}`))
        alerts.push({
          key: `${UNDELIVERED_PREFIX}${key}`,
          text: `（即時の通知が届かなかった）${text}`,
          until: new Date(
            now.getTime() + UNDELIVERED_ALERT_HOURS * 3600000,
          ).toISOString(),
        });
    }
  };
  // shadow では DB の状態を変えない（sweep も行わない）
  if (live) await store.sweep();
  // 要照合は DB の状態から毎回作る（sweep で要照合になったもの・前の実行が保存の前に落ちたものも拾う）
  for (const job of await store.reconcileJobs())
    alerts.push({
      key: `reconcile:${job.id}`,
      text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${job.youtube_stage ?? job.error_code ?? "結果が不明"}）。管理画面で照合する`,
    });
  const controls = await store.controls();
  const { jobs: candidates, nextCursor } = await store.dueJobs(
    now,
    maxCandidates,
    ctx.state?.cursor ?? null,
  );
  // トークンは1回の実行でチャネルごとに1回だけ取る（失敗も覚えて、同じ実行の残りの job では取り直さない）
  const adapterCache = new Map();
  const tokenChecked = new Set();
  const adapterFor = (channel) => {
    if (!adapterCache.has(channel))
      adapterCache.set(
        channel,
        adapters[channel]().then(
          (adapter) => ({ adapter }),
          (error) => ({ error }),
        ),
      );
    return adapterCache.get(channel);
  };
  let attempted = 0;
  let posted = 0;
  // 途中で止めたら、最後に見た job の位置を次の実行の起点にする。最後まで見たら DB の読み取りの続き（読み切ったら先頭へ戻る）
  let cursor = nextCursor;

  for (const [index, job] of candidates.entries()) {
    if (attempted >= maxJobs || ctx.shouldStop()) {
      cursor =
        index > 0
          ? positionOf(candidates[index - 1])
          : (ctx.state?.cursor ?? null);
      break;
    }
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
        until: continuingUntil,
      });
      continue;
    }
    // dry_run の行が無い（153 未適用など）ときも送らない（fail-closed）
    if (!live || controls[job.channel]?.dry_run !== false) {
      result.outcome = live ? "dry_run" : "shadow";
      continue;
    }
    // トークンの取得と claim の前にも、関数の時間の残りを確かめる（途中で切れて要照合にしないため）
    if (ctx.shouldStop()) {
      result.outcome = "deferred";
      cursor =
        index > 0
          ? positionOf(candidates[index - 1])
          : (ctx.state?.cursor ?? null);
      break;
    }
    const { adapter, error: tokenError } = await adapterFor(job.channel);
    if (tokenError) {
      result.outcome = "token_failed";
      if (!tokenChecked.has(job.channel))
        alerts.push({
          key: `token:${job.channel}`,
          text: `${job.channel} のトークンを取れないので送信していない（claim していない）: ${tokenError.message}`,
          until: continuingUntil,
        });
      tokenChecked.add(job.channel);
      continue;
    }
    tokenChecked.add(job.channel);
    attempted += 1;
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
      // 要照合になったら、この実行の report にも出す（次の実行からは DB の状態から作る）
      if (done.state === "reconcile")
        alerts.push({
          key: `reconcile:${job.id}`,
          text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${done.youtube_stage ?? done.error_code ?? "結果が不明"}）。管理画面で照合する`,
        });
    } catch (error) {
      // job の状態（held・要照合）は送信の関数が DB に残している。ここでは理由を知らせるだけ
      result.outcome = "error";
      result.reason = slug(error.message);
      await tell(
        `send:${job.id}`,
        `SNS の送信が止まった: ${job.channel} job ${job.id}: ${error.message}`,
      );
    }
  }
  // この実行で見直さなかった job の検査の理由・確かめなかったチャネルのトークンの失敗は、期限まで残す
  const examined = new Set(results.map((r) => r.id));
  for (const a of previous) {
    const [kind, subject] = a.key.split(":");
    if (
      (kind === "precheck" && !examined.has(subject)) ||
      (kind === "token" && !tokenChecked.has(subject))
    )
      alerts.push(a);
  }
  return {
    rowsWritten: posted,
    report: { jobs: results, alerts },
    body: { jobs: results },
    cursor,
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
    // 送る時刻を過ぎた queued を、走査位置（cursor）の後から limit 件読む。読み切ったら nextCursor=null（次は先頭から）
    async dueJobs(now, limit, cursor) {
      const after = cursor
        ? `&or=${encodeURIComponent(`(scheduled_at.gt.${cursor.scheduled_at},and(scheduled_at.eq.${cursor.scheduled_at},id.gt.${cursor.id}))`)}`
        : "";
      const queued = await db(
        `sns_x_send_jobs?state=eq.queued&scheduled_at=lte.${encodeURIComponent(now.toISOString())}${after}&order=scheduled_at.asc,id.asc&limit=${limit}&select=*`,
      );
      const parentIds = [
        ...new Set(queued.map((job) => job.parent_job_id).filter(Boolean)),
      ];
      const parents = parentIds.length
        ? await db(
            `sns_x_send_jobs?id=in.(${parentIds.join(",")})&select=id,state,external_post_id`,
          )
        : [];
      return {
        jobs: pickDueJobs(queued, parents),
        nextCursor: queued.length === limit ? positionOf(queued.at(-1)) : null,
      };
    },
    // 要照合の job（オーナーが照合するまで残る。件数は少ない）
    async reconcileJobs() {
      return db(
        "sns_x_send_jobs?state=eq.reconcile&order=id.asc&select=id,channel,error_code,youtube_stage",
      );
    },
  };
}

/** スレッドの子は、親が posted で外部 ID があるものだけ（同時に claim して parent_not_posted で保留に落ちないため。plan §2） */
export function pickDueJobs(queued, parents, limit = Infinity) {
  const postedParents = new Set(
    parents
      .filter((p) => p.state === "posted" && p.external_post_id)
      .map((p) => p.id),
  );
  return queued
    .filter((job) => !job.parent_job_id || postedParents.has(job.parent_job_id))
    .slice(0, limit);
}
