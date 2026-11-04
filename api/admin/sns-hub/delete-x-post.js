/**
 * X の投稿を消す（BOA-1279）。POST {targets:[{job_id, tweet_id}], reason}。X の鍵は送る口と同じ所（Vercel の環境変数と
 * sns_oauth_tokens）から取り、手元・hq には渡さない。呼ぶのは scripts/sns/delete-x-post.js --apply（Basic 認証）。
 * 消す相手は送信の記録にある X の投稿だけで、ID を明示で並べたときだけ（条件で一括に消さない）。中身は api/_lib/snsXDelete.js
 * nodejs・300秒（鍵の refresh の待ちが最大120秒、X の呼び出しが1回30秒。send-probe と同じ）
 */
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { isConfigured, jsonResponse } from "../../_lib/snsHubHelpers.js";
import {
  createPostgrestTokenDb,
  getXAccessToken,
} from "../../_lib/snsTokenStore.js";
import { createXApiAdapter } from "../../_lib/xApiAdapter.js";
import { db } from "../../_lib/snsXSendStore.js";
import {
  deleteReasonIssue,
  deleteTargetsIssue,
  runDeleteXPosts,
} from "../../_lib/snsXDelete.js";

export const config = { runtime: "nodejs", maxDuration: 300 };

// DB の拒否は RAISE の文（delete_job_mismatch 等）を見せる。details は出さない
async function rest(path, options) {
  try {
    return await db(path, options);
  } catch (error) {
    const code = error.cause?.message;
    throw new Error(
      code ? `${error.message}: ${code.slice(0, 80)}` : error.message,
    );
  }
}

export const restDeleteStore = {
  async readJob(id) {
    return (
      (
        await rest(`sns_x_send_jobs?id=eq.${encodeURIComponent(id)}&select=*`)
      )[0] ?? null
    );
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
    const issue =
      deleteTargetsIssue(body?.targets) ?? deleteReasonIssue(body?.reason);
    if (issue) return jsonResponse({ error: issue }, 400);
    // 落ちた1件は results に理由が入り、済んだ分も返る（502）
    const result = await runDeleteXPosts(
      { targets: body.targets, reason: body.reason },
      { store, getX },
    );
    const response = jsonResponse({ data: result }, result.ok ? 200 : 502);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };
}

const handler = createDeleteHandler();
export { handler as POST };
