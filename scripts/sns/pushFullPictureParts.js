/**
 * 全貌動画の取り込み（push-full-picture.js）の pushFullPicture から移した塊: 動画・サムネイルの読み、受け付けの検査、版、チャネルの決め方、
 * 保存、下書き・item の作成、自動承認、Slack の文。元の順（await・書き込み・理由の並び）のまま、名前のある関数にした。
 */
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import {
  createXSnapshot,
  YOUTUBE_MEDIA_MAX_BYTES,
} from "../../api/_lib/snsXSend.js";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";
import { checkXSlot, SLOT_KINDS } from "../lib/snsXSlots.js";
import {
  FILES,
  FULL_PICTURE_FORMAT,
  LATEST_BEFORE_MIN,
  MAX_BYTES,
  SHORTS_LATEST_BEFORE_MIN,
  bakedDeadlineReasons,
  channelsOf,
  dbChannel,
  jstTime,
  minutesBefore,
  schedule,
  sendAtOf,
  thumbnailKind,
  thumbnailNameOk,
  wantsX,
  withShorts,
} from "../lib/sns/fullPictureShape.js";

export const THUMBNAIL_MAX_BYTES = YOUTUBE_MEDIA_MAX_BYTES;
const STOP_SQL =
  "UPDATE public.sns_x_send_control SET paused = true WHERE id = true;";
const SHORTS_MANUAL_NOTE =
  "。ただし Shorts は個別承認では送れない（完全版の URL が入らない）。完全版を送った後に作り直す";

/** 検査で拒否したときの返し（dry-run でなければ Slack に知らせる）。返り値: reasons を受けて { reasons } を返す関数 */
export const rejecter =
  ({ bundle, notify, dryRun }) =>
  async (reasons) => {
    if (!dryRun) {
      try {
        await notify(
          `SNS 全貌動画 ${bundle?.race_id ?? "不明"} を検査で拒否した\n${reasons.join("\n")}`,
        );
      } catch (error) {
        console.error(`Slack に通知できません: ${error.message}`);
      }
    }
    return { reasons };
  };

/** チャネルごとの動画を読み、大きさを見る。返り値: { files, reasons } */
async function readChannelFiles(folder, bundle, readBytes) {
  const reasons = [];
  const files = {};
  for (const channel of channelsOf(bundle)) {
    const name = FILES[channel];
    try {
      files[channel] = await readBytes(path.join(folder, name));
      if (
        !files[channel].byteLength ||
        files[channel].byteLength > MAX_BYTES[channel]
      )
        reasons.push(
          `${name} の大きさが不正（${files[channel].byteLength} バイト）`,
        );
    } catch {
      reasons.push(`${name} が無い`);
    }
  }
  return { files, reasons };
}

/** 完全版のサムネイル（BOA-1172）。返り値: { thumbnail, reasons } */
async function readThumbnail(folder, bundle, readBytes) {
  const reasons = [];
  const thumbName = bundle?.youtube_full?.thumbnail;
  let thumbnail = null;
  if (thumbName !== undefined && thumbnailNameOk(thumbName)) {
    try {
      const bytes = await readBytes(path.join(folder, thumbName));
      const kind = thumbnailKind(bytes);
      if (!bytes.byteLength || bytes.byteLength > THUMBNAIL_MAX_BYTES)
        reasons.push(
          `${thumbName} の大きさが不正（${bytes.byteLength} バイト）`,
        );
      else if (!kind) reasons.push(`${thumbName} が PNG でも JPEG でもない`);
      else thumbnail = { bytes, ...kind };
    } catch {
      reasons.push(`${thumbName} が無い`);
    }
  }
  return { thumbnail, reasons };
}

/** 動画とサムネイルを読む。欄があるのに画像が無い・不正なら、作り手の不具合なので束ごと拒否する（黙って外さない）。返り値: { files, thumbnail, reasons } */
export async function readMedia(folder, bundle, readBytes) {
  const channelFiles = await readChannelFiles(folder, bundle, readBytes);
  const thumb = await readThumbnail(folder, bundle, readBytes);
  return {
    files: channelFiles.files,
    thumbnail: thumb.thumbnail,
    reasons: [...channelFiles.reasons, ...thumb.reasons],
  };
}

/** 受け付けの検査（レースの有無・中止・焼き込みの締切・時刻）。返り値: { reasons } か { deadlineAt, when } */
export async function preflight({ store, bundle, now }) {
  const race = await store.race(bundle.race_id);
  const deadlineAt = race && deadlineIso(race);
  if (!deadlineAt) return { reasons: ["レースが見つからない"] };
  if (race.cancellation_status != null) return { reasons: ["レースが中止"] };
  // 締切が変わる前の材料で作った束は、差し替えでも初回でも通さない（送る直前の検査の deadline_changed は push の時の締切と比べるので、文の時刻のずれを見ない）
  const stale = bakedDeadlineReasons(bundle, deadlineAt);
  if (stale.length) return { reasons: stale };
  const when = schedule(deadlineAt, now);
  if (now.getTime() >= Date.parse(when.latest))
    return { reasons: [`締切の${LATEST_BEFORE_MIN}分前を過ぎた`] };
  return { deadlineAt, when };
}

