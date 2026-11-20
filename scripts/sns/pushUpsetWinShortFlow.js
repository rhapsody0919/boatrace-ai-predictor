/**
 * 人気薄の1着の Shorts の受け取りの本体（検査・二重送信の確認・下書きと item の作成・自動の承認・状態）。
 * push-upset-win-short.js から移した（pushUpsetWinShort の中身を段に分けた。使い方・検査・時刻の決まりはそちらの頭の説明）
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { parseUpsetId, upsetIdOf } from "../../api/_lib/snsUpsetWinShort.js";
import { mp4Info } from "../lib/sns/mp4Info.js";
import { jstTime } from "../lib/sns/shortSchedule.js";
import { RETRYABLE_JOB_STATES } from "./pushSetsuKiryokuShortFlow.js";
import {
  checkUpsetBundle,
  descriptionLink,
  dryRunClock,
  raceReasons,
  VIDEO_NAME,
} from "./pushUpsetWinShortChecks.js";
import {
  draftRow,
  itemRow,
  upsetStatusOf,
} from "./pushUpsetWinShortRows.js";
import {
  approveAuto,
  blockDraft,
  isAutoMode,
  planTiming,
  readShortVideo,
  sentLine,
  supersedeItems,
  youtubeRoomOf,
} from "./shortPushCommon.js";

/** job の無い自動の item は、作ってからこの分を過ぎたら承認の途中で落ちたとみなして作り直す（並行の push が作りかけの item を止めないため） */
export const ORPHAN_ITEM_MIN = 5;
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET upset_win_short_enabled = false WHERE channel = 'youtube';（上げている最中なら mode='manual' も）";

const retryable = (item, job, now) =>
  item.state === "notified" &&
  (job
    ? RETRYABLE_JOB_STATES.includes(job.state)
    : Date.parse(item.created_at) < now.getTime() - ORPHAN_ITEM_MIN * 60000);

// 束・upset_id・DB の照合・動画の検査。通れば { bytes }、通らなければ { reasons }
async function checkInput({ bundle, folder, readBytes, riskRules, upsetId, store }) {
  const reasons = checkUpsetBundle(bundle, riskRules);
  if (reasons.length) return { reasons };
  if (!parseUpsetId(upsetId)) return { reasons: ["upset_id が作れない"] };
  // 画面の数字と DB の照合（そのレースの6艇の値・1着・単勝を読み直す）
  const dbReasons = raceReasons(bundle, await store.raceOf(bundle.race_id));
  if (dbReasons.length) return { reasons: dbReasons };
  const video = await readShortVideo(readBytes, folder, VIDEO_NAME);
  if (video.reasons.length) return { reasons: video.reasons };
  return { bytes: video.bytes };
}

// 同じ日に生きている・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、200）。{ already } か { retry }
async function liveOf(store, { date, realNow }) {
  const retry = [];
  for (const item of (await store.upsetItems(date)).filter(
    (i) => !["stopped", "held_manual"].includes(i.state),
  )) {
    const job = await store.jobForDraft(item.draft_id);
    if (retryable(item, job, realNow)) retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じ日の upset_win_short が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: upsetStatusOf(item, job),
        },
      };
  }
  return { retry };
}

// DB の今の状態の検査（二重送信・日の上限とクォータ）。{ already }・{ reasons }・通れば { retry }
async function checkStoreState(
  store,
  { bundle, sendControl, simulated, realNow, when },
) {
  const live = await liveOf(store, { date: bundle.date, realNow });
  if (live.already) return live;
  const roomReason = await youtubeRoomOf(store, {
    sendControl,
    retry: live.retry,
    simulated,
    realNow,
    when,
  });
  if (roomReason) return { reasons: [roomReason] };
  return live;
}

/** 書かない結果（自動モードでない・許可が off・dry-run）。書くなら null */
function unwrittenResult({
  upsetId,
  writes,
  auto,
  dryRun,
  enabled,
  revision,
  when,
  publicUrl,
  bytes,
  extra,
}) {
  if (writes && !auto)
    return {
      upset_id: upsetId,
      manual: true,
      reason:
        "youtube の mode が auto でない（この型は自動の道だけで送る）ので何も書かなかった",
      ...extra,
    };
  if (!writes)
    return {
      upset_id: upsetId,
      dryRun: true,
      enabled,
      disabled: !dryRun,
      auto,
      revision,
      when,
      public_url: publicUrl,
      video: { name: VIDEO_NAME, bytes: bytes.byteLength, ...mp4Info(bytes) },
      ...extra,
    };
  return null;
}

