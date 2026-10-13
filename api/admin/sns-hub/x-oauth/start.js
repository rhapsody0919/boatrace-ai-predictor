// X との連携の開始（ADR 0093、screens #10）。PKCE の verifier と state を HttpOnly の Cookie に入れ、X の許可画面へ送る。
import { requireAdminAuth } from "../../../_lib/adminAuth.js";
import { jsonResponse } from "../../../_lib/snsHubHelpers.js";
import {
  buildAuthorizeUrl,
  createPkce,
  X_CALLBACK_PATH,
} from "../../../_lib/snsTokenStore.js";
export const config = { runtime: "edge" };
export const X_OAUTH_COOKIE = "sns_x_oauth";
// X の Developer Console に登録したコールバック URL と完全一致させる（リクエストの Host からは作らない）
export const X_REDIRECT_URI = `https://www.boat-ai.jp${X_CALLBACK_PATH}`;

// テストから env・fetch・DB を差し替えるための本体。Vercel からは下の handler（依存は既定値）が呼ばれる
export async function handleStart(req, { env = process.env } = {}) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== "GET")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!env.X_OAUTH_CLIENT_ID || !env.X_OAUTH_CLIENT_SECRET)
    return jsonResponse({ error: "X の連携の鍵が未設定です" }, 503);
  const { verifier, challenge, state } = await createPkce();
  return new Response(null, {
    status: 302,
    headers: {
      Location: buildAuthorizeUrl({
        clientId: env.X_OAUTH_CLIENT_ID,
        redirectUri: X_REDIRECT_URI,
        state,
        challenge,
      }),
      "Set-Cookie": `${X_OAUTH_COOKIE}=${state}.${verifier}; Path=/api/admin/sns-hub/x-oauth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export default function handler(req) {
  return handleStart(req);
}
