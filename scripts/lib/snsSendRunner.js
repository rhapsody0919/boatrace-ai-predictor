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
 * - 非公開のまま期限を過ぎた YouTube は、自分の非公開の動画と確かめて公開しないで閉じる（youtube_close_private、186）
 * - 保留の理由・要照合は report.alerts に入れ、監視（scrape-monitor）が Slack に流す（同じ key は再通知の間隔ごと）
 *   - 要照合は、毎回 DB の状態（state='reconcile'）から作る。オーナーが照合して解けるまで出し続ける（非公開のまま期限を過ぎた YouTube は runner が閉じて解く、BOA-1164）。
 *     実行のメモリに置いた通知は、途中で落ちると保存されず、sweep（DB の now()）と runner の時刻のずれでも漏れるため
 *     （開発の補助の点検 2026-10-13-28 の D2）
 *   - 送る前の検査・トークンの失敗は、候補を20件ずつ巡回するので、次にその job・チャネルを見直すまで（最長 CONTINUING_ALERT_MINUTES）残す
 */
import { runXSendJob } from "../../api/_lib/snsXSend.js";
import {
  closeRetainedYoutubeJob,
  runYoutubePublishJob,
  runYoutubeQueueJob,
} from "../../api/_lib/snsDeadlineQueue.js";

export const SNS_SEND_MAX_JOBS = 3;
/**
 * 1回の実行で Chromium を開ける回数（api/cron/sns-send.js が createChromiumHeadless の maxInspections に同じ値を渡す）。
 * 送る前の検査（preflight）1回が1回を使う。job ごとの必要数は headlessNeed（BOA-1164）
 */
export const SNS_SEND_HEADLESS_BUDGET = 6;
/** 非公開のまま残した YouTube を閉じるのは1回の実行でこの件数まで。閉じられなかった job は CLOSE_RETRY_MINUTES は読み直さない */
export const YOUTUBE_CLOSE_MAX = 3;
export const CLOSE_RETRY_MINUTES = 30;

/**
 * job を最後まで送るのに要る送る前の検査の回数（BOA-1164）。X は runner の検査1と runXSendJob の2、
 * YouTube は runner の1・送信の中の1・videos.insert の前の1・公開の準備の後の1・videos.update の前の1 の5
 * （カバーがあれば thumbnails.set の前の1を足して6。videos.list の前は検査しない、snsDeadlineQueue.js）。試運転（送らない）は runner の検査の1だけ
 */
export function headlessNeed(job, sending) {
  if (!sending) return 1;
  if (job.channel !== "youtube") return 3;
  return 5 + (job.snapshot?.media?.length === 2 ? 1 : 0);
}
export const YOUTUBE_MAX_POLLS = 3;
export const YOUTUBE_POLL_WAIT_SEC = 30;

