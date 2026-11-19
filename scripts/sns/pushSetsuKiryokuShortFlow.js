/**
 * 節の機力の Shorts の受け取りの本体（検査・二重送信の確認・下書きと item の作成・自動の承認・状態・待つ所）。
 * push-setsu-kiryoku-short.js から移した（pushSetsuKiryokuShort の中身を段に分けた。使い方・検査・時刻の決まりはそちらの頭の説明）
 */
import { createHash } from "node:crypto";
import path from "node:path";
import {
  finalKeyOf,
  parseSetsuId,
  setsuIdOf,
  setsuItemVariantOf,
  venueCodeOf,
} from "../../api/_lib/snsSetsuKiryokuShort.js";
import { dryRunClock } from "../lib/sns/shortSchedule.js";
import {
  checkShortBundle,
  descriptionLink,
  videoNameOf,
} from "./pushSetsuKiryokuShortChecks.js";
import { deadlineReasons } from "./pushSetsuKiryokuShortDeadlines.js";
import {
  draftRow,
  itemRow,
  setsuStatusOf,
  unwrittenResult,
} from "./pushSetsuKiryokuShortRows.js";
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

export const RETRYABLE_JOB_STATES = ["held", "failed", "cancelled"];
export const WAIT_POLL_SEC = 30;
export const WAIT_AFTER_EXPIRES_SEC = 90;
const DONE_STATES = ["posted", ...RETRYABLE_JOB_STATES];
// 旗は claim と送る直前の検査で効く。上げている最中（youtube_call の後）を DB で止めるのは mode=manual か item の停止（system-architect P3）
const STOP_SQL =
  "UPDATE public.sns_auto_send_control SET setsu_kiryoku_short_enabled = false WHERE channel = 'youtube';（上げている最中なら mode='manual' も）";

/** 送らずに終わった item か（作り直してよい）。自動の item で job が無い（承認の途中で落ちた）か、job が held・failed・cancelled */
const retryable = (item, job) =>
  item.state === "notified" &&
  (!job || RETRYABLE_JOB_STATES.includes(job.state));

/**
 * 同じ日・同じ版（variant）の生きている item と、同じ優勝戦（final_gap）の item を見る。送った・送っている・待っている item があれば
 * { already } か { reasons }。送らずに終わった item は作り直す対象（retry）として返す。版の違う item（朝の border と夜の節の機力）は見ない
 */
async function liveOf(store, { date, variant, finalKey }) {
  const live = (await store.setsuItems(date)).filter(
    (i) =>
      i.variant === variant && !["stopped", "held_manual"].includes(i.state),
  );
  const retry = [];
  for (const item of live) {
    const job = await store.jobForDraft(item.draft_id);
    if (retryable(item, job)) retry.push(item);
    else
      return {
        already: {
          already: true,
          reason: `同じ日の setsu_kiryoku_short（版 ${variant}）が既にある（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）。作らなかった`,
          status: setsuStatusOf(item, job),
        },
      };
  }
  if (finalKey) {
    for (const item of await store.finalItems(finalKey)) {
      if (["stopped", "held_manual"].includes(item.state)) continue;
      if (retry.some((r) => r.id === item.id)) continue;
      const job = await store.jobForDraft(item.draft_id);
      if (!retryable(item, job))
        return {
          reasons: [
            `同じ優勝戦（${finalKey}）の setsu_kiryoku_short を既に出した（${item.race_id}・item ${item.state}・job ${job?.state ?? "なし"}）`,
          ],
        };
    }
  }
  return { retry };
}

/** 下書きと item を作り、自動の承認で送る予定に入れ、Slack に知らせる（書く段） */
async function writeShort(ctx) {
  const {
    store,
    notify,
    bundle,
    bytes,
    venueCode,
    setsuId,
    itemVariant,
    when,
    observedAt,
    revision,
    publicUrl,
    control,
    auto,
    now,
  } = ctx;
  const videoPath = `setsu-kiryoku-short/${bundle.date}/${venueCode}/${revision}.mp4`;
  await store.saveFile(videoPath, bytes);
  const checkedAt = now.toISOString();
  const draft = await store.insertDraft(
    draftRow(bundle, {
      revision,
      videoPath,
      when,
      observedAt,
      venueCode,
      publicUrl,
    }),
  );
  let item;
  try {
    item = await store.insertItem(
      itemRow({
        setsuId,
        variant: itemVariant,
        draftId: draft.id,
        when,
        state: "notified",
        checkedAt,
      }),
    );
  } catch (error) {
    // 同じ日・同じ版に並行して入れた束が先に一意の索引（201 の setsu_day）に入った等。下書きを残すと個別承認で送れてしまう
    await blockDraft(store, draft, "item を作れない");
    throw error;
  }
  const out = {
    setsu_id: setsuId,
    variant: itemVariant,
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
    `SNS 節の機力（Shorts） ${setsuId}「${bundle.youtube.title}」\n${sentLine(out, when, control)}\n止めるには: ${STOP_SQL}`,
  ).catch((error) => console.error(`Slack に通知できません: ${error.message}`));
  return { ...out, revision, when };
}

// 束・setsu_id・動画の検査。通れば { name, bytes }、通らなければ { reasons }
async function checkInput({ bundle, folder, readBytes, riskRules, setsuId }) {
  const reasons = checkShortBundle(bundle, riskRules);
  if (reasons.length) return { reasons };
  if (!parseSetsuId(setsuId)) return { reasons: ["setsu_id が作れない"] };
  const name = videoNameOf(bundle);
  const video = await readShortVideo(readBytes, folder, name);
  if (video.reasons.length) return { reasons: video.reasons };
  return { name, bytes: video.bytes };
}

