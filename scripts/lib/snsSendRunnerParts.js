/**
 * snsSendRunner.js（SNS の送信の runner）から移した、定数・小さな関数・runSnsSend の中の塊（実行の各段）。
 * runner の本体 runSnsSend は、ここの関数を順に呼ぶだけにした（越えの関数を割る、2026-11-20。振る舞いは元のまま）。
 * runner が同じ名で再 export するので、外から見える名は変わらない。
 * api/ は import しない（lib-no-entry）: api/_lib の関数は runner が rs.api に入れて渡す。
 */

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
/** 非公開で残した YouTube を期限の前に見直すのは1回の実行でこの件数まで（BOA-1283）。公開に要る検査の回数は YOUTUBE_RESUME_CHECKS */
export const YOUTUBE_RESUME_MAX = 1;
export const YOUTUBE_RESUME_CHECKS = 2;
/**
 * 見直しを始めるのは、実行の始まりからこの秒数まで（目安、根拠なし）。公開の途中（ready・publishing）で関数の上限（300秒）に当たると、
 * 閉じる道（private_retained だけを拾う）にも見直しにも乗らず要照合に残るため、時間の残りが少ない実行では始めない（BOA-1283 の審査 P2-2）
 */
export const YOUTUBE_RESUME_START_LIMIT_SEC = 120;
/** 見直しに失敗した job（読み取りの失敗・本人の動画と確かめられない）は、この分数は読み直さない（Slack とクォータを2分ごとに使わない） */
export const RESUME_RETRY_MINUTES = 10;
export const YOUTUBE_POLL_WAIT_SEC = 30;

// PT の日付境界の前10分・後5分は、新しい YouTube 試行を始めない。
// 固定の UTC 時差ではなく、夏時間を含む現地時刻で判定する。
const pacificClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  hour: "2-digit",
  minute: "2-digit",
});
export function youtubeQuotaDayWait(now) {
  const parts = Object.fromEntries(
    pacificClock.formatToParts(now).map(({ type, value }) => [type, value]),
  );
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return minute >= 24 * 60 - 10 || minute < 5;
}

export const slug = (message) =>
  /^[a-z_]{1,64}$/.test(message ?? "") ? message : "unexpected_error";

/**
 * claim の段で DB（transition_sns_x_send・transition_sns_send_139 の RAISE）が拒否した文言 → 送らなかった理由の code（BOA-1201）。
 * 文言は 186・189 の claim で通る RAISE の全部。snsXSendStore は拒否を全部「X送信のDB操作に失敗しました」に包むので、
 * 元の文言（error.cause.message）で引く。ここに無い文言は db_rejected にして detail に元の文言を残す
 */
export const CLAIM_REJECTION_CODES = Object.freeze({
  // 189 transition_sns_send_139
  jobが見つかりません: "claim_job_missing",
  "X送信は停止中・費用未確認です": "claim_paused_or_unpriced",
  再承認が必要です: "claim_reapproval_required",
  "日次全体上限・他経路の本数が未確認です": "claim_daily_unconfirmed",
  日次全体上限です: "claim_daily_limit",
  claimできません: "claim_not_allowed",
  月額上限です: "claim_monthly_budget",
  // 186 transition_sns_x_send（139 の前後の X・YouTube 共通の段と、YouTube のクォータ）
  auto_stopped: "claim_auto_stopped",
  dry_run: "claim_dry_run",
  veto_window_open: "claim_veto_window_open",
  youtube_quota_unconfirmed: "claim_youtube_quota_unconfirmed",
  youtube_quota_limit: "claim_youtube_quota_limit",
});

/** 送信の中の失敗の detail: DB の拒否は元の文言（無ければ HTTP の状態）、それ以外は error.message */
function failureDetail(error, rejected) {
  return rejected
    ? (rejected.message ?? `${error.message}（HTTP ${rejected.status}）`)
    : String(error?.message ?? "");
}

