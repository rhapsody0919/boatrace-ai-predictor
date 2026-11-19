/**
 * YouTube Shorts の2本の口（push-setsu-kiryoku-short.js・push-upset-win-short.js）が共有する段
 * （動画の読み込み・日の上限の確認・前の item の置き換え・自動の承認・結果の1行の部品）。両方の本から移した（字は同じ、引数で値を受ける形にした）
 */
import path from "node:path";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  checkTiming,
  jstDate,
  jstTime,
  ptDate,
  schedule,
  SEND_DELAY_SEC,
  youtubeRoomReason,
} from "../lib/sns/shortSchedule.js";
import { checkVideo } from "./pushSetsuKiryokuShortChecks.js";

/** 動画を読んで検査する。返り値 { bytes, reasons }（reasons が空なら合格） */
export async function readShortVideo(readBytes, folder, name) {
  let bytes = null;
  try {
    bytes = await readBytes(path.join(folder, name));
  } catch (error) {
    // 無い（ENOENT）は checkVideo が「無い」と書く。それ以外（権限・I/O・code の無い失敗）は原因を残す
    if (error?.code !== "ENOENT")
      return {
        bytes,
        reasons: [
          `${name} を読めない（${error?.code ?? "code なし"}: ${error?.message ?? error}）`,
        ],
      };
  }
  return { bytes, reasons: checkVideo(name, bytes) };
}

/**
 * 送る時刻の計画と時刻の検査。通れば { sendControl, when, observedAt }、通らなければ { reasons }。
 * extra(when) はその口だけの時刻の検査の理由の配列（checkTiming の理由の後ろに足す）
 */
export async function planTiming(
  store,
  bundle,
  now,
  { observedAt, extra = () => [] },
) {
  const sendControl = await store.sendControl();
  if (!(sendControl?.expiry_minutes > 0))
    return { reasons: ["期限の分（sns_x_send_control.expiry_minutes）が読めない"] };
  const when = schedule(bundle, now, sendControl.expiry_minutes);
  const timing = [
    ...checkTiming(bundle, when, now, {
      observedAt,
      maxAgeSec: sendControl?.max_source_age_seconds,
    }),
    ...extra(when),
  ];
  if (timing.length) return { reasons: timing };
  return { sendControl, when, observedAt };
}

/**
 * 日の上限・クォータは DB の今の値で見る（dry-run の見本の束でも、時計を進めた日ではなく今日の数。基準の日が今日なので）。
 * 差し替える前の job（retry の item の draft）は数えない（差し替えで止めるので、二重に数えてこの1本を落とさない）。入らなければ理由の文、入れば null
 */
export async function youtubeRoomOf(
  store,
  { sendControl, retry, simulated, realNow, when },
) {
  const roomNow = realNow;
  const roomSendAt = simulated
    ? new Date(realNow.getTime() + SEND_DELAY_SEC * 1000).toISOString()
    : when.send_at;
  const [jobs, queued, quota, quotaUsed] = await Promise.all([
    store.jobsAttemptedOn(jstDate(roomNow)),
    store.queuedYoutubeJobs(roomNow),
    store.quotaControl(),
    store.quotaUsed(ptDate(new Date(roomSendAt))),
  ]);
  const replacing = new Set(retry.map((i) => i.draft_id));
  return youtubeRoomReason({
    sendControl,
    jobs,
    queued: queued.filter((j) => !replacing.has(j.draft_id)),
    quota,
    quotaUsed,
    now: roomNow,
    sendAt: roomSendAt,
  });
}

/** youtube の行が自動モード（mode=auto で承認者がいる）か。この型は自動の道だけで送る */
export const isAutoMode = (control) =>
  Boolean(control?.mode === "auto" && control?.auto_approver_id);

/** 前の item を止め、下書きを公開保留に戻す（148 のトリガーが承認を外し、queued・held の job を取り消す） */
export async function supersedeItems(store, retry, now) {
  for (const item of retry) {
    await store.updateItem(item.id, item.state, {
      state: "stopped",
      stopped_at: now.toISOString(),
      stopped_via: "superseded",
    });
    await store.updateDraft(item.draft_id, { publish_blocked: true });
  }
}

