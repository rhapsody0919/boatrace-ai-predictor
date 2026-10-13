/**
 * X の OAuth 2.0（PKCE）のトークンの保存（ADR 0093、SQL154 の sns_oauth_tokens）。
 * - access token と refresh token を JSON にして AES-256-GCM で暗号化して保存する。鍵は SNS_TOKEN_ENC_KEY（32 バイト、base64）
 * - refresh token は使い切り。refresh は lock_until（90秒）と locked_by を条件付き UPDATE で取り、保存は WHERE locked_by=自分 にする
 * - Edge でも Node でも動くよう Web Crypto を使う
 */
import { SUPABASE_URL, SUPABASE_SERVICE_KEY } from "./snsHubHelpers.js";

export const X_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
export const X_TOKEN_URL = "https://api.x.com/2/oauth2/token";
export const X_ME_URL = "https://api.x.com/2/users/me";
// 投稿・返信・動画のアップロード・自分の投稿の指標の読み取り・refresh token の発行
export const X_SCOPES = [
  "tweet.read",
  "tweet.write",
  "users.read",
  "media.write",
  "offline.access",
];
export const X_CALLBACK_PATH = "/api/admin/sns-hub/x-oauth/callback";
export const REFRESH_MARGIN_MS = 5 * 60 * 1000;
export const LOCK_MS = 90 * 1000;
const KEY_VERSION = 1;
const TAG_BYTES = 16;

const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const toBase64Url = (bytes) =>
  toBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

async function importKey(keyBase64) {
  const raw = keyBase64 ? fromBase64(keyBase64) : null;
  if (!raw || raw.byteLength !== 32)
    throw new Error(
      "SNS_TOKEN_ENC_KEY が未設定か、32バイトの base64 ではありません",
    );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** {access_token, refresh_token} を暗号化し、DB の列（ciphertext・iv・auth_tag は base64）にして返す */
export async function encryptTokens(tokens, keyBase64) {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(tokens)),
    ),
  );
  // Web Crypto は認証タグを末尾に付けて返す。ADR 0093 どおり別の列に分ける
  return {
    ciphertext: toBase64(sealed.slice(0, -TAG_BYTES)),
    iv: toBase64(iv),
    auth_tag: toBase64(sealed.slice(-TAG_BYTES)),
    key_version: KEY_VERSION,
  };
}

export async function decryptTokens(row, keyBase64) {
  if (row.key_version !== KEY_VERSION)
    throw new Error(`未対応の鍵の版です（key_version=${row.key_version}）`);
  const key = await importKey(keyBase64);
  const body = fromBase64(row.ciphertext);
  const tag = fromBase64(row.auth_tag);
  const sealed = new Uint8Array(body.byteLength + tag.byteLength);
  sealed.set(body);
  sealed.set(tag, body.byteLength);
  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(row.iv) },
      key,
      sealed,
    );
  } catch {
    throw new Error(
      "X のトークンを復号できません（鍵が違うか、保存値が壊れています）",
    );
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/** PKCE の verifier と S256 の challenge、CSRF 用の state */
export async function createPkce() {
  const verifier = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  return {
    verifier,
    challenge: toBase64Url(digest),
    state: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
  };
}

export function buildAuthorizeUrl({ clientId, redirectUri, state, challenge }) {
  const url = new URL(X_AUTHORIZE_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: X_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** トークンのエンドポイント（confidential client は Basic 認証）。応答を {access_token, refresh_token, expires_in} にそろえる */
async function requestToken(params, { clientId, clientSecret, fetchImpl }) {
  const response = await fetchImpl(X_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ ...params, client_id: clientId }).toString(),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token || !body.refresh_token)
    throw new Error(
      `X のトークンを取得できません: HTTP ${response.status}${body.error ? ` ${body.error}` : ""}`,
    );
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    expires_in: Number(body.expires_in) || 7200,
    scope: body.scope ?? null,
  };
}