/** 束の版（先頭32字の sha256）。受け取った動画を全部入れる（shorts.mp4 だけを直して入れ直しても、前の版の承認と同じ path を上書きしない） */
export function revisionOf(bundle, files, thumbnail) {
  const hash = createHash("sha256").update(JSON.stringify(bundle));
  for (const channel of channelsOf(bundle)) hash.update(files[channel]);
  // サムネイルは動画の後に足す（欄の無い束の式は変えない）
  if (thumbnail) hash.update(thumbnail.bytes);
  return hash.digest("hex").slice(0, 32);
}

/** 作るチャネルを決める。返り値: { shortsLate, xSlot, channels } */
export async function planChannels({ store, bundle, plan, deadlineAt, now }) {
  // Shorts は、期限までに完全版の公開を待てる時刻に届いたときだけ作る
  const shortsLate =
    withShorts(bundle) &&
    now.getTime() >=
      Date.parse(minutesBefore(deadlineAt, SHORTS_LATEST_BEFORE_MIN));
  // X の日の枠の全貌の取り置き（182、docs/design/x-daily-slots/plan.md）。入らないと分かったら X だけ作らない
  // （claim で止まる job を作ると期限まで Slack が鳴る）。182 の前・読めないときは今のまま作る（claim が正）。X を作らない bundle では見ない
  // 差し替えるときは前の X の下書きの job を数えない（差し替えで hold にするので、二重に数えて X を落とさない）
  const xSlot =
    store.xSlotRoom && wantsX(bundle)
      ? await checkXSlot(
          store.xSlotRoom,
          SLOT_KINDS.fullPicture,
          1,
          plan.items.find((i) => i.channel === "x")?.draft_id ?? null,
        )
      : null;
  const channels = channelsOf(bundle).filter(
    (c) => (c !== "shorts" || !shortsLate) && (c !== "x" || !xSlot?.blocked),
  );
  return { shortsLate, xSlot, channels };
}

/** 動画（とサムネイル）を Storage に上げ、チャネルごとの path を返す */
export async function saveMedia({
  store,
  bundle,
  revision,
  channels,
  files,
  thumbnail,
}) {
  const paths = Object.fromEntries(
    channels.map((c) => [
      c,
      `full-picture/${bundle.race_id}/${revision}/${FILES[c]}`,
    ]),
  );
  for (const channel of channels)
    await store.saveFile(paths[channel], files[channel]);
  if (thumbnail) {
    paths.thumbnail = `full-picture/${bundle.race_id}/${revision}/thumb-full.${thumbnail.ext}`;
    await store.saveFile(
      paths.thumbnail,
      thumbnail.bytes,
      thumbnail.contentType,
    );
  }
  return paths;
}

/** 自動送信の item の行 */
function itemRowOf({ bundle, channel, draft, when, observedAt, auto }) {
  return {
    kind: FULL_PICTURE_FORMAT,
    draft_id: draft.id,
    channel: dbChannel(channel),
    ...(channel === "shorts" ? { variant: "shorts" } : {}),
    race_id: bundle.race_id,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
    state: auto ? "notified" : "manual",
    checks: {
      passed: true,
      review: bundle.review,
      machine: bundle.qa.machine,
      checked_at: observedAt,
    },
    // 止めるリンクは作らない（オーナー決定）。153 の CHECK が notified に要求するので、使わない乱数のハッシュを入れる
    ...(auto
      ? {
          notified_at: observedAt,
          stop_token_hash: randomBytes(32).toString("hex"),
        }
      : {}),
  };
}

/** 1チャネルの下書きと item を作る。Shorts の書き込みが落ちたときだけ { shortsError } を返す（X・完全版は投げる） */
async function insertChannel({ store, row, ...itemArgs }) {
  let draft;
  try {
    draft = await store.insertDraft(row);
    const item = await store.insertItem(itemRowOf({ ...itemArgs, draft }));
    return { draft, item };
  } catch (error) {
    // Shorts の書き込み（172 が未適用・一意の索引に当たる等）が落ちても、X・完全版は送る（X は Shorts と独立。x-channel の P1）
    if (itemArgs.channel !== "shorts") throw error;
    return {
      shortsError: `${error.message}${draft ? `（下書き ${draft.id} は承認されないまま残る）` : ""}`,
    };
  }
}