// PT の日付境界の前10分・後5分は、新しい YouTube 試行を始めない。
// 固定の UTC 時差ではなく、夏時間を含む現地時刻で判定する。
const pacificClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});
function youtubeQuotaDayWait(now) {
  const parts = Object.fromEntries(
    pacificClock.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 24 * 60 - 10 || minute < 5;
}

const slug = (message) =>
  /^[a-z_]{1,64}$/.test(message ?? "") ? message : "unexpected_error";

/** 1回の実行で読む候補（queued の行）の上限。送る前の検査に落ちた job は送信の件数（maxJobs）に数えない */
export const SNS_SEND_MAX_CANDIDATES = 20;
/** 届かなかった一度きりの通知を report.alerts に残す時間（監視が再通知の間隔ごとに流す） */
export const UNDELIVERED_ALERT_HOURS = 24;
const UNDELIVERED_PREFIX = "undelivered:";
/** 送る前の検査・トークンの失敗の通知を、見直すまで残す時間（候補の巡回が一周するより長く） */
export const CONTINUING_ALERT_MINUTES = 30;

/** 親を待つ子の期限が、この分数より近くなったら知らせる */
export const PARENT_WAIT_ALERT_MINUTES = 10;

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
    headlessBudget = SNS_SEND_HEADLESS_BUDGET,
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
  // 非公開のまま残した YouTube（期限・リースの後）を、自分の非公開の動画と確かめて閉じる（BOA-1164）。Chromium は使わない。
  // 閉じられなかった job は理由を要照合の通知に足し、CLOSE_RETRY_MINUTES は読み直さない（videos.list のクォータを2分ごとに使わない）
  const closeRetry = (ctx.state?.last_report?.close_retry ?? []).filter(
    (r) => r?.id && Date.parse(r.until) > now.getTime(),
  );
  const closeNotes = new Map();
  if (live && store.retainedYoutubeJobs) {
    const waiting = new Set(closeRetry.map((r) => r.id));
    const due = (
      await store.retainedYoutubeJobs(now, YOUTUBE_CLOSE_MAX + waiting.size)
    )
      .filter((j) => !waiting.has(j.id))
      .slice(0, YOUTUBE_CLOSE_MAX);
    for (const job of due) {
      if (ctx.shouldStop()) break;
      const { adapter, error: tokenError } = await adapterFor("youtube");
      try {
        if (tokenError) throw tokenError;
        const closed = await closeRetainedYoutubeJob(
          { ...job, state: "reconcile" },
          { store, lookup: (j) => adapter.lookup(j) },
        );
        await tell(
          `closed:${job.id}`,
          closed?.error_code === "youtube_closed_deleted"
            ? `SNS の送信: YouTube job ${job.id} は非公開のまま期限を過ぎ、動画 ${job.external_post_id} は YouTube で削除済みだったので、公開しないで閉じた（${job.error_code ?? "理由なし"}）`
            : `SNS の送信: YouTube job ${job.id} は非公開のまま期限を過ぎたので、公開しないで閉じた（${job.error_code ?? "理由なし"}）。動画 ${job.external_post_id} は YouTube に非公開で残る。Studio で消すか残すかはオーナー`,
        );
      } catch (error) {
        closeNotes.set(job.id, error.message);
        closeRetry.push({
          id: job.id,
          until: new Date(
            now.getTime() + CLOSE_RETRY_MINUTES * 60000,
          ).toISOString(),
        });
      }
    }
  }
  // 要照合は DB の状態から毎回作る（sweep で要照合になったもの・前の実行が保存の前に落ちたものも拾う）
  for (const job of await store.reconcileJobs())
    alerts.push({
      key: `reconcile:${job.id}`,
      text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${reconcileLabel(job)}）。管理画面で照合する${closeNotes.has(job.id) ? `（公開しないで閉じられない: ${closeNotes.get(job.id)}）` : ""}`,
    });
  // 親（スレッドの親・全貌の完全版）が公開されないまま、期限が近い子。子は候補から外れて検査の通知も出ず、
  // 期限の後に sweep で黙って held（deadline_expired）になるので、ここで知らせる（2026-10-20 system-architect の指摘）
  for (const child of (await store.waitingChildren?.(
    now,
    PARENT_WAIT_ALERT_MINUTES,
  )) ?? [])
    alerts.push({
      key: `parent_waiting:${child.id}`,
      text: `SNS の送信: ${child.channel} job ${child.id} が、親（job ${child.parent_job_id}）の公開を待ったまま期限（${child.expires_at}）が近い。親が公開されなければ送らずに切れる`,
      until: continuingUntil,
    });
  const controls = await store.controls();
  const { jobs: candidates, nextCursor } = await store.dueJobs(
    now,
    maxCandidates,
    ctx.state?.cursor ?? null,
  );
  let attempted = 0;
  let posted = 0;
  // この実行で使った送る前の検査の回数（＝Chromium を開いた回数の上界）。送信の関数にも数える版を渡す
  let checks = 0;
  const countedPreflight = async (job) => {
    checks += 1;
    return preflight(job);
  };
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
    const deferYoutube = () => {
      if (
        job.channel !== "youtube" ||
        !live ||
        controls.youtube?.dry_run !== false ||
        !youtubeQuotaDayWait(ctx.now())
      )
        return false;
      result.outcome = "youtube_quota_day_wait";
      alerts.push({
        key: `youtube_quota_day_wait:${job.id}`,
        text: `SNS の送信: YouTube job ${job.id} は太平洋時間の日付境界（前10分・後5分）のため待機（claim していない）。期限 ${job.expires_at}`,
        until: continuingUntil,
      });
      return true;
    };
    if (deferYoutube()) continue;
    // 検査の枠（BOA-1164）: この実行で既に検査を使い、残りでこの job を最後まで送れないなら、ここから先は次の実行に回す。
    // 先に別のレースの X が枠を使い、YouTube が公開の準備の後の検査で public_check_budget になって非公開のまま残った（10/25 浜名湖10R）。
    // 最初の job は必要数が上限を超えても進める（回し続けて永久に送らないことを避ける）
    const need = headlessNeed(
      job,
      live && controls[job.channel]?.dry_run === false,
    );
    if (checks > 0 && checks + need > headlessBudget) {
      result.outcome = "headless_budget_wait";
      cursor =
        index > 0
          ? positionOf(candidates[index - 1])
          : (ctx.state?.cursor ?? null);
      break;
    }
    try {
      await countedPreflight(job);
    } catch (error) {
      result.outcome = "precheck_failed";
      result.reason = error.holdReason ?? slug(error.message);
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
    // 検査やトークン取得を待つ間に停止窓へ入った場合も claim しない。
    if (deferYoutube()) continue;
    attempted += 1;
    try {
      const done =
        job.channel === "x"
          ? await runXSendJob(job.id, {
              store,
              x: adapter,
              loadMedia,
              wait,
              preflight: countedPreflight,
            })
          : await sendYoutube(job, {
              store,
              youtube: adapter,
              preflight: countedPreflight,
              loadMedia,
              wait,
              shouldStop: ctx.shouldStop,
              pollWaitSec,
            });
      result.outcome = done.state;
      result.error_code = done.error_code ?? null;
      if (done.state === "posted") posted += 1;
      // 出し物ごとの取り置き（182）で claim が止めた。取り置きは後から空かないので一度きりの事象として知らせる
      if (done.state === "held" && done.error_code === "kind_slot_full")
        await tell(
          `held:${job.id}`,
          `SNS の送信を止めた（X の日の枠の出し物ごとの取り置きに入らない、kind_slot_full）: ${job.channel} job ${job.id}。送るなら取り置き（sns_x_kind_reserves）か daily_limit_x を見直して再承認する`,
        );
      // 要照合になったら、この実行の report にも出す（次の実行からは DB の状態から作る）
      if (done.state === "reconcile")
        alerts.push({
          key: `reconcile:${job.id}`,
          text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${reconcileLabel(done)}）。管理画面で照合する`,
        });
    } catch (error) {
      // job の状態（held・要照合）は送信の関数が DB に残している。ここでは理由を知らせるだけ
      result.outcome = "error";
      result.reason = error.holdReason ?? slug(error.message);
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
      (["precheck", "youtube_quota_day_wait"].includes(kind) &&
        !examined.has(subject)) ||
      (kind === "token" && !tokenChecked.has(subject))
    )
      alerts.push(a);
  }
  return {
    rowsWritten: posted,
    report: { jobs: results, alerts, close_retry: closeRetry },
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
  // 3回の確認・関数の時間の内に処理が終わらなかった（BOA-1164 の理由 processing）
  if (
    current.state === "reconcile" &&
    ["uploaded", "ready"].includes(current.youtube_stage)
  )
    current = await store.transition(current.id, "youtube_retain", {
      reason: "processing",
    });
  return current;
}

/** 要照合の通知に出す段と理由（非公開のまま残した理由は error_code、186） */
function reconcileLabel(job) {
  return (
    [job.youtube_stage, job.error_code].filter(Boolean).join("・") ||
    "結果が不明"
  );
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
