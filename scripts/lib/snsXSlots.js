/**
 * X の日の枠の出し物ごとの取り置き（マイグレーション 182、docs/design/x-daily-slots/plan.md）を、取り込み（push-full-picture・
 * /today・push-finals-image・push-research-image）が予定に入れる前に確かめる。
 * 正は送り手の claim（transition_sns_send_139 が同じ sns_x_slot_room で数え、越えれば held/kind_slot_full）。ここは目安で、
 * claim で止まるのが分かっている job を作らないため（作ると期限まで runner が2分ごとに Slack に知らせる）。
 */

/** 取り置きを数えるときの出し物（sns_auto_send_items.kind と同じ値） */
export const SLOT_KINDS = {
  fullPicture: "full_picture",
  today: "digest",
  finals: "finals_image",
  research: "research_image",
};

/**
 * rpc sns_x_slot_room の答えから、止めるかを決める（純粋関数）。止めるのは取り置きで入らないと分かったときだけ。
 * 関数が無い（182 の適用前）・今日の基準が未確認・読めないときは止めない（claim が正）
 */
export function slotDecision(room) {
  // 今日の取り置きの合計（と他経路）が上限を越える日は、取り置きの中でも後から来た出し物が止まる。止めずに知らせる（note）
  const note = room?.over_reserved
    ? `X の日の枠の取り置きの合計 ${room.reserved_total}（他経路 ${room.external}）が上限 ${room.limit} を越えている（後から送る出し物が止まる。sns_x_kind_reserves か daily_limit_x を直す）`
    : undefined;
  if (room?.reason !== "kind_slot_full") return { blocked: false, room, note };
  return {
    blocked: true,
    room,
    note,
    reason: `X の日の枠に ${room.kind}（${room.need}本）が入らない（上限 ${room.limit}・この出し物の取り置き ${room.reserve}・使った/予定 ${room.booked}・他の出し物 ${room.others_booked}・他の取り置きの残り ${room.held_for_others}・他経路 ${room.external}）`,
  };
}

/** 182 の適用前（PostgREST が関数を知らない）か */
export const isMissingFunction = (error) =>
  /HTTP 404|PGRST202|Could not find the function/.test(error?.message ?? "");

/**
 * rpc を呼んで slotDecision を返す。call(kind, need, draftId) は rpc sns_x_slot_room（p_with_queued=true）の答えを返す関数。
 * draftId は作り直しのときの今の下書き（その下書きの前の版の job を数えない）。
 * 関数が無いときは { blocked:false, unavailable:true }。それ以外の失敗は止めずに { blocked:false, note } を返す
 * （読めないことで送る本数を減らさない。claim が正。呼ぶ側は note を Slack・結果に載せる）
 */
export async function checkXSlot(call, kind, need, draftId = null) {
  try {
    return slotDecision(await call(kind, need, draftId));
  } catch (error) {
    if (isMissingFunction(error)) return { blocked: false, unavailable: true };
    return {
      blocked: false,
      note: `X の日の枠を確かめられない（送り手の claim が確かめる）: ${error.message}`,
    };
  }
}

/** PostgREST の rpc の本文（取り込み用、queued も数える） */
export const slotRoomBody = (kind, need, draftId = null) => ({
  p_kind: kind,
  p_need: need,
  p_with_queued: true,
  p_job_id: null,
  p_draft_id: draftId,
});

/** REST の store に足す xSlotRoom（call は各 store の PostgREST の呼び出し。関数が無ければ HTTP 404 を投げ、checkXSlot が止めない側に倒す） */
export const xSlotRoomVia = (call) => (kind, need, draftId = null) =>
  call("rpc/sns_x_slot_room", {
    method: "POST",
    body: slotRoomBody(kind, need, draftId),
  });
