import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./snsHubHelpers.js";
import { X_MEDIA_MAX_BYTES } from "./snsXSend.js";

async function db(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!response.ok) throw new Error("X送信のDB操作に失敗しました");
  return response.json();
}
export const xSendStore = {
  async approve(id, approverId, snapshot, scheduledAt) {
    return db("rpc/approve_sns_x_send", {
      method: "POST",
      body: JSON.stringify({
        p_draft_id: id,
        p_approver_id: approverId,
        p_snapshot: snapshot,
        p_scheduled_at: scheduledAt,
      }),
    });
  },
  async transition(id, action, result = {}) {
    return db("rpc/transition_sns_x_send", {
      method: "POST",
      body: JSON.stringify({
        p_job_id: id,
        p_action: action,
        p_result: result,
      }),
    });
  },
  async status(id) {
    const jobs = await db(
      `sns_x_send_jobs?draft_id=eq.${id}&select=id,state,scheduled_at,attempts,error_code,external_post_url,posted_at`,
    );
    const controls = await db(
      "sns_x_send_control?id=eq.true&select=paused,budget_microusd,reserved_microusd",
    );
    return {
      job: jobs[0] || null,
      control: controls[0] || null,
      connected: false,
    };
  },
  async stop() {
    await db("sns_x_send_control?id=eq.true", {
      method: "PATCH",
      body: JSON.stringify({ paused: true }),
    });
  },
};

/** サーバー内でのみ利用。Storageパスから読み、外部URLを受け付けない。 */
export async function loadXMedia(path) {
  if (
    typeof path !== "string" ||
    path.startsWith("/") ||
    path.split("/").some((p) => !p || p === "." || p === "..") ||
    path.includes(":")
  ) {
    throw new Error("媒体パスが不正です");
  }
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/authenticated/sns-hub-media/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    },
  );
  if (!response.ok || !response.body) throw new Error("媒体を取得できません");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > X_MEDIA_MAX_BYTES)
        throw new Error("媒体の容量が上限を超えています");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