// DB の今の状態の検査（二重送信・締切の照合・日の上限とクォータ）。{ already }・{ reasons}・通れば { retry }
async function checkStoreState(
  store,
  { bundle, venueCode, itemVariant, sendControl, simulated, realNow, when },
) {
  // 同じ日・同じ版に生きている・送った item があれば何も作らず、今の状態を返す（DB の一意の索引でも止まる、201）
  const live = await liveOf(store, {
    date: bundle.date,
    variant: itemVariant,
    finalKey: finalKeyOf(bundle, venueCode),
  });
  if (live.already || live.reasons) return live;
  const deadline = await deadlineReasons(store, bundle, venueCode);
  if (deadline.length) return { reasons: deadline };
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

// 時計（dry-run の見本の束なら進めた時計）と、束の会場・setsu_id
function clockAndIds(bundle, realNow, dryRun) {
  const simulated = dryRun ? dryRunClock(bundle, realNow) : null;
  const venueCode = venueCodeOf(bundle?.venue);
  const setsuId =
    venueCode && /^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? "")
      ? setsuIdOf(bundle.date, venueCode)
      : null;
  return { simulated, now: simulated ?? realNow, venueCode, setsuId };
}

const extraOf = (itemVariant, simulated) => ({
  variant: itemVariant,
  ...(simulated ? { simulated_now: simulated.toISOString() } : {}),
});

// 検査で拒否したときの返り値（書く許可があれば Slack にも知らせる）
const rejecter =
  ({ notify, writes, setsuId, extra }) =>
  async (reasons) => {
    if (writes)
      await notify(
        `SNS 節の機力（Shorts） ${setsuId ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
      ).catch((error) =>
        console.error(`Slack に通知できません: ${error.message}`),
      );
    return { setsu_id: setsuId, reasons, ...extra };
  };

const revisionOf = (bundle, bytes) =>
  createHash("sha256")
    .update(JSON.stringify(bundle))
    .update(bytes)
    .digest("hex")
    .slice(0, 32);

/**
 * 受け取って送る予定に入れる。deps は DB・Storage・Slack（テストで差し替える）。
 * 返り値: { reasons }（不合格）・{ dryRun, disabled }（書かなかった）・{ already }・{ setsu_id, draft_id, item_id, job_id, send_at, ... }
 */
export async function pushSetsuKiryokuShort(
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
  const { simulated, now, venueCode, setsuId } = clockAndIds(bundle, realNow, dryRun);
  const controls = await store.controls();
  // 列が無い（193 が未適用）・行が無いときも off（fail-closed）
  const enabled = controls.youtube?.setsu_kiryoku_short_enabled === true;
  const writes = enabled && !dryRun;
  // item の版（border・main）。同じ日・同じ会場の border と節の機力は setsu_id が同じなので、結果には版も出す（201）
  const itemVariant = setsuItemVariantOf(bundle?.variant);
  const extra = extraOf(itemVariant, simulated);
  const reject = rejecter({ notify, writes, setsuId, extra });
  const input = await checkInput({ bundle, folder, readBytes, riskRules, setsuId });
  if (input.reasons) return reject(input.reasons);
  const { name, bytes } = input;
  const plan = await planTiming(store, bundle, now, {
    observedAt: bundle.source_observed_at ?? now.toISOString(),
  });
  if (plan.reasons) return reject(plan.reasons);
  const { sendControl, when, observedAt } = plan;
  const state = await checkStoreState(store, {
    bundle,
    venueCode,
    itemVariant,
    sendControl,
    simulated,
    realNow,
    when,
  });
  if (state.already) return { setsu_id: setsuId, ...state.already, ...extra };
  if (state.reasons) return reject(state.reasons);
  const revision = revisionOf(bundle, bytes);
  const publicUrl = descriptionLink(bundle.youtube.description, venueCode).url;
  const control = controls.youtube;
  const auto = isAutoMode(control);
  const skipped = unwrittenResult({
    setsuId,
    writes,
    auto,
    dryRun,
    enabled,
    revision,
    when,
    publicUrl,
    name,
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
    venueCode,
    setsuId,
    itemVariant,
    when,
    observedAt,
    revision,
    publicUrl,
    control,
    auto,
    now,
  });
}

/** その日の状態（hq の記録用）。生きている item（無ければ最新）と job。item が無ければ null。variant（border・main）を渡せばその版だけ */
export async function setsuStatus(date, { store, variant = null }) {
  const items = (await store.setsuItems(date)).filter(
    (i) => variant == null || i.variant === variant,
  );
  const item =
    items.find((i) => !["stopped", "held_manual"].includes(i.state)) ??
    items[0];
  if (!item) return null;
  return setsuStatusOf(item, await store.jobForDraft(item.draft_id));
}

/** 送り終わる（posted・held 等）か期限＋90秒まで待つ */
export async function waitForSend({
  store,
  draftId,
  expiresAt,
  now = () => new Date(),
  sleep,
}) {
  const until = Date.parse(expiresAt) + WAIT_AFTER_EXPIRES_SEC * 1000;
  for (;;) {
    const job = await store.jobForDraft(draftId);
    if (DONE_STATES.includes(job?.state) || now().getTime() >= until)
      return setsuStatusOf(null, job);
    await sleep(WAIT_POLL_SEC);
  }
}
