// 優勝戦・思考投稿の下書き・item の行の組み立てと、DB への書き込み（本投稿・投票のリプ・展示後のリプ）。push-finals-image.js から移した。
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  FINALS_IMAGE_FORMAT,
  RETRYABLE_JOB_STATES,
  checkImages,
  hasPoll,
  statusOf,
} from "../lib/sns/finalsImageBase.js";
import { KINDS } from "./pushFinalsImageKinds.js";

const raceUrlOf = (raceId) => `https://www.boat-ai.jp/race/${raceId}?tab=sonar`;

/** 送る直前の読み直しの材料（deadline_queue）。parentJobId はリプの親（本投稿の job） */
const queueOf = (bundle, { revision, when, observedAt, parentJobId }) => ({
  deadline_at: when.deadline_at,
  expires_at: when.expires_at,
  source_revision: revision,
  source_observed_at: observedAt,
  public_url: raceUrlOf(bundle.race_id),
  screen_key: "race-sonar",
  ...(parentJobId ? { parent_job_id: parentJobId } : {}),
});

/**
 * 下書きの行（純粋関数）。part は main（本投稿）・poll（投票のリプ）・reply（展示後のリプ）。
 * public_url は送る直前の表示の確認に使う。poll は媒体なし・source_data.x_poll（createXSnapshot が snapshot.poll に写す）。
 * poll は親の job ができるまで公開保留（子だけ先に承認されて単独の投稿にならない。/today の reply と同じ）。
 * kind は KINDS のキー（既定は優勝戦）。source_data のキーは種類ごとに1つだけ（digest・full_picture・他の種類のキーを入れない。
 * readCurrent がキーで振り分けるため）
 */
export function draftRow(
  bundle,
  {
    revision,
    paths = [],
    when,
    observedAt,
    part = "main",
    parentJobId = null,
    kind = FINALS_IMAGE_FORMAT,
  },
) {
  const cfg = KINDS[kind];
  const raceUrl = raceUrlOf(bundle.race_id);
  const poll = part === "poll";
  return {
    content_group_id: randomUUID(),
    language: "ja",
    status: "pending_review",
    format: cfg.draftFormat,
    platform: "x",
    title: `${cfg.title}${{ main: "", poll: "（投票のリプ）", reply: "（展示後のリプ）" }[part]} ${bundle.race_id}`,
    caption_text: poll ? bundle.poll_text : bundle.x_text,
    hashtags: [],
    publish_blocked: poll,
    publication_hold_reasons: [],
    send_lane: "A",
    scheduled_at: when.send_at,
    cover_image_path: paths[0] ?? null,
    source_data: {
      [cfg.sourceKey]: {
        race_id: bundle.race_id,
        revision,
        review: bundle.review,
        part,
      },
      // 承認の関数（160）が媒体をこの順で照合する（先頭は cover_image_path）
      ...(paths.length ? { image_paths: paths } : {}),
      // 投票は締切で閉じる（分は送る時に runXSendJob が決める）
      ...(poll
        ? { x_poll: { options: bundle.poll, closes_at: when.deadline_at } }
        : {}),
      // thread_length は入れない（送り手の検査が加重280で見る）
      deadline_queue: queueOf(bundle, {
        revision,
        when,
        observedAt,
        parentJobId,
      }),
      release_evidence: {
        status: "released",
        url: raceUrl,
        screen_key: "race-sonar",
        confirmed_by: "push-finals-image",
        reference: cfg.draftFormat,
        checked_at: observedAt,
        confirmed_at: observedAt,
      },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
    },
  };
}

