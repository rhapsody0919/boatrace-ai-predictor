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
  // RETURNS void の RPC（sweep_sns_deadline_queue 等）は本文が空で返る。json() にすると
  // "Unexpected end of JSON input" で落ち、送信の cron が毎回失敗する（2026-10-14、L1 で sns_send を live にした後に304回連続）
  const text = await response.text();
  return text ? JSON.parse(text) : null;
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
      "sns_x_send_jobs?select=id,draft_id,state,scheduled_at,expires_at,error_code,posted_at,youtube_stage,external_post_id,snapshot&order=id",
    );
    const drafts = await allRows(
      "sns_drafts?platform=in.(x,youtube)&select=id,title,platform,format,status,scheduled_at,posted_at,source_data&order=id",
    );
    const jobsByDraft = new Map(jobs.map((job) => [job.draft_id, job]));
    const observations = await allRows(
      "sns_metric_observations?select=id,draft_id,window,source,metric_name,metric_value,missing_reason,observed_at,data_through,period_end,definition&source=neq.mock&order=id",
    );
    const byDraft = new Map();
    for (const observation of observations) {
      if (!byDraft.has(observation.draft_id))
        byDraft.set(observation.draft_id, []);
      byDraft.get(observation.draft_id).push(observation);
    }
    return drafts
      .filter(
        (d) =>
          d.status !== "archived" || jobsByDraft.get(d.id)?.state === "posted",
      )
      .map((d) => {
        const j = jobsByDraft.get(d.id),
          q = j?.snapshot?.queue || d.source_data?.deadline_queue;
        return {
          id: j?.id || d.id,
          draft_id: d.id,
          title: d.title,
          channel: d.platform,
          format: d.format,
          race_id: d.source_data?.race_id,
          grade: d.source_data?.grade,
          state: j?.state || d.status,
          posted_at: j?.posted_at || d.posted_at,
          observations: byDraft.get(d.id) || [],
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
  /** 自動送信ページの「いまの状態」。チャネルごとのモード・試運転と、全体の停止（読み取りだけ） */
  async sendControl() {
    const [x] = await db("sns_x_send_control?id=eq.true&select=paused");
    const channels = await db(
      "sns_auto_send_control?select=channel,mode,dry_run&order=channel",
    );
    return { paused: Boolean(x?.paused), channels };
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
