/**
 * snsTodayPlannerDraft.js から移した、/today の自動の承認（item を notified にして承認者で承認、失敗なら戻す）。
 * 振る舞い・書く順は元のまま。
 */
import { randomBytes } from "node:crypto";
import { checkXSlot, SLOT_KINDS } from "./snsXSlots.js";
import { firstLine } from "./snsTodayPlannerParts.js";

const notifiedPatch = (checkedAt) => ({
  state: "notified",
  notified_at: checkedAt,
  // 止めるリンクは作らない（オーナー決定）。153 の CHECK が notified に要求するので、使わない乱数のハッシュを入れる
  stop_token_hash: randomBytes(32).toString("hex"),
});

async function approveParent(cx, draft) {
  const { store, control, when, imagePaths, shots } = cx;
  const bytes = new Map(imagePaths.map((p, i) => [p, shots[i]]));
  return store.approve({
    p_draft_id: draft.id,
    p_approver_id: control.auto_approver_id,
    p_snapshot: await cx.api.createXSnapshot(draft, async (p) => {
      if (!bytes.has(p)) throw new Error(`媒体が無い: ${p}`);
      return bytes.get(p);
    }),
    p_scheduled_at: when.scheduled_at,
  });
}

// 自動の承認の失敗で item を戻す。自動の承認者の job は item が notified でないと claim で止まる。返信の型は親も子も held_manual にする
// （manual に戻すと親だけが承認されてリンクの無い投稿が出うる。x-channel の審査 P2）。返信の無い型は今までどおり manual
async function rollbackAuto(store, { item, replyItem, message }) {
  let autoError = message;
  const back = replyItem
    ? {
        state: "held_manual",
        held_reason: `返信の型の自動の承認に失敗: ${firstLine(autoError)}`,
      }
    : { state: "manual" };
  // 戻せなかったら握りつぶさず、Slack の知らせ（autoError）に載せる
  const undo = (row) =>
    store.updateItem(row.id, row.state, back).catch((e) => {
      autoError += ` / item ${row.id} を戻せない: ${e.message}`;
    });
  await undo(item);
  if (replyItem && replyItem.state !== back.state) await undo(replyItem);
  return autoError;
}

/**
 * 自動（mode=auto、2026-10-18 オーナー決定: /today も承認なし）: item を notified にして自動送信の承認者で承認する。
 * 送る時刻は 7:00 と下書きを作った時刻の遅い方（veto_until と同じ）。確認用の作り直し（review）は自動にしない
 */
export async function autoApprove(cx, draft, rows) {
  const { store, control, when, checkedAt } = cx;
  let { item, replyItem, replyDraft } = rows;
  let slotNote = null;
  try {
    // X の日の枠の /today の取り置き（182、docs/design/x-daily-slots/plan.md）。返信の型は親と返信の2本。
    // 入らないと分かったら自動の承認をしない（下の失敗の道で item を戻す）。182 の前・読めないときは今のまま（claim が正）
    if (store.xSlotRoom) {
      // 作り直し（版が同じ）では前の版の job が queued のまま残るので、この下書きの job は数えない（system-architect の P2）
      const slot = await checkXSlot(
        store.xSlotRoom,
        SLOT_KINDS.today,
        replyItem ? 2 : 1,
        draft.id,
      );
      slotNote = slot.note ?? null;
      if (slot.blocked) throw new Error(slot.reason);
    }
    item = await store.updateItem(item.id, "manual", notifiedPatch(checkedAt));
    const parentJob = await approveParent(cx, draft);
    // 返信: 親の job を deadline_queue.parent_job_id に入れて（承認は queue の一致を照合する）公開保留を外してから承認する。
    // 送信の runner は親が posted の子だけを選び、claim も parent_not_posted で止める（153・158）
    if (replyItem) {
      if (!parentJob?.id) throw new Error("親の job の id を受け取れない");
      replyItem = await store.updateItem(
        replyItem.id,
        "manual",
        notifiedPatch(checkedAt),
      );
      replyDraft = await store.updateTodayDraft(replyDraft.id, {
        source_data: {
          ...replyDraft.source_data,
          deadline_queue: {
            ...replyDraft.source_data.deadline_queue,
            parent_job_id: parentJob.id,
          },
        },
        publish_blocked: false,
      });
      await store.approve({
        p_draft_id: replyDraft.id,
        p_approver_id: control.auto_approver_id,
        p_snapshot: await cx.api.createXSnapshot(replyDraft, async (p) => {
          throw new Error(`返信に媒体は無い: ${p}`);
        }),
        p_scheduled_at: when.scheduled_at,
      });
    }
  } catch (error) {
    const autoError = await rollbackAuto(store, {
      item,
      replyItem,
      message: error.message,
    });
    return { item, replyItem, replyDraft, slotNote, autoError };
  }
  return { item, replyItem, replyDraft, slotNote, autoError: null };
}