/** 下書きを公開保留にする（承認できない形に倒す）。item が入らなかった・承認に落ちた下書きを、管理画面の個別承認で送らないため */
export const blockDraft = (store, draft, why) =>
  store
    .updateDraft(draft.id, { publish_blocked: true })
    .catch((error) =>
      console.error(
        `下書き ${draft.id} を公開保留にできない（${why}）: ${error.message}`,
      ),
    );

/**
 * 自動の承認。返り値は out へ足す欄: 通れば { job_id, send_at }、落ちれば { error }（下書きを公開保留にし、item を held_manual にして次の呼び出しで作り直せるようにする。
 * 1日1本の索引から外れる。item を戻せなければ error にそれも足す）
 */
export async function approveAuto(
  store,
  { draft, item, videoPath, bytes, when, control },
) {
  try {
    const snapshot = await createXSnapshot(draft, async (p) =>
      p === videoPath ? bytes : Promise.reject(new Error("媒体の path が違う")),
    );
    const job = await store.approve({
      p_draft_id: draft.id,
      p_approver_id: control.auto_approver_id,
      p_snapshot: snapshot,
      p_scheduled_at: when.send_at,
    });
    if (!job?.id) throw new Error("job の id を受け取れない");
    return { job_id: job.id, send_at: when.send_at };
  } catch (error) {
    let message = error.message;
    await blockDraft(store, draft, "自動の承認に失敗");
    await store
      .updateItem(item.id, "notified", {
        state: "held_manual",
        held_reason: `自動の承認に失敗: ${error.message.split("\n")[0]}`,
      })
      .catch((updateError) => {
        // item が notified のまま job が無い。次の呼び出しで superseded にして作り直す
        console.error(
          `item ${item.id} を held_manual に戻せない: ${updateError.message}`,
        );
        message += `（item を戻せない: ${updateError.message}）`;
      });
    return { error: message };
  }
}

/** Slack の通知の中の1行 */
export const sentLine = (out, when, control) =>
  out.send_at
    ? `youtube（Shorts）: ${jstTime(when.send_at)} に送る（期限 ${jstTime(when.expires_at)}）${control?.dry_run !== false ? "（試運転中: claim の前で止まる）" : ""}`
    : `youtube（Shorts）: 自動の承認に失敗（送らない。下書きは公開保留）: ${out.error}`;

const EXIT_CODES = {
  posted: 0,
  dry_run_ok: 0,
  queued: 0,
  rejected: 1,
  disabled: 3,
  already_exists: 4,
  not_posted: 5,
};

/** 結果の outcome と exit の番号。waited は待ったか（--no-wait や試運転なら false） */
export function outcomeOf(result, status, waited) {
  const outcome = resultOutcome(result, status, waited);
  return { outcome, code: EXIT_CODES[outcome] };
}

function resultOutcome(result, status, waited) {
  if (result.reasons?.length) return "rejected";
  if (result.already) return "already_exists";
  if (result.disabled) return "disabled";
  if (result.dryRun) return "dry_run_ok";
  if (status?.job_state === "posted") return "posted";
  return result.job_id && !waited ? "queued" : "not_posted";
}

/** obj の欄を取り出す（無ければ null）。pairs は欄の名前か [出す名前, 元の名前]。item・job から状態の形を作る部品 */
export const pickOrNull = (obj, pairs) =>
  Object.fromEntries(
    pairs.map((k) => {
      const [to, from] = Array.isArray(k) ? k : [k, k];
      return [to, obj?.[from] ?? null];
    }),
  );

/** 送らなかった理由の文（承認に落ちた・自動モードでない）。該当しなければ null */
const notPostedReason = (result, outcome) => {
  if (outcome !== "not_posted" || result.job_id) return null;
  return result.error
    ? `自動の承認に失敗したので job を作らなかった: ${result.error}`
    : "自動モードでないので job を作らなかった";
};

/** 結果の1行の共通の欄（job_id から reason まで。disabledText は許可が off のときの文） */
export function resultFields(result, status, outcome, disabledText) {
  const s = status ?? result.status ?? null;
  return {
    job_id: s?.job_id ?? result.job_id ?? null,
    ...pickOrNull(s, ["job_state", "video_id", "video_url", "posted_at"]),
    error_code: s?.error_code ?? result.error ?? null,
    reason:
      result.reasons?.join(" / ") ??
      result.reason ??
      (result.disabled ? disabledText : notPostedReason(result, outcome)),
  };
}