/** item の行（純粋関数）。自動（notified）は止めるリンクを作らない（全貌と同じ。153 の CHECK が要るので使わない乱数のハッシュ） */
function itemRow(
  bundle,
  { draftId, variant, when, state, observedAt, kind = FINALS_IMAGE_FORMAT },
) {
  return {
    kind,
    variant,
    draft_id: draftId,
    channel: "x",
    race_id: bundle.race_id,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state,
    checks: { passed: true, review: bundle.review, checked_at: observedAt },
    ...(state === "notified"
      ? {
          notified_at: observedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/** 自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無い item か */
const isRetryable = (item, job) =>
  item.state === "notified" &&
  (!job || RETRYABLE_JOB_STATES.includes(job.state));

/**
 * 同じレース・同じ種類の生きている item を見る。送った・送っている item があれば { already } を返す。
 * 自動の item の job が送らずに終わった（held・failed・cancelled）か、承認の途中で落ちて job が無い item は、作り直す対象として返す
 */
export async function liveOf(store, raceId, variant, kind) {
  const live = (await store.finalsItems(raceId, variant, kind)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (isRetryable(item, job)) retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じレースの ${variant} が既にある（item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: statusOf(raceId, item, job),
        },
      };
  }
  return { retry };
}

/** フォルダの画像4枚を読み、検査する。読めない（ENOENT 以外）は原因を残す */
export async function readImages(folder, names, readBytes) {
  const files = {};
  const readErrors = [];
  for (const name of names) {
    try {
      files[name] = await readBytes(path.join(folder, name));
    } catch (error) {
      files[name] = undefined;
      // 無い（ENOENT）は checkImages が「無い」と書く。それ以外（権限・I/O）は原因を残す
      if (error?.code && error.code !== "ENOENT")
        readErrors.push(
          `${name} を読めない（${error.code}: ${error.message}）`,
        );
    }
  }
  return { files, reasons: [...readErrors, ...checkImages(names, files)] };
}

/** 下書きを自動送信の承認者で承認する（媒体は手元のバイトで hash を取る） */
async function approveDraft(
  store,
  draft,
  approverId,
  when,
  byPath = new Map(),
) {
  const snapshot = await createXSnapshot(draft, async (p) =>
    byPath.has(p)
      ? byPath.get(p)
      : Promise.reject(new Error("媒体の path が違う")),
  );
  return store.approve({
    p_draft_id: draft.id,
    p_approver_id: approverId,
    p_snapshot: snapshot,
    p_scheduled_at: when.send_at,
  });
}

/** 展示後のリプの行を作る。親（本投稿の job）は deadline_queue.parent_job_id。自動でなければ manual（個別承認でも親につながっている） */
export async function pushReplyRows(
  store,
  bundle,
  {
    revision,
    paths,
    when,
    observedAt,
    auto,
    approverId,
    parentJob,
    byPath,
    kind = FINALS_IMAGE_FORMAT,
  },
) {
  const draft = await store.insertDraft(
    draftRow(bundle, {
      revision,
      paths,
      when,
      observedAt,
      part: "reply",
      parentJobId: parentJob.id,
      kind,
    }),
  );
  const item = await store.insertItem(
    itemRow(bundle, {
      draftId: draft.id,
      variant: KINDS[kind].variants.reply,
      when,
      state: auto ? "notified" : "manual",
      observedAt,
      kind,
    }),
  );
  const out = { draft_id: draft.id, item_id: item.id, auto: Boolean(auto) };
  if (!auto) return out;
  try {
    const job = await approveDraft(store, draft, approverId, when, byPath);
    out.job_id = job?.id ?? null;
    out.send_at = when.send_at;
  } catch (error) {
    out.error = error.message;
    try {
      await store.updateItem(item.id, "notified", { state: "manual" });
    } catch (updateError) {
      // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
      console.error(
        `item ${item.id} を manual に戻せない: ${updateError.message}`,
      );
      out.error += `（item を manual に戻せない: ${updateError.message}）`;
    }
  }
  return out;
}

/** 本投稿の下書き・投票のリプの下書き・それぞれの item を作る（withPoll でなければ投票のリプは null） */
async function insertMainRows(
  store,
  bundle,
  { revision, paths, when, observedAt, auto, kind, withPoll },
) {
  const { variants } = KINDS[kind];
  const state = auto ? "notified" : "held_manual";
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, paths, when, observedAt, kind }),
  );
  const pollDraft = withPoll
    ? await store.insertDraft(
        draftRow(bundle, { revision, when, observedAt, part: "poll", kind }),
      )
    : null;
  const heldReason = auto
    ? null
    : withPoll
      ? "自動モードでない（投票のリプは自動の道だけでつなぐ）"
      : "自動モードでない";
  const item = await store.insertItem({
    ...itemRow(bundle, {
      draftId: draft.id,
      variant: variants.main,
      when,
      state,
      observedAt,
      kind,
    }),
    ...(heldReason ? { held_reason: heldReason } : {}),
  });
  const pollItem = pollDraft
    ? await store.insertItem({
        ...itemRow(bundle, {
          draftId: pollDraft.id,
          variant: variants.poll,
          when,
          state,
          observedAt,
          kind,
        }),
        ...(heldReason ? { held_reason: heldReason } : {}),
      })
    : null;
  return { draft, pollDraft, item, pollItem };
}