/** 下書きと item を作り、自動の承認で送る予定に入れ、Slack に知らせる（書く段） */
async function writeShort(ctx) {
  const {
    store,
    notify,
    bundle,
    bytes,
    upsetId,
    when,
    observedAt,
    revision,
    publicUrl,
    control,
    auto,
    now,
  } = ctx;
  const videoPath = `upset-win-short/${bundle.date}/${revision}.mp4`;
  await store.saveFile(videoPath, bytes);
  const checkedAt = now.toISOString();
  const draft = await store.insertDraft(
    draftRow(bundle, { revision, videoPath, when, observedAt, publicUrl }),
  );
  let item;
  try {
    item = await store.insertItem(
      itemRow({ upsetId, draftId: draft.id, when, checkedAt }),
    );
  } catch (error) {
    await blockDraft(store, draft, "item を作れない");
    throw error;
  }
  const out = {
    upset_id: upsetId,
    draft_id: draft.id,
    item_id: item.id,
    auto,
    trial: control?.dry_run !== false,
  };
  Object.assign(
    out,
    await approveAuto(store, { draft, item, videoPath, bytes, when, control }),
  );
  await notify(
    `SNS 人気薄の1着（Shorts） ${upsetId}「${bundle.youtube.title}」\n${sentLine(out, when, control)}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

// 時計（dry-run の見本の束なら進めた時計）と upset_id
function clockAndId(bundle, realNow, dryRun) {
  const simulated = dryRun ? dryRunClock(bundle, realNow) : null;
  const upsetId =
    /^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "") && bundle?.race_id
      ? upsetIdOf(bundle.date, bundle.race_id)
      : null;
  return { simulated, now: simulated ?? realNow, upsetId };
}

// 検査で拒否したときの返り値（書く許可があれば Slack にも知らせる）
const rejecter =
  ({ notify, writes, upsetId, extra }) =>
  async (reasons) => {
    if (writes)
      await notify(
        `SNS 人気薄の1着（Shorts） ${upsetId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { upset_id: upsetId, reasons, ...extra };
  };

const revisionOf = (bundle, bytes) =>
  createHash("sha256")
    .update(JSON.stringify(bundle))
    .update(bytes)
    .digest("hex")
    .slice(0, 32);

// 7時台でない送る時刻の理由（checkTiming の理由の後ろに足す）
const lateReasons = (when) =>
  jstTime(when.send_at) > "07:59"
    ? [`送る時刻（${jstTime(when.send_at)}）が 7時台でない`]
    : [];

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ upset_id, draft_id, item_id, job_id, send_at, ... }
 */
export async function pushUpsetWinShort(
  folder,
  {
    store,
    readBytes,
    notify = async () => {},
    riskRules = [],
    now: realNow = new Date(),
    dryRun = false,
  },
) {
  const bundle = JSON.parse(
    new TextDecoder().decode(await readBytes(path.join(folder, "bundle.json"))),
  );
  const { simulated, now, upsetId } = clockAndId(bundle, realNow, dryRun);
  const controls = await store.controls();
  // 列が無い（200 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.youtube?.upset_win_short_enabled === true;
  const writes = enabled && !dryRun;
  const extra = simulated ? { simulated_now: simulated.toISOString() } : {};
  const reject = rejecter({ notify, writes, upsetId, extra });
  const input = await checkInput({ bundle, folder, readBytes, riskRules, upsetId, store });
  if (input.reasons) return reject(input.reasons);
  const { bytes } = input;
  const plan = await planTiming(store, bundle, now, {
    observedAt: bundle.source_observed_at,
    extra: lateReasons,
  });
  if (plan.reasons) return reject(plan.reasons);
  const { sendControl, when, observedAt } = plan;
  const state = await checkStoreState(store, {
    bundle,
    sendControl,
    simulated,
    realNow,
    when,
  });
  if (state.already)
    return { upset_id: upsetId, ...state.already, ...extra };
  if (state.reasons) return reject(state.reasons);
  const revision = revisionOf(bundle, bytes);
  const publicUrl = descriptionLink(
    bundle.youtube.description,
    bundle.race_id,
  ).url;
  const control = controls.youtube;
  const auto = isAutoMode(control);
  const skipped = unwrittenResult({
    upsetId,
    writes,
    auto,
    dryRun,
    enabled,
    revision,
    when,
    publicUrl,
    bytes,
    extra,
  });
  if (skipped) return skipped;
  await supersedeItems(store, state.retry, now);
  return writeShort({
    store,
    notify,
    bundle,
    bytes,
    upsetId,
    when,
    observedAt,
    revision,
    publicUrl,
    control,
    auto,
    now,
  });
}

/** その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null */
export async function upsetStatus(date, { store }) {
  const items = await store.upsetItems(date);
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return upsetStatusOf(item, await store.jobForDraft(item.draft_id));
}