/** 下書きと item を全部入れる（承認は後。途中の item で落ちたとき、先に承認した分だけが送られて残らないように）。返り値: { out, made, shortsError } */
export async function createDraftsAndItems({
  store,
  bundle,
  channels,
  rows,
  controls,
  when,
  observedAt,
}) {
  const out = {};
  const made = {};
  let shortsError = null;
  for (const channel of channels) {
    const control = controls[dbChannel(channel)];
    const auto = control?.mode === "auto" && control?.auto_approver_id;
    const r = await insertChannel({
      store,
      row: rows[channel],
      bundle,
      channel,
      when,
      observedAt,
      auto,
    });
    if (r.shortsError !== undefined) {
      shortsError = r.shortsError;
      continue;
    }
    const { draft, item } = r;
    made[channel] = { draft, item, control, auto: Boolean(auto) };
    out[channel] = {
      draft_id: draft.id,
      item_id: item.id,
      auto: Boolean(auto),
    };
  }
  return { out, made, shortsError };
}

/** 1チャネルを自動で承認する。返り値: out[channel] に足す { job_id, send_at }。落ちたら item を manual に戻して { error } */
async function approveChannel({
  store,
  channel,
  made,
  out,
  paths,
  files,
  thumbnail,
  when,
}) {
  const { item, control } = made[channel];
  let { draft } = made[channel];
  try {
    if (channel === "shorts") {
      // 完全版が自動で承認されていなければ、Shorts も自動では承認しない（親の無い {full_url} は送る前の検査でも止まる）
      const parentJobId = out.youtube?.job_id;
      if (!parentJobId)
        throw new Error(
          "完全版が自動で承認されなかったので、Shorts も個別承認に回した",
        );
      draft = await store.setParentJob(draft, parentJobId);
    }
    // 承認の媒体は動画と、完全版ならサムネイル（createXSnapshot が cover_image_path を2つ目に読む）
    const media = {
      [paths[channel]]: files[channel],
      ...(channel === "youtube" && thumbnail
        ? { [paths.thumbnail]: thumbnail.bytes }
        : {}),
    };
    const snapshot = await createXSnapshot(draft, async (p) =>
      Object.hasOwn(media, p)
        ? media[p]
        : Promise.reject(new Error("媒体の path が違う")),
    );
    const job = await store.approve({
      p_draft_id: draft.id,
      p_approver_id: control.auto_approver_id,
      p_snapshot: snapshot,
      p_scheduled_at: sendAtOf(when, channel),
    });
    return { job_id: job?.id ?? null, send_at: sendAtOf(when, channel) };
  } catch (error) {
    await store
      .updateItem(item.id, "notified", { state: "manual" })
      .catch(() => {});
    return { error: error.message };
  }
}

/** 自動のチャネルを順に承認し、結果を out へ足す（完全版の job_id を Shorts の親に使うので、順に待つ） */
export async function approveMade({ made, out, ...rest }) {
  for (const channel of Object.keys(made)) {
    if (!made[channel].auto) continue;
    Object.assign(
      out[channel],
      await approveChannel({ channel, made, out, ...rest }),
    );
  }
}

const LABEL = {
  x: "x",
  youtube: "youtube（完全版）",
  shorts: "youtube（Shorts）",
};

/** チャネルごとの結果の行 */
function channelLines(out, controls) {
  return Object.entries(out).map(([channel, r]) =>
    r.send_at
      ? `${LABEL[channel]}: ${jstTime(r.send_at)} に自動で送る${channel === "shorts" ? "（完全版の公開の後。説明文に完全版の URL を入れる）" : ""}${controls[dbChannel(channel)]?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
      : r.error
        ? `${LABEL[channel]}: 自動の承認に失敗（個別承認に回した）: ${r.error}${channel === "shorts" ? SHORTS_MANUAL_NOTE : ""}`
        : `${LABEL[channel]}: 自動モードでないので個別承認の画面で承認する${channel === "shorts" ? SHORTS_MANUAL_NOTE : ""}`,
  );
}

/** Slack に知らせる文（止める SQL まで） */
export function noticeText({
  bundle,
  deadlineAt,
  out,
  controls,
  replacing,
  shortsError,
  xSlot,
  shortsLate,
}) {
  const lines = channelLines(out, controls);
  if (replacing)
    lines.unshift(
      `締切 ${replacing.from}→${replacing.to} で差し替えた（前の item ${replacing.items}件を stopped（superseded）、job ${replacing.held_jobs}件を held（superseded））`,
    );
  if (shortsError)
    lines.push(
      `youtube（Shorts）: 下書き・item を作れなかったので作らなかった（${out.x ? "X・" : ""}完全版は送る）: ${shortsError}`,
    );
  if (!wantsX(bundle)) lines.push("x: 束の channels に無いので作らない");
  if (xSlot?.blocked)
    lines.push(`x: 作らなかった（${xSlot.reason}）。YouTube は送る`);
  if (xSlot?.note) lines.push(`x: ${xSlot.note}`);
  if (shortsLate)
    lines.push(
      `youtube（Shorts）: 締切の${SHORTS_LATEST_BEFORE_MIN}分前を過ぎて届いたので作らなかった（完全版の公開を待つ時間が無い）`,
    );
  return `SNS 全貌動画 ${bundle.race_id}（締切 ${jstTime(deadlineAt)}）\n${lines.join("\n")}\n止めるには: ${STOP_SQL}`;
}