/** 本投稿の job の id を親として投票のリプの公開保留を外し、承認する。投票のリプの job の id を返す */
async function approvePollRow(
  store,
  pollDraft,
  { parentJobId, approverId, when },
) {
  const linked = await store.updateDraft(pollDraft.id, {
    source_data: {
      ...pollDraft.source_data,
      deadline_queue: {
        ...pollDraft.source_data.deadline_queue,
        parent_job_id: parentJobId,
      },
    },
    publish_blocked: false,
  });
  const pollJob = await approveDraft(store, linked, approverId, when);
  return pollJob?.id ?? null;
}

/** 自動の承認が落ちたとき、作った item を held_manual に戻す。戻せなければ out.error に足す */
async function holdMainItems(store, rows, error, out) {
  for (const row of rows)
    await store
      .updateItem(row.id, "notified", {
        state: "held_manual",
        held_reason: `${rows.length > 1 ? "本投稿・投票のリプの" : "本投稿の"}自動の承認に失敗: ${error.message.split("\n")[0]}`,
      })
      .catch((updateError) => {
        // item が notified のまま。次の呼び出しで superseded にして作り直す
        console.error(
          `item ${row.id} を held_manual に戻せない: ${updateError.message}`,
        );
        out.error += `（item ${row.id} を戻せない: ${updateError.message}）`;
      });
}

/**
 * 本投稿と投票のリプの行を作る。withPoll が false（投票の無い bundle、BOA-1208）なら本投稿だけを作り、自動なら本投稿だけを承認する。
 * 投票があれば、自動なら本投稿を承認し、その job を投票のリプの deadline_queue.parent_job_id に入れて公開保留を外してから承認する
 * （/today の reply と同じ順、snsTodayPlanner.js）。どこかで落ちたら作った item をすべて held_manual（投票があるときは、投票のリプの無い本投稿だけを出さない）。
 * 自動でないときも作った item をすべて held_manual（投票があるときは、子を親につなぐのが自動の道だけのため。投票が無いときも今までどおり手動では送らない）
 */
export async function pushMainRows(
  store,
  bundle,
  {
    revision,
    paths,
    when,
    observedAt,
    auto,
    approverId,
    byPath,
    kind = FINALS_IMAGE_FORMAT,
    withPoll = hasPoll(bundle),
  },
) {
  const { draft, pollDraft, item, pollItem } = await insertMainRows(
    store,
    bundle,
    { revision, paths, when, observedAt, auto, kind, withPoll },
  );
  const out = {
    draft_id: draft.id,
    item_id: item.id,
    ...(pollItem
      ? { poll_draft_id: pollDraft.id, poll_item_id: pollItem.id }
      : {}),
    auto: Boolean(auto),
  };
  if (!auto) return out;
  try {
    const job = await approveDraft(store, draft, approverId, when, byPath);
    if (!job?.id) throw new Error("本投稿の job の id を受け取れない");
    if (pollDraft)
      out.poll_job_id = await approvePollRow(store, pollDraft, {
        parentJobId: job.id,
        approverId,
        when,
      });
    out.job_id = job.id;
    out.send_at = when.send_at;
  } catch (error) {
    out.error = error.message;
    delete out.job_id;
    // 承認した本投稿の job は、item が notified でないと claim で止まる（transition_sns_x_send の auto_stopped）
    await holdMainItems(store, [item, pollItem].filter(Boolean), error, out);
  }
  return out;
}