/** DB の拒否の理由: send の段の claim の文言は CLAIM_REJECTION_CODES、英小文字と _ の文言はそのまま、ほかは db_rejected */
function rejectionReason(stage, message) {
  return (
    (stage === "send" && Object.hasOwn(CLAIM_REJECTION_CODES, message)
      ? CLAIM_REJECTION_CODES[message]
      : null) ?? (/^[a-z_]{1,64}$/.test(message) ? message : "db_rejected")
  );
}

/**
 * 送信の中の失敗 → sns_send_events の段・理由・detail（純粋関数、BOA-1201）
 * - 段: begin_post の後（error.postStarted、要照合で出たかもしれない）は after_post、それ以外は send
 * - 理由: 送信の関数が付けた holdReason → DB の拒否（claim の段は CLAIM_REJECTION_CODES、英小文字と _ の文言はそのまま、
 *   ほかは db_rejected）→ 英小文字と _ の文言はそのまま、ほかは unexpected_error
 * - detail: DB の拒否は元の文言（無ければ HTTP の状態）、それ以外は error.message
 */
export function sendFailureOf(error) {
  const stage = error?.postStarted ? "after_post" : "send";
  const rejected = error?.cause?.kind === "db_rejected" ? error.cause : null;
  const detail = failureDetail(error, rejected);
  if (error?.holdReason) return { stage, reason: error.holdReason, detail };
  if (!rejected) return { stage, reason: slug(error?.message), detail };
  return {
    stage,
    reason: rejectionReason(stage, rejected.message ?? ""),
    detail,
  };
}

/** 1回の実行で読む候補（queued の行）の上限。送る前の検査に落ちた job は送信の件数（maxJobs）に数えない */
export const SNS_SEND_MAX_CANDIDATES = 20;
/** 届かなかった一度きりの通知を report.alerts に残す時間（監視が再通知の間隔ごとに流す） */
export const UNDELIVERED_ALERT_HOURS = 24;
const UNDELIVERED_PREFIX = "undelivered:";
/** 送る前の検査・トークンの失敗の通知を、見直すまで残す時間（候補の巡回が一周するより長く） */
export const CONTINUING_ALERT_MINUTES = 30;

/** 親を待つ子の期限が、この分数より近くなったら知らせる */
export const PARENT_WAIT_ALERT_MINUTES = 10;

/** 送らなかった理由の detail の上限（191 の CHECK）。サロゲートペアを割らないよう文字単位で切る */
const EVENT_DETAIL_MAX = 300;
const clip = (text) =>
  Array.from(String(text ?? ""))
    .slice(0, EVENT_DETAIL_MAX)
    .join("");

/** 走査位置（scrape_job_state.cursor）: 送る時刻と id の組。次の実行はこの位置の後から読む（開発の補助の点検 D1） */
export const positionOf = (job) => ({
  scheduled_at: job.scheduled_at,
  id: job.id,
});

// ---- ここから下は runSnsSend の中の塊を名前のある関数にしたもの（振る舞いは元のまま）。共有の状態は rs（createRunState）に持つ ----

/** 前の実行の report の再試行の印（close_retry・resume_retry）のうち、期限の前の物 */
export function keptRetry(rs, name) {
  return (rs.ctx.state?.last_report?.[name] ?? []).filter(
    (r) => r?.id && Date.parse(r.until) > rs.now.getTime(),
  );
}

/**
 * 1回の実行の共有の状態。deps は runSnsSend の既定値を埋めた依存。
 * checks は、この実行で使った送る前の検査の回数（＝Chromium を開いた回数の上界）。送信の関数にも数える版（countedPreflight）を渡す
 */
export function createRunState(ctx, deps) {
  const now = ctx.now();
  const previous = (ctx.state?.last_report?.alerts ?? []).filter(
    (a) => a?.key && Date.parse(a.until) > now.getTime(),
  );
  const rs = {
    ...deps,
    ctx,
    live: ctx.mode === "live",
    now,
    results: [],
    previous,
    // 前の実行で届かなかった一度きりの通知は、期限まで report.alerts に持ち越す（report は毎回上書きされるため）
    alerts: previous.filter((a) => a.key.startsWith(UNDELIVERED_PREFIX)),
    continuingUntil: new Date(
      now.getTime() + CONTINUING_ALERT_MINUTES * 60000,
    ).toISOString(),
    // トークンは1回の実行でチャネルごとに1回だけ取る（失敗も覚えて、同じ実行の残りの job では取り直さない）
    adapterCache: new Map(),
    tokenChecked: new Set(),
    attempted: 0,
    posted: 0,
    checks: 0,
  };
  rs.countedPreflight = async (job) => {
    rs.checks += 1;
    return deps.preflight(job);
  };
  return rs;
}

