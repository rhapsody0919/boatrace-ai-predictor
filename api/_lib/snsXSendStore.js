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
async function allRows(path) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await db(`${path}&limit=500&offset=${offset}`);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
export const xSendStore = {
  async readDraftDiff(id) {
    return db("rpc/read_sns_draft_diff", {
      method: "POST",
      body: JSON.stringify({ p_id: id }),
    });
  },
  async saveDraftDiff(id, revision, snapshot) {
    return db("rpc/save_sns_draft_diff", {
      method: "POST",
      body: JSON.stringify({
        p_id: id,
        p_revision: revision,
        p_snapshot: snapshot,
      }),
    });
  },
  async saveInspection(draftId, revision, engine, findings) {
    return db("rpc/save_sns_edit_inspection", {
      method: "POST",
      body: JSON.stringify({
        p_draft_id: draftId,
        p_revision: revision,
        p_engine: engine,
        p_findings: findings,
      }),
    });
  },
  async decideFinding(body, revision) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/decide_sns_edit_finding`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          p_draft_id: body.draftId,
          p_revision: revision,
          p_inspection_id: body.inspectionId,
          p_finding_id: body.findingId,
          p_approver_id: body.approverId,
          p_decision: body.decision,
        }),
      },
    );
    if (!response.ok) {
      // decide_sns_edit_findingのRAISE EXCEPTIONは固定の安全な文言のみ（SQLの定数、
      // 利用者入力は含まない）。承認者が「本人」以外（例: 自動承認）を選んだ場合の
      // メッセージだけを安全に通す。他は既存どおり汎用文言に倒す。
      const detail = await response.json().catch(() => null);
      if (detail?.message === "本人の判断が必要です") {
        throw new Error(detail.message);
      }
      throw new Error("X送信のDB操作に失敗しました");
    }
    return response.json();
  },
  async mobileGroups(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("対象日が不正です");
    const query = new URLSearchParams({
      platform: "in.(x,youtube)",
      language: "eq.ja",
      status: "neq.archived",
      content_group_id: "not.is.null",
      "source_data->>race_id": `like.${date}-*`,
      select: "content_group_id,race_id:source_data->>race_id",
      order: "id",
    });
    const groups = new Map();
    // 最大2000行＋上限検査1行、最大5要求。上限超過は部分一覧を返さない。
    for (let offset = 0; offset <= 2000; offset += 500) {
      const limit = offset === 2000 ? 1 : 500;
      const page = await db(
        `sns_drafts?${query}&limit=${limit}&offset=${offset}`,
      );
      if (offset === 2000 && page.length)
        throw new Error("今日の下書きが取得上限を超えました");
      for (const d of page)
        groups.set(d.content_group_id, {
          id: d.content_group_id,
          raceId: d.race_id,
        });
      if (page.length < limit) return [...groups.values()];
    }
    return [...groups.values()];
  },
  async mobileRace(id) {
    return db("rpc/read_sns_mobile_race", {
      method: "POST",
      body: JSON.stringify({ p_group_id: id }),
    });
  },
  async mobileApprove(
    id,
    approverId,
    revision,
    snapshot,
    scheduledAt,
    reviewSeconds,
  ) {
    return db("rpc/approve_sns_mobile_channel", {
      method: "POST",
      body: JSON.stringify({
        p_draft_id: id,
        p_approver_id: approverId,
        p_revision: revision,
        p_snapshot: snapshot,
        p_scheduled_at: scheduledAt,
        p_review_seconds: reviewSeconds,
      }),
    });
  },
  async parent(id) {
    const rows = await db(
      `sns_x_send_jobs?id=eq.${encodeURIComponent(id)}&state=eq.posted&select=external_post_id`,
    );
    if (!rows[0]?.external_post_id) throw new Error("親投稿が未確認です");
    return rows[0];
  },
  async sweep() {
    return db("rpc/sweep_sns_deadline_queue", { method: "POST", body: "{}" });
  },
  async queue() {
    const jobs = await allRows(
      "sns_x_send_jobs?select=id,draft_id,state,scheduled_at,expires_at,error_code,youtube_stage,external_post_id,snapshot&order=id",
    );
    const drafts = await allRows(
      "sns_drafts?platform=in.(x,youtube)&status=neq.archived&select=id,title,platform,status,scheduled_at,source_data&order=id",
    );
    return drafts.map((d) => {
      const j = jobs.find((job) => job.draft_id === d.id),
        q = j?.snapshot?.queue || d.source_data?.deadline_queue;
      return {
        id: j?.id || d.id,
        draft_id: d.id,
        title: d.title,
        channel: d.platform,
        state: j?.state || d.status,
        scheduled_at: j?.scheduled_at || d.scheduled_at,
        expires_at: j?.expires_at || q?.expires_at,
        deadline_at: q?.deadline_at,
        youtube_mode: q?.youtube_mode,
        youtube_stage: j?.youtube_stage,
        external_post_id: j?.external_post_id,
        error_code: j?.error_code,
      };
    });
  },
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
      `sns_x_send_jobs?draft_id=eq.${id}&select=id,state,scheduled_at,expires_at,attempts,error_code,external_post_url,posted_at`,
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

/** サーバー内でのみ利用。Storageパスから読み、外部URLを受け付けない。maxBytesは呼び出し側がチャネル（X/YouTube）に応じて指定する。 */
export async function loadXMedia(path, maxBytes = X_MEDIA_MAX_BYTES) {
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
      if (size > maxBytes) throw new Error("媒体の容量が上限を超えています");
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
