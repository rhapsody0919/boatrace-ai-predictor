/**
 * X の投稿を消す（BOA-1279）。POST {targets:[{job_id, tweet_id}], reason}。X の鍵は送る口と同じ所（Vercel の環境変数と
 * sns_oauth_tokens）から取り、手元・hq には渡さない。呼ぶのは scripts/sns/delete-x-post.js --apply（Basic 認証）。
 * 消す相手は送信の記録にある X の投稿だけで、ID を明示で並べたときだけ（条件で一括に消さない）。中身は api/_lib/snsXDelete.js
 */
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import {
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
  isConfigured,
  jsonResponse,
} from "../../_lib/snsHubHelpers.js";
import {
  createPostgrestTokenDb,
  getXAccessToken,
} from "../../_lib/snsTokenStore.js";
import { createXApiAdapter } from "../../_lib/xApiAdapter.js";
import { runDeleteXPosts, UUID_RE } from "../../_lib/snsXDelete.js";

export const config = { runtime: "edge" };

async function rest(path, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    // PostgREST の code・message だけ（RAISE の文 delete_job_mismatch 等）。details は出さない
    throw new Error(
      `DB の操作に失敗: HTTP ${response.status}${typeof body?.message === "string" ? ` ${body.message.slice(0, 80)}` : ""}`,
    );
  }
  return response.json();
}

export const restDeleteStore = {
  async readJob(id) {
    if (!UUID_RE.test(id)) return null;
    return (await rest(`sns_x_send_jobs?id=eq.${id}&select=*`))[0] ?? null;
  },
  markDeleted: (jobId, tweetId, reason) =>
    rest("rpc/mark_sns_x_post_deleted", {
      method: "POST",
      body: JSON.stringify({
        p_job_id: jobId,
        p_tweet_id: tweetId,
        p_reason: reason,
      }),
    }),
};

async function realX() {
  const { accessToken } = await getXAccessToken({
    db: createPostgrestTokenDb(),
    keyBase64: process.env.SNS_TOKEN_ENC_KEY,
    clientId: process.env.X_OAUTH_CLIENT_ID,
    clientSecret: process.env.X_OAUTH_CLIENT_SECRET,
  });
  return createXApiAdapter({ accessToken });
}

export function createDeleteHandler({
  store = restDeleteStore,
  getX = realX,
  configured = isConfigured,
} = {}) {
  return async function handler(req) {
    const denied = await requireAdminAuth(req);
    if (denied) return denied;
    if (req.method !== "POST")
      return jsonResponse({ error: "Method not allowed" }, 405);
    if (!configured()) return jsonResponse({ error: "DB未設定です" }, 503);
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "JSON が読めません" }, 400);
    }
    let result;
    try {
      result = await runDeleteXPosts(
        { targets: body?.targets, reason: body?.reason },
        { store, getX },
      );
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    const response = jsonResponse({ data: result }, result.ok ? 200 : 502);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

export default createDeleteHandler();