/** 一度きりの事象はその場で Slack に知らせる。届かなければ（Webhook 未設定を含む）report.alerts に残し、監視に流してもらう */
export async function tell(rs, key, text) {
  try {
    await rs.notify(text);
  } catch (error) {
    console.error(`Slack に通知できません（${text}）: ${error.message}`);
    if (!rs.alerts.some((a) => a.key === `${UNDELIVERED_PREFIX}${key}`))
      rs.alerts.push({
        key: `${UNDELIVERED_PREFIX}${key}`,
        text: `（即時の通知が届かなかった）${text}`,
        until: new Date(
          rs.now.getTime() + UNDELIVERED_ALERT_HOURS * 3600000,
        ).toISOString(),
      });
  }
}

// 送らなかった理由を sns_send_events（191）に残す。shadow は DB を変えない。同じ (job, 段, 理由) は UNIQUE で書かない。
// 書けなくても送信は止めない。表が無い（191 は db-apply でコードのデプロイの後に当たる）間は console だけにし、Slack を鳴らし続けない
export async function recordEvent(rs, job, stage, reason, message) {
  if (!rs.live || !rs.store.recordEvent) return;
  try {
    await rs.store.recordEvent({
      job_id: job.id,
      stage,
      reason,
      detail: clip(message),
    });
  } catch (error) {
    if (error.tableMissing) {
      console.warn(
        `送らなかった理由を残せない（sns_send_events が無い、191 未適用）: ${job.id} ${stage} ${reason}`,
      );
      return;
    }
    console.error(
      `送らなかった理由を残せない: ${job.id} ${stage} ${reason}: ${error.message}`,
    );
    if (!rs.alerts.some((a) => a.key === "send_events"))
      rs.alerts.push({
        key: "send_events",
        text: `SNS の送信: 送らなかった理由を sns_send_events に書けない（送信は続けた）: ${error.message}`,
      });
  }
}

export function adapterFor(rs, channel) {
  if (!rs.adapterCache.has(channel))
    rs.adapterCache.set(
      channel,
      rs.adapters[channel]().then(
        (adapter) => ({ adapter }),
        (error) => ({ error }),
      ),
    );
  return rs.adapterCache.get(channel);
}

/** 非公開のまま期限を過ぎた YouTube を閉じた通知の文（動画が YouTube で削除済みかで分ける） */
function closedNotice(job, closed) {
  return closed?.error_code === "youtube_closed_deleted"
    ? `SNS の送信: YouTube job ${job.id} は非公開のまま期限を過ぎ、動画 ${job.external_post_id} は YouTube で削除済みだったので、公開しないで閉じた（${job.error_code ?? "理由なし"}）`
    : `SNS の送信: YouTube job ${job.id} は非公開のまま期限を過ぎたので、公開しないで閉じた（${job.error_code ?? "理由なし"}）。動画 ${job.external_post_id} は YouTube に非公開で残る。Studio で消すか残すかはオーナー`;
}

/** 閉じる候補1件（元の for の中身）。閉じられなければ理由を closeNotes・再試行の印を closeRetry に足す */
async function closeOneRetained(rs, job, closeRetry, closeNotes) {
  const { adapter, error: tokenError } = await adapterFor(rs, "youtube");
  try {
    if (tokenError) throw tokenError;
    const closed = await rs.api.closeRetainedYoutubeJob(
      { ...job, state: "reconcile" },
      { store: rs.store, lookup: (j) => adapter.lookup(j) },
    );
    await tell(rs, `closed:${job.id}`, closedNotice(job, closed));
  } catch (error) {
    closeNotes.set(job.id, error.message);
    closeRetry.push({
      id: job.id,
      until: new Date(
        rs.now.getTime() + CLOSE_RETRY_MINUTES * 60000,
      ).toISOString(),
    });
  }
}

