// X との連携のコールバック（ADR 0093）。state を Cookie と照合し、コードをトークンに替えて暗号化して保存する。
// 結果は管理画面へ戻して表示する（?x=connected / ?x=error&reason=...）。トークンの値は応答に出さない。
import { requireAdminAuth } from "../../../_lib/adminAuth.js";
import { isConfigured } from "../../../_lib/snsHubHelpers.js";
import {
  createPostgrestTokenDb,
  encryptTokens,
  exchangeCode,
  fetchAccountId,
} from "../../../_lib/snsTokenStore.js";
import { X_OAUTH_COOKIE, X_REDIRECT_URI } from "./start.js";
export const config = { runtime: "edge" };

const back = (query) =>
  new Response(null, {
    status: 302,
    headers: {
      Location: `/admin/sns-hub?${query}`,
      "Set-Cookie": `${X_OAUTH_COOKIE}=; Path=/api/admin/sns-hub/x-oauth; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });

function readCookie(req) {
  const raw = (req.headers.get("cookie") || "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${X_OAUTH_COOKIE}=`));
  const [state, verifier] = (raw?.slice(X_OAUTH_COOKIE.length + 1) || "").split(
    ".",
  );
  return state && verifier ? { state, verifier } : null;
}

// テストから env・fetch・DB を差し替えるための本体。Vercel からは下の handler（依存は既定値）が呼ばれる
export async function handleCallback(
  req,
  {
    env = process.env,
    fetchImpl = fetch,
    db = createPostgrestTokenDb({ fetchImpl }),
    now = () => new Date(),
    configured = isConfigured(),
  } = {},
) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== "GET")
    return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  if (url.searchParams.get("error")) return back("x=error&reason=denied");
  const saved = readCookie(req);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!saved || !state || !code || state !== saved.state)
    return back("x=error&reason=state");
  if (
    !env.X_OAUTH_CLIENT_ID ||
    !env.X_OAUTH_CLIENT_SECRET ||
    !env.SNS_TOKEN_ENC_KEY ||
    !configured
  )
    return back("x=error&reason=config");
  try {
    const tokens = await exchangeCode({
      code,
      verifier: saved.verifier,
      redirectUri: X_REDIRECT_URI,
      clientId: env.X_OAUTH_CLIENT_ID,
      clientSecret: env.X_OAUTH_CLIENT_SECRET,
      fetchImpl,
    });
    const accountId = await fetchAccountId(tokens.access_token, fetchImpl);
    const sealed = await encryptTokens(
      {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
      },
      env.SNS_TOKEN_ENC_KEY,
    );
    await db.upsert({
      ...sealed,
      account_id: accountId,
      access_expires_at: new Date(
        now().getTime() + tokens.expires_in * 1000,
      ).toISOString(),
      refreshed_at: now().toISOString(),
    });
  } catch (error) {
    console.error(`X の連携に失敗しました: ${error.message}`);
    return back("x=error&reason=exchange");
  }
  return back("x=connected");
}

export default function handler(req) {
  return handleCallback(req);
}
