// 優勝戦・思考投稿の状態の読み出し・送り手の結果の待ち・結果の1行（FINALS_RESULT）。push-finals-image.js から移した。
import {
  FINALS_IMAGE_FORMAT,
  RETRYABLE_JOB_STATES,
  statusOf,
} from "../lib/sns/finalsImageBase.js";
import { KINDS } from "./pushFinalsImageKinds.js";

/**
 * 1つの種類の状態。新しい順に、生きている item（無ければ最新の item）の job。item が無ければ null。
 * skipStopped（投票のリプ）は止めた item を数えない（投票ありの束を投票なしで作り直したとき、前の試行の止めた投票のリプを出さない。BOA-1208）
 */
async function variantStatus(
  raceId,
  variant,
  store,
  kind,
  { skipStopped = false } = {},
) {
  const all = await store.finalsItems(raceId, variant, kind);
  const items = skipStopped ? all.filter((i) => i.state !== "stopped") : all;
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return statusOf(raceId, item, await store.jobForDraft(item.draft_id));
}

/**
 * 送った時刻・tweet id（hq の記録用）。本投稿の状態に、投票のリプ（poll）・展示後のリプ（reply）の状態を添える（無ければ null。
 * どちらも任意で、本投稿の完了はリプを待たない。BOA-1208）。本投稿が無ければ null。
 * kind は KINDS のキー（既定は優勝戦）
 */
export async function finalsStatus(
  raceId,
  { store, kind = FINALS_IMAGE_FORMAT },
) {
  const { variants } = KINDS[kind];
  const main = await variantStatus(raceId, variants.main, store, kind);
  if (!main) return null;
  return {
    ...main,
    poll: await variantStatus(raceId, variants.poll, store, kind, {
      skipStopped: true,
    }),
    reply: await variantStatus(raceId, variants.reply, store, kind),
  };
}

/** 送り手の結果を待つ間隔と、期限の後に待つ時間（送り手の最後の実行の終わりを待つ） */
export const WAIT_POLL_SEC = 15;
export const WAIT_AFTER_EXPIRES_SEC = 90;
// reconcile は begin_post から complete までの送っている途中でもあるので、終わりに数えない（期限＋90秒まで待つ）
const DONE_STATES = ["posted", ...RETRYABLE_JOB_STATES];

/**
 * この push の job（draft で引く）が送り終わる（posted・held 等）か、期限＋WAIT_AFTER_EXPIRES_SEC を過ぎるまで待つ。
 * pollDraftId（本投稿）があれば、本投稿が posted になった後、投票のリプも送り終わるまで待ち、status.poll に入れる
 */
export async function waitForSend(
  raceId,
  {
    store,
    draftId,
    pollDraftId = null,
    expiresAt,
    now = () => new Date(),
    sleep,
  },
) {
  const until = Date.parse(expiresAt) + WAIT_AFTER_EXPIRES_SEC * 1000;
  for (;;) {
    const status = statusOf(raceId, null, await store.jobForDraft(draftId));
    const timedOut = now().getTime() >= until;
    if (DONE_STATES.includes(status.job_state) || timedOut) {
      if (!pollDraftId) return status;
      const poll = statusOf(raceId, null, await store.jobForDraft(pollDraftId));
      if (
        status.job_state !== "posted" ||
        DONE_STATES.includes(poll.job_state) ||
        timedOut
      )
        return { ...status, poll };
    }
    await sleep(WAIT_POLL_SEC);
  }
}

/** 投票のリプを待つのは、この push が投票のリプを作った（待った結果に poll がある）ときだけ（BOA-1208） */
const isPollPending = (result, status) =>
  result.part !== "reply" &&
  status?.job_state === "posted" &&
  status.poll != null &&
  status.poll.job_state !== "posted";

/** 結果の種類（outcome） */
function outcomeOf(result, status, waited, pollPending) {
  if (result.reasons?.length) return "rejected";
  if (result.already) return "already_exists";
  if (result.disabled) return "disabled";
  if (result.dryRun) return "dry_run_ok";
  if (status?.job_state === "posted")
    return pollPending ? "poll_not_posted" : "posted";
  return result.job_id && !waited ? "queued" : "not_posted";
}

const EXIT_CODES = {
  posted: 0,
  dry_run_ok: 0,
  queued: 0,
  rejected: 1,
  disabled: 3,
  already_exists: 4,
  not_posted: 5,
  poll_not_posted: 5,
  error: 6,
};

/** 結果の理由の文 */
const reasonOf = (result, pollPending) =>
  result.reasons?.join(" / ") ??
  result.reason ??
  (result.disabled
    ? `自動送信の許可（${KINDS[result.kind]?.flag ?? KINDS[FINALS_IMAGE_FORMAT].flag}）が off なので送らなかった`
    : pollPending
      ? "本投稿は出たが、投票のリプが出ていない"
      : null);

/** 本投稿の job の欄 */
const jobFieldsOf = (s, result) => ({
  job_id: s?.job_id ?? result.job_id ?? null,
  job_state: s?.job_state ?? null,
  tweet_id: s?.tweet_id ?? null,
  tweet_url: s?.tweet_url ?? null,
  posted_at: s?.posted_at ?? null,
  error_code: s?.error_code ?? result.error ?? null,
});

/** 投票のリプの job の欄 */
const pollFieldsOf = (s, result) => ({
  poll_job_id: s?.poll?.job_id ?? result.poll_job_id ?? null,
  poll_job_state: s?.poll?.job_state ?? null,
  poll_tweet_id: s?.poll?.tweet_id ?? null,
  poll_error_code: s?.poll?.error_code ?? null,
});

/** 結果の1行と exit の番号（純粋関数）。status は待った結果（--no-wait なら null） */
export function resultLine(
  raceId,
  result,
  status = null,
  { waited = Boolean(status) } = {},
) {
  const pollPending = isPollPending(result, status);
  const outcome = outcomeOf(result, status, waited, pollPending);
  const s = status ?? result.status ?? null;
  const line = {
    race_id: raceId ?? null,
    part: result.part ?? "main",
    // 優勝戦の行は今までと同じバイト列にする（kind は思考投稿の行にだけ足す）
    ...(result.kind && result.kind !== FINALS_IMAGE_FORMAT
      ? { kind: result.kind }
      : {}),
    outcome,
    ...jobFieldsOf(s, result),
    reason: reasonOf(result, pollPending),
    ...pollFieldsOf(s, result),
  };
  return {
    code: EXIT_CODES[outcome],
    text: `FINALS_RESULT ${JSON.stringify(line)}`,
  };
}
