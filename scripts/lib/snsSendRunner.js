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
 *   3回で終わらなければ非公開のまま残す（youtube_retain）。残した理由は error_code に残る（budget・processing・check_failed・pt_day、186）
 * - 1回の実行の Chromium の上限（SNS_SEND_HEADLESS_BUDGET）を job ごとの必要数（headlessNeed）で見積もり、足りない job から先は
 *   次の実行に回す（BOA-1164）
 * - 処理待ち・検査の枠で非公開のまま残した YouTube は、期限の前は実行ごとに1件ずつ読み直し、処理が済んでいれば公開する
 *   （youtube_resume、196、BOA-1283。Shorts は処理に1分より長くかかり、3回の確認の後に残したまま期限で閉じていた）
 * - 非公開のまま期限を過ぎた YouTube は、自分の非公開の動画と確かめて公開しないで閉じる（youtube_close_private、186）
 * - YouTube のサムネイル（thumbnails.set）が失敗しても動画は公開まで進め、理由を report.jobs の thumbnail_error に入れて Slack に1回知らせる
 *   （BOA-1172。届かなければ report.alerts に残す）
 * - 保留の理由・要照合は report.alerts に入れ、監視（scrape-monitor）が Slack に流す（同じ key は再通知の間隔ごと）
 *   - 要照合は、毎回 DB の状態（state='reconcile'）から作る。オーナーが照合して解けるまで出し続ける（非公開のまま期限を過ぎた YouTube は runner が閉じて解く、BOA-1164）。
 *     実行のメモリに置いた通知は、途中で落ちると保存されず、sweep（DB の now()）と runner の時刻のずれでも漏れるため
 *     （開発の補助の点検 2026-10-13-28 の D2）
 *   - 送る前の検査・トークンの失敗は、候補を20件ずつ巡回するので、次にその job・チャネルを見直すまで（最長 CONTINUING_ALERT_MINUTES）残す
 * - 送らなかった理由（送る前の検査の失敗・送信の中の失敗）は、live のときだけ DB の sns_send_events（191）にも (job, 段, 理由) ごとに
 *   初出の1行を残す。hq の見張りは Slack を読めないので DB で読む（BOA-1201）。書けなくても送信は止めない
 *   - 段は precheck（claim の前）・send（claim から begin_post まで。claim の DB の拒否は CLAIM_REJECTION_CODES の code）・
 *     after_post（begin_post の後。要照合で、出たかもしれないので送らなかった理由と分ける）
 */
import {
  closeRetainedYoutubeJob,
  RESUMABLE_RETAIN_CODES,
  resumeRetainedYoutubeJob,
  runYoutubePublishJob,
  runYoutubeQueueJob,
} from "./sns/youtubeQueue.js";
import { runXSendJob } from "./sns/xSend.js";
import {
  addReconcileAlerts,
  addWaitingChildAlerts,
  carryOverAlerts,
  closeRetainedJobs,
  createRunState,
  keptRetry,
  positionOf,
  SNS_SEND_HEADLESS_BUDGET,
  SNS_SEND_MAX_CANDIDATES,
  SNS_SEND_MAX_JOBS,
  YOUTUBE_POLL_WAIT_SEC,
} from "./snsSendRunnerParts.js";
import { resumeRetainedJobs, sendCandidates } from "./snsSendRunnerSend.js";

// 定数・小さな関数は snsSendRunnerParts.js へ移した。外から見える名はここから同じ名で出す
export {
  CLAIM_REJECTION_CODES,
  CLOSE_RETRY_MINUTES,
  CONTINUING_ALERT_MINUTES,
  headlessNeed,
  PARENT_WAIT_ALERT_MINUTES,
  RESUME_RETRY_MINUTES,
  sendFailureOf,
  SNS_SEND_HEADLESS_BUDGET,
  SNS_SEND_MAX_CANDIDATES,
  SNS_SEND_MAX_JOBS,
  UNDELIVERED_ALERT_HOURS,
  YOUTUBE_CLOSE_MAX,
  YOUTUBE_MAX_POLLS,
  YOUTUBE_POLL_WAIT_SEC,
  YOUTUBE_RESUME_CHECKS,
  YOUTUBE_RESUME_MAX,
  YOUTUBE_RESUME_START_LIMIT_SEC,
} from "./snsSendRunnerParts.js";

// 分けた段（snsSendRunnerParts.js・snsSendRunnerSend.js）は api/ を import できないので、api/_lib の関数はここから渡す
const SEND_API = {
  closeRetainedYoutubeJob,
  resumeRetainedYoutubeJob,
  runXSendJob,
  runYoutubePublishJob,
  runYoutubeQueueJob,
};

/** runSnsSend の依存の既定値（元は runSnsSend の引数の分割代入の既定値） */
function withRunnerDefaults({
  store,
  adapters,
  preflight,
  loadMedia,
  notify = async () => {},
  wait = (sec) => new Promise((resolve) => setTimeout(resolve, sec * 1000)),
  maxJobs = SNS_SEND_MAX_JOBS,
  maxCandidates = SNS_SEND_MAX_CANDIDATES,
  headlessBudget = SNS_SEND_HEADLESS_BUDGET,
  pollWaitSec = YOUTUBE_POLL_WAIT_SEC,
}) {
  return {
    store,
    adapters,
    preflight,
    loadMedia,
    notify,
    wait,
    maxJobs,
    maxCandidates,
    headlessBudget,
    pollWaitSec,
    api: SEND_API,
  };
}

