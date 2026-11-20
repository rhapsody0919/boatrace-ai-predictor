/**
 * SNS の自動送信の計画の DB 操作（PostgREST の読み書き）。snsAutoPlanRunner.js の createAutoPlanStore を移した（振る舞いは同じ）。
 */

/** PostgREST の呼び出し（service_role）。失敗は握りつぶさず投げる */
function createCall({ url, key, fetchImpl }) {
  return async function call(path, { method = "GET", body } = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        ...(body !== undefined
          ? {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }
          : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        `自動送信の計画の DB 操作に失敗: HTTP ${response.status} ${method} ${path.split("?")[0]}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

const one = (rows, what) => {
  if (rows?.length !== 1)
    throw new Error(`${what}（条件に合う行が無い。他の操作と競合した）`);
  return rows[0];
};
const inList = (ids) => `(${ids.map((id) => `"${id}"`).join(",")})`;

/** 今日のレースの素材と、それに付く races・stages・drafts・items を読む */
async function readTodaysBundles(call, today) {
  // 前日以前に入れた今日のレースの素材も拾う（3日前から）
  const since = new Date(
    Date.parse(`${today}T00:00:00+09:00`) - 3 * 86400000,
  ).toISOString();
  const all = await call(
    `sns_bundle_imports?schema_version=eq.${encodeURIComponent("ryujin-preview/1")}&created_at=gte.${encodeURIComponent(since)}&select=id,bundle,qa,created_at&order=created_at.desc&limit=500`,
  );
  const bundles = all.filter((b) =>
    String(b.bundle?.race_id ?? "").startsWith(`${today}-`),
  );
  if (!bundles.length)
    return { bundles, races: [], stages: [], drafts: [], items: [] };
  const raceIds = inList([...new Set(bundles.map((b) => b.bundle.race_id))]);
  const [races, stages, drafts, items] = await Promise.all([
    call(
      `races?race_id=in.${encodeURIComponent(raceIds)}&select=race_id,race_date,start_time,cancellation_status`,
    ),
    call(
      `race_conditions?race_id=in.${encodeURIComponent(raceIds)}&select=race_id,race_stage`,
    ),
    call(
      `sns_drafts?bundle_import_id=in.${encodeURIComponent(inList(bundles.map((b) => b.id)))}&select=id,bundle_import_id,platform,thread_index,status,title,caption_text,hashtags,video_storage_path,cover_image_path,source_data,publish_blocked,publication_hold_reasons,risk_flags,format,template_variant_id,language&limit=500`,
    ),
    call(
      `sns_auto_send_items?race_id=in.${encodeURIComponent(raceIds)}&select=*`,
    ),
  ]);
  return { bundles, races, stages, drafts, items };
}

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createAutoPlanStore({ url, key, fetchImpl = fetch }) {
  const call = createCall({ url, key, fetchImpl });
  return {
    rpc: (name) => call(`rpc/${name}`, { method: "POST", body: {} }),
    async controls() {
      const rows = await call(
        "sns_auto_send_control?select=channel,mode,dry_run,auto_approver_id",
      );
      return Object.fromEntries(rows.map((row) => [row.channel, row]));
    },
    todaysBundles: (today) => readTodaysBundles(call, today),
    async hasPostedFormat(format, variant) {
      if (!format || !variant) return false;
      const rows = await call(
        `sns_drafts?status=eq.posted&format=eq.${encodeURIComponent(format)}&source_data->>local_template_variant_id=eq.${encodeURIComponent(variant)}&select=id&limit=1`,
      );
      return rows.length > 0;
    },
    jobsFor: async (draftIds) =>
      draftIds.length
        ? call(
            `sns_x_send_jobs?draft_id=in.${encodeURIComponent(inList(draftIds))}&select=id,draft_id,state`,
          )
        : [],
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    async updateItem(id, fromState, patch) {
      return one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      );
    },
    // 承認の前の下書きだけを書く（承認・送信が始まった下書きは 148 のトリガーが拒否する。ここでも pending_review に限る）
    async updateDraft(id, patch) {
      return one(
        await call(`sns_drafts?id=eq.${id}&status=eq.pending_review`, {
          method: "PATCH",
          body: patch,
        }),
        `下書き ${id} を更新できない`,
      );
    },
  };
}