export function exchangeCode({ code, verifier, redirectUri, ...client }) {
  return requestToken(
    {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
    client,
  );
}

export function refreshTokens({ refreshToken, ...client }) {
  return requestToken(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    client,
  );
}

export async function fetchAccountId(accessToken, fetchImpl = fetch) {
  const response = await fetchImpl(X_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !/^[0-9]{1,19}$/.test(body?.data?.id ?? ""))
    throw new Error(`X のアカウントを確認できません: HTTP ${response.status}`);
  return body.data.id;
}

/** sns_oauth_tokens（provider='x'）の PostgREST の読み書き。条件付き UPDATE で行ロックの代わりにする */
export function createPostgrestTokenDb({
  url = SUPABASE_URL,
  key = SUPABASE_SERVICE_KEY,
  fetchImpl = fetch,
} = {}) {
  async function call(path, options = {}) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      ...options,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...options.headers,
      },
    });
    if (!response.ok)
      throw new Error(
        `X のトークンの DB 操作に失敗しました: HTTP ${response.status}`,
      );
    return response.json();
  }
  const base = "sns_oauth_tokens?provider=eq.x";
  return {
    async read() {
      return (await call(`${base}&select=*`))[0] ?? null;
    },
    async upsert(row) {
      await call("sns_oauth_tokens?on_conflict=provider", {
        method: "POST",
        headers: {
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify({
          provider: "x",
          ...row,
          lock_until: null,
          locked_by: null,
        }),
      });
    },
    async tryLock(lockId, now, until) {
      const free = encodeURIComponent(
        `(lock_until.is.null,lock_until.lt.${now.toISOString()})`,
      );
      return (
        (
          await call(`${base}&or=${free}`, {
            method: "PATCH",
            body: JSON.stringify({
              lock_until: until.toISOString(),
              locked_by: lockId,
            }),
          })
        ).length === 1
      );
    },
    async saveLocked(lockId, row) {
      return (
        (
          await call(`${base}&locked_by=eq.${lockId}`, {
            method: "PATCH",
            body: JSON.stringify({ ...row, lock_until: null, locked_by: null }),
          })
        ).length === 1
      );
    },
    async release(lockId) {
      await call(`${base}&locked_by=eq.${lockId}`, {
        method: "PATCH",
        body: JSON.stringify({ lock_until: null, locked_by: null }),
      });
    },
  };
}

/**
 * 有効な access token を返す。期限の5分前を過ぎていたら、行ロックを取って refresh する。
 * ロックを取れないときは待って読み直す（別の呼び出しが refresh 中）。
 * refresh に成功して保存に失敗したら refresh token を失うので、notify で「連携のやり直しが要る」と知らせる。
 */
export async function getXAccessToken({
  db,
  keyBase64,
  clientId,
  clientSecret,
  fetchImpl = fetch,
  notify = async () => {},
  now = () => new Date(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  waitMs = 3000,
  maxWaits = 40,
}) {
  for (let attempt = 0; attempt <= maxWaits; attempt++) {
    const row = await db.read();
    if (!row)
      throw new Error(
        "X と連携していません（管理画面の「X と連携する」から連携してください）",
      );
    const current = now();
    if (
      Date.parse(row.access_expires_at) - REFRESH_MARGIN_MS >
      current.getTime()
    )
      return {
        accessToken: (await decryptTokens(row, keyBase64)).access_token,
        accountId: row.account_id,
      };
    const lockId = crypto.randomUUID();
    if (
      !(await db.tryLock(
        lockId,
        current,
        new Date(current.getTime() + LOCK_MS),
      ))
    ) {
      await sleep(waitMs);
      continue;
    }
    let fresh;
    let locked;
    try {
      // ロックを取った後に読み直す（直前に別の呼び出しが更新していれば、その値を使う）
      locked = await db.read();
      if (
        Date.parse(locked.access_expires_at) - REFRESH_MARGIN_MS >
        now().getTime()
      ) {
        await db.release(lockId);
        return {
          accessToken: (await decryptTokens(locked, keyBase64)).access_token,
          accountId: locked.account_id,
        };
      }
      const { refresh_token } = await decryptTokens(locked, keyBase64);
      fresh = await refreshTokens({
        refreshToken: refresh_token,
        clientId,
        clientSecret,
        fetchImpl,
      });
    } catch (error) {
      await db.release(lockId).catch(() => {});
      await notify(
        `X のトークンを更新できません。送信を保留します: ${error.message}`,
      ).catch(() => {});
      throw error;
    }
    const sealed = await encryptTokens(
      { access_token: fresh.access_token, refresh_token: fresh.refresh_token },
      keyBase64,
    );
    const saved = await db
      .saveLocked(lockId, {
        ...sealed,
        access_expires_at: new Date(
          now().getTime() + fresh.expires_in * 1000,
        ).toISOString(),
        refreshed_at: now().toISOString(),
      })
      .catch(() => false);
    if (!saved) {
      await notify(
        "X のトークンを更新したが保存できなかった。X の連携のやり直しが要る（管理画面の「X と連携する」）",
      ).catch(() => {});
      throw new Error("X のトークンを保存できません（連携のやり直しが要る）");
    }
    return {
      accessToken: fresh.access_token,
      accountId: locked.account_id,
    };
  }
  throw new Error("X のトークンの更新を待ちきれませんでした");
}