/**
 * @param {{mode: string, now: () => Date, shouldStop: () => boolean}} ctx
 * @param {{store, adapters: {x: () => Promise<object>, youtube: () => Promise<object>}, preflight, loadMedia, notify?, wait?, maxJobs?, pollWaitSec?}} deps
 * notify(text): 一度きりの事象（要照合・送信の失敗）を Slack に直接知らせる。続いている状態（検査で止まっている・トークンを取れない）は
 * report.alerts に入れ、監視（scrape-monitor、5分ごと）が同じ key を再通知の間隔ごとに知らせる。
 * report は2分ごとの実行で上書きされるので、一度きりの事象を report だけに入れると監視が読む前に消える
 */
export async function runSnsSend(ctx, deps) {
  const rs = createRunState(ctx, withRunnerDefaults(deps));
  // shadow では DB の状態を変えない（sweep も行わない）
  if (rs.live) await rs.store.sweep();
  const closeRetry = keptRetry(rs, "close_retry");
  const closeNotes = new Map();
  await closeRetainedJobs(rs, closeRetry, closeNotes);
  await addReconcileAlerts(rs, closeNotes);
  await addWaitingChildAlerts(rs);
  const controls = await rs.store.controls();
  const { jobs: candidates, nextCursor } = await rs.store.dueJobs(
    rs.now,
    rs.maxCandidates,
    ctx.state?.cursor ?? null,
  );
  const cursor = await sendCandidates(rs, controls, candidates, nextCursor);
  const resumeRetry = keptRetry(rs, "resume_retry");
  await resumeRetainedJobs(rs, controls, resumeRetry);
  carryOverAlerts(rs);
  return {
    rowsWritten: rs.posted,
    report: {
      jobs: rs.results,
      alerts: rs.alerts,
      close_retry: closeRetry,
      resume_retry: resumeRetry,
    },
    body: { jobs: rs.results },
    cursor,
  };
}

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

/**
 * PostgREST の書き込み（service_role）: 送らなかった理由を sns_send_events（191）に1行。同じ (job, 段, 理由) は UNIQUE で
 * 止まり、resolution=ignore-duplicates で行を書かずに成功する（2分ごとの繰り返しで WAL を増やさない）。
 * 失敗は投げる。表が無い（404・PGRST205）ときは tableMissing を付ける
 */
export function createPostgrestEventWriter({ url, key, fetchImpl = fetch }) {
  return async (event) => {
    const response = await fetchImpl(
      `${url}/rest/v1/sns_send_events?on_conflict=job_id,stage,reason`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal",
        },
        body: JSON.stringify(event),
      },
    );
    if (response.ok) return;
    // 本文は code だけ読む（message・details は残さない）
    const code = (await response.json().catch(() => null))?.code ?? null;
    const error = new Error(
      `sns_send_events の書き込みに失敗: HTTP ${response.status}${code ? ` ${code}` : ""}`,
    );
    error.tableMissing =
      response.status === 404 || code === "PGRST205" || code === "42P01";
    throw error;
  };
}

/** 送信の job の読み書き。xSendStore（api/_lib/snsXSendStore.js）の送信の操作に、runner の読み取りと送らなかった理由の書き込みを足す */
export function createSnsSendStore({ db, xSendStore, writeEvent }) {
  return {
    recordEvent: writeEvent,
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
    // 親が posted でないまま、期限が withinMinutes 分以内の queued の子
    async waitingChildren(now, withinMinutes) {
      const limit = new Date(now.getTime() + withinMinutes * 60000);
      const children = await db(
        `sns_x_send_jobs?state=eq.queued&parent_job_id=not.is.null&expires_at=lte.${encodeURIComponent(limit.toISOString())}&order=id.asc&select=id,channel,parent_job_id,expires_at`,
      );
      if (!children.length) return [];
      const parents = await db(
        `sns_x_send_jobs?id=in.(${[...new Set(children.map((c) => c.parent_job_id))].join(",")})&select=id,state,external_post_id`,
      );
      const posted = new Set(pickDueJobs(children, parents).map((c) => c.id));
      return children.filter((c) => !posted.has(c.id));
    },
    // 非公開のまま残し、期限とリースの過ぎた YouTube の job（閉じる候補、BOA-1164）。閉じてよいかの最終の判定は DB の youtube_close_private
    async retainedYoutubeJobs(now, limit) {
      const at = encodeURIComponent(now.toISOString());
      return db(
        `sns_x_send_jobs?state=eq.reconcile&channel=eq.youtube&youtube_stage=eq.private_retained&expires_at=lte.${at}&or=${encodeURIComponent(`(lease_until.is.null,lease_until.lte.${now.toISOString()})`)}&order=id.asc&limit=${limit}&select=id,channel,state,youtube_stage,error_code,external_post_id,attempts,expires_at,snapshot`,
      );
    },
    // 処理待ち・検査の枠で非公開のまま残した job と、公開の段の途中で切れた ready の job のうち、期限の前でリースの切れたもの（見直す候補、BOA-1283）。見直してよいかの最終の判定は DB の youtube_resume
    async resumableYoutubeJobs(now, limit) {
      const at = encodeURIComponent(now.toISOString());
      return db(
        `sns_x_send_jobs?state=eq.reconcile&channel=eq.youtube&expires_at=gt.${at}&and=${encodeURIComponent(`(or(and(youtube_stage.eq.private_retained,error_code.in.(${RESUMABLE_RETAIN_CODES.join(",")})),and(youtube_stage.eq.ready,error_code.is.null)),or(lease_until.is.null,lease_until.lte.${now.toISOString()}))`)}&order=expires_at.asc,id.asc&limit=${limit}&select=id,channel,state,youtube_stage,error_code,external_post_id,attempts,expires_at,snapshot`,
      );
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
