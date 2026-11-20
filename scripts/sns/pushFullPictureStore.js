/**
 * 全貌動画の取り込み（push-full-picture.js）から移した PostgREST・Storage の読み書き（service_role）。createRestStore を
 * 呼び（call）・読み・書き・差し替えの小さな部品に割った。失敗は投げる。
 */
import { xSlotRoomVia } from "../lib/snsXSlots.js";

/** PostgREST の呼び（call）。失敗は投げる */
function createCall({ url, headers, fetchImpl }) {
  return async function call(p, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${p}`, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB 操作に失敗: HTTP ${response.status} ${method} ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return text ? JSON.parse(text) : null;
  };
}

const one = (rows, what) => {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error(what);
  return rows[0];
};

/** レースと自動送信の設定の読み */
function readParts(call) {
  return {
    race: async (raceId) =>
      (
        await call(
          `races?race_id=eq.${encodeURIComponent(raceId)}&select=race_id,race_date,start_time,cancellation_status`,
        )
      )[0] ?? null,
    controls: async () =>
      Object.fromEntries(
        (
          await call(
            "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
          )
        ).map((r) => [r.channel, r]),
      ),
  };
}

/** Storage への保存 */
function saveFilePart({ url, headers, fetchImpl }) {
  return {
    async saveFile(p, bytes, contentType = "video/mp4") {
      const response = await fetchImpl(
        `${url}/storage/v1/object/sns-hub-media/${p}`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": contentType,
            "x-upsert": "true",
          },
          body: bytes,
        },
      );
      if (!response.ok)
        throw new Error(`媒体を保存できない: HTTP ${response.status} ${p}`);
    },
  };
}

/** 下書き・item の作成と更新、承認 */
function writeParts(call) {
  return {
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    updateItem: async (id, fromState, patch) =>
      one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      ),
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
  };
}

/** 同じレースの生きた全貌の item（172 の一意の索引に当たるもの）と、その下書きの版・job（BOA-1201） */
function liveFullPictureOf(call) {
  return async function liveFullPicture(raceId) {
    const items = await call(
      `sns_auto_send_items?race_id=eq.${encodeURIComponent(raceId)}&kind=eq.full_picture&state=not.in.(stopped,held_manual)&select=id,draft_id,channel,variant,state,deadline_at`,
    );
    if (!items.length) return [];
    const ids = items.map((i) => i.draft_id).join(",");
    const [drafts, jobs] = await Promise.all([
      call(
        `sns_drafts?id=in.(${ids})&select=id,revision:source_data->full_picture->>revision`,
      ),
      call(
        `sns_x_send_jobs?draft_id=in.(${ids})&select=id,draft_id,state,attempts`,
      ),
    ]);
    return items.map((i) => ({
      ...i,
      revision: drafts.find((d) => d.id === i.draft_id)?.revision ?? null,
      jobs: jobs.filter((j) => j.draft_id === i.draft_id),
    }));
  };
}

/** 差し替え・枠・親の job */
function queueParts(call) {
  return {
    // 同じレースの生きた全貌の item（172 の一意の索引に当たるもの）と、その下書きの版・job（BOA-1201）
    liveFullPicture: liveFullPictureOf(call),
    // job を保留にする（transition_sns_x_send の hold。理由は英小文字と _ なら error_code に入る、139・189）
    holdJob: (jobId, reason) =>
      call("rpc/transition_sns_x_send", {
        method: "POST",
        body: { p_job_id: jobId, p_action: "hold", p_result: { reason } },
      }),
    // X の日の枠の取り置きの残り（182）
    xSlotRoom: xSlotRoomVia(call),
    // 下書きの deadline_queue に親（完全版の job）を入れる。承認の前に入れないと、承認の queue の照合に通らない
    setParentJob: async (draft, parentJobId) =>
      one(
        await call(`sns_drafts?id=eq.${draft.id}&status=eq.pending_review`, {
          method: "PATCH",
          body: {
            source_data: {
              ...draft.source_data,
              deadline_queue: {
                ...draft.source_data.deadline_queue,
                parent_job_id: parentJobId,
              },
            },
          },
        }),
        `下書き ${draft.id} に親の job を入れられない`,
      ),
  };
}

/** PostgREST・Storage の読み書き（service_role）。失敗は投げる */
export function createRestStore({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const call = createCall({ url, headers, fetchImpl });
  return {
    ...readParts(call),
    ...saveFilePart({ url, headers, fetchImpl }),
    ...writeParts(call),
    ...queueParts(call),
  };
}