// 非公開のまま残した YouTube（期限・リースの後）を、自分の非公開の動画と確かめて閉じる（BOA-1164）。Chromium は使わない。
// 閉じられなかった job は理由を要照合の通知に足し、CLOSE_RETRY_MINUTES は読み直さない（videos.list のクォータを2分ごとに使わない）
export async function closeRetainedJobs(rs, closeRetry, closeNotes) {
  const { ctx, store } = rs;
  if (!(rs.live && store.retainedYoutubeJobs)) return;
  const waiting = new Set(closeRetry.map((r) => r.id));
  const due = (
    await store.retainedYoutubeJobs(rs.now, YOUTUBE_CLOSE_MAX + waiting.size)
  )
    .filter((j) => !waiting.has(j.id))
    .slice(0, YOUTUBE_CLOSE_MAX);
  for (const job of due) {
    if (ctx.shouldStop()) break;
    await closeOneRetained(rs, job, closeRetry, closeNotes);
  }
}

// 要照合は DB の状態から毎回作る（sweep で要照合になったもの・前の実行が保存の前に落ちたものも拾う）
export async function addReconcileAlerts(rs, closeNotes) {
  for (const job of await rs.store.reconcileJobs())
    rs.alerts.push({
      key: `reconcile:${job.id}`,
      text: `SNS の送信が要照合: ${job.channel} job ${job.id}（${reconcileLabel(job)}）。管理画面で照合する${closeNotes.has(job.id) ? `（公開しないで閉じられない: ${closeNotes.get(job.id)}）` : ""}`,
    });
}

// 親（スレッドの親・全貌の完全版）が公開されないまま、期限が近い子。子は候補から外れて検査の通知も出ず、
// 期限の後に sweep で黙って held（deadline_expired）になるので、ここで知らせる（2026-10-20 system-architect の指摘）
export async function addWaitingChildAlerts(rs) {
  for (const child of (await rs.store.waitingChildren?.(
    rs.now,
    PARENT_WAIT_ALERT_MINUTES,
  )) ?? [])
    rs.alerts.push({
      key: `parent_waiting:${child.id}`,
      text: `SNS の送信: ${child.channel} job ${child.id} が、親（job ${child.parent_job_id}）の公開を待ったまま期限（${child.expires_at}）が近い。親が公開されなければ送らずに切れる`,
      until: rs.continuingUntil,
    });
}

// この実行で見直さなかった job の検査の理由・確かめなかったチャネルのトークンの失敗は、期限まで残す
export function carryOverAlerts(rs) {
  const examined = new Set(rs.results.map((r) => r.id));
  for (const a of rs.previous) {
    const [kind, subject] = a.key.split(":");
    if (
      (["precheck", "youtube_quota_day_wait"].includes(kind) &&
        !examined.has(subject)) ||
      (kind === "token" && !rs.tokenChecked.has(subject))
    )
      rs.alerts.push(a);
  }
}

/** YouTube: アップロード→処理の確認（最大3回）→公開。3回で処理が終わらなければ非公開のまま残す */
export async function sendYoutube(
  job,
  {
    store,
    youtube,
    preflight,
    loadMedia,
    wait,
    shouldStop,
    pollWaitSec,
    onThumbnailFailed,
    api,
  },
) {
  let current = await api.runYoutubeQueueJob(job.id, {
    store,
    youtube,
    preflight,
    loadMedia,
    onThumbnailFailed,
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
    current = await api.runYoutubePublishJob(current, {
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
    current = await store
      .transition(current.id, "youtube_retain", { reason: "processing" })
      .catch((error) => {
        // 上がった後（要照合）の失敗。送らなかった理由と分けて stage=after_post に残す（BOA-1201）
        error.postStarted = true;
        throw error;
      });
  return current;
}

/** 要照合の通知に出す段と理由（非公開のまま残した理由は error_code、186） */
export function reconcileLabel(job) {
  return (
    [job.youtube_stage, job.error_code].filter(Boolean).join("・") ||
    "結果が不明"
  );
}
