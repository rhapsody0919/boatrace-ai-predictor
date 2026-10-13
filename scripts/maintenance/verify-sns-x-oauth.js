// X の OAuth（PKCE）とトークンの暗号化保存（ADR 0093、sns-pdca-loop tasks 16）の再現テスト。外部接続なし（fetch はモック）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl,
  createPkce,
  createPostgrestTokenDb,
  decryptTokens,
  encryptTokens,
  getXAccessToken,
  X_TOKEN_URL,
} from "../../api/_lib/snsTokenStore.js";
import { handleStart } from "../../api/admin/sns-hub/x-oauth/start.js";
import { handleCallback } from "../../api/admin/sns-hub/x-oauth/callback.js";

const KEY = randomBytes(32).toString("base64");
const OTHER_KEY = randomBytes(32).toString("base64");
const TOKENS = {
  access_token: "access-secret-1",
  refresh_token: "refresh-secret-1",
};
process.env.SNS_HUB_BASIC_AUTH_USER = "owner";
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "pw";
const AUTH = `Basic ${Buffer.from("owner:pw").toString("base64")}`;
const ENV = {
  X_OAUTH_CLIENT_ID: "client-id",
  X_OAUTH_CLIENT_SECRET: "client-secret",
  SNS_TOKEN_ENC_KEY: KEY,
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("暗号化: 保存値に平文が無く、同じ鍵で元に戻り、鍵違い・改ざん・鍵の長さ違いは拒否する", async () => {
  const sealed = await encryptTokens(TOKENS, KEY);
  const stored = JSON.stringify(sealed);
  assert.ok(
    !stored.includes("access-secret") && !stored.includes("refresh-secret"),
  );
  assert.equal(Buffer.from(sealed.auth_tag, "base64").length, 16);
  assert.equal(Buffer.from(sealed.iv, "base64").length, 12);
  assert.deepEqual(await decryptTokens(sealed, KEY), TOKENS);
  await assert.rejects(decryptTokens(sealed, OTHER_KEY), /復号できません/);
  const tag = Buffer.from(sealed.auth_tag, "base64");
  tag[0] ^= 1;
  await assert.rejects(
    decryptTokens({ ...sealed, auth_tag: tag.toString("base64") }, KEY),
    /復号できません/,
  );
  await assert.rejects(
    encryptTokens(TOKENS, randomBytes(16).toString("base64")),
    /32バイト/,
  );
  await assert.rejects(encryptTokens(TOKENS, undefined), /未設定/);
  // 同じ値でも IV が毎回違う
  assert.notEqual((await encryptTokens(TOKENS, KEY)).iv, sealed.iv);
});

test("PKCE: challenge は verifier の SHA-256（base64url）、許可画面の URL は S256 と5つの scope", async () => {
  const { verifier, challenge, state } = await createPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    challenge,
    createHash("sha256").update(verifier).digest("base64url"),
  );
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "c",
      redirectUri: "https://www.boat-ai.jp/cb",
      state,
      challenge,
    }),
  );
  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("state"), state);
  assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), [
    "media.write",
    "offline.access",
    "tweet.read",
    "tweet.write",
    "users.read",
  ]);
});

test("連携の開始: 認証なしは401、鍵が無ければ503、あれば state と verifier を HttpOnly の Cookie に入れて X へ送る", async () => {
  const req = (headers = {}) =>
    new Request("https://www.boat-ai.jp/api/admin/sns-hub/x-oauth/start", {
      headers,
    });
  assert.equal((await handleStart(req(), { env: ENV })).status, 401);
  assert.equal(
    (await handleStart(req({ authorization: AUTH }), { env: {} })).status,
    503,
  );
  const res = await handleStart(req({ authorization: AUTH }), { env: ENV });
  assert.equal(res.status, 302);
  const location = new URL(res.headers.get("location"));
  const cookie = res.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /Path=\/api\/admin\/sns-hub\/x-oauth/);
  const [state, verifier] = cookie.split(";")[0].split("=")[1].split(".");
  assert.equal(location.searchParams.get("state"), state);
  assert.equal(
    location.searchParams.get("redirect_uri"),
    "https://www.boat-ai.jp/api/admin/sns-hub/x-oauth/callback",
  );
  assert.equal(
    location.searchParams.get("code_challenge"),
    createHash("sha256").update(verifier).digest("base64url"),
  );
  assert.ok(!location.toString().includes(verifier));
});

function callbackRequest({
  state = "s1",
  cookieState = "s1",
  code = "c1",
  error,
} = {}) {
  const url = new URL(
    "https://www.boat-ai.jp/api/admin/sns-hub/x-oauth/callback",
  );
  if (state) url.searchParams.set("state", state);
  if (code) url.searchParams.set("code", code);
  if (error) url.searchParams.set("error", error);
  return new Request(url, {
    headers: {
      authorization: AUTH,
      cookie: cookieState
        ? `other=1; sns_x_oauth=${cookieState}.verifier-1`
        : "",
    },
  });
}
function xMock({ tokenStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === X_TOKEN_URL)
      return tokenStatus === 200
        ? json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 7200,
          })
        : json({ error: "invalid_grant" }, tokenStatus);
    if (String(url).endsWith("/2/users/me"))
      return json({ data: { id: "1234567890" } });
    throw new Error("想定外の fetch: " + url);
  };
  return { calls, fetchImpl };
}

test("コールバック: state が Cookie と違う・Cookie が無い・拒否されたときはトークンに替えない", async () => {
  for (const [req, reason] of [
    [callbackRequest({ state: "other" }), "state"],
    [callbackRequest({ cookieState: null }), "state"],
    [callbackRequest({ error: "access_denied", code: null }), "denied"],
  ]) {
    const { calls, fetchImpl } = xMock();
    const upserts = [];
    const res = await handleCallback(req, {
      env: ENV,
      fetchImpl,
      db: { upsert: async (r) => upserts.push(r) },
    });
    assert.equal(res.status, 302);
    assert.equal(
      res.headers.get("location"),
      `/admin/sns-hub?x=error&reason=${reason}`,
    );
    assert.match(res.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal(calls.length, 0);
    assert.equal(upserts.length, 0);
  }
});

test("コールバック: コードをトークンに替え、自分のアカウント ID と暗号化した値だけを保存する", async () => {
  const { calls, fetchImpl } = xMock();
  const upserts = [];
  const now = new Date("2026-10-13T03:00:00Z");
  const res = await handleCallback(callbackRequest(), {
    env: ENV,
    fetchImpl,
    db: { upsert: async (r) => upserts.push(r) },
    now: () => now,
    configured: true,
  });
  assert.equal(res.headers.get("location"), "/admin/sns-hub?x=connected");
  const tokenCall = calls.find((c) => c.url === X_TOKEN_URL);
  assert.equal(
    tokenCall.options.headers.Authorization,
    `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
  );
  const body = new URLSearchParams(tokenCall.options.body);
  assert.equal(body.get("grant_type"), "authorization_code");
  assert.equal(body.get("code_verifier"), "verifier-1");
  assert.equal(
    body.get("redirect_uri"),
    "https://www.boat-ai.jp/api/admin/sns-hub/x-oauth/callback",
  );
  assert.equal(upserts.length, 1);
  assert.ok(!JSON.stringify(upserts[0]).includes("new-access"));
  assert.equal(upserts[0].account_id, "1234567890");
  assert.equal(upserts[0].access_expires_at, "2026-10-13T05:00:00.000Z");
  assert.deepEqual(await decryptTokens(upserts[0], KEY), {
    access_token: "new-access",
    refresh_token: "new-refresh",
  });
  // トークンの値は応答に出さない
  assert.ok(!JSON.stringify([...res.headers]).includes("new-access"));

  const failed = await handleCallback(callbackRequest(), {
    env: ENV,
    fetchImpl: xMock({ tokenStatus: 400 }).fetchImpl,
    configured: true,
    db: { upsert: async () => assert.fail("保存しない") },
  });
  assert.equal(
    failed.headers.get("location"),
    "/admin/sns-hub?x=error&reason=exchange",
  );
});

// sns_oauth_tokens の条件付き UPDATE と同じ動きをする、メモリ上の DB
function memoryDb(row) {
  let current = row ? { ...row } : null;
  return {
    get row() {
      return current;
    },
    async read() {
      return current ? { ...current } : null;
    },
    async upsert(next) {
      current = { ...next, lock_until: null, locked_by: null };
    },
    async tryLock(id, now, until) {
      if (current.lock_until && Date.parse(current.lock_until) >= now.getTime())
        return false;
      current = { ...current, lock_until: until.toISOString(), locked_by: id };
      return true;
    },
    async saveLocked(id, next) {
      if (current.locked_by !== id) return false;
      current = { ...current, ...next, lock_until: null, locked_by: null };
      return true;
    },
    async release(id) {
      if (current.locked_by === id)
        current = { ...current, lock_until: null, locked_by: null };
    },
  };
}
async function storedRow(expiresAt, tokens = TOKENS) {
  return {
    ...(await encryptTokens(tokens, KEY)),
    account_id: "1234567890",
    access_expires_at: expiresAt,
    lock_until: null,
    locked_by: null,
  };
}
const NOW = new Date("2026-10-13T03:00:00Z");
function refreshMock({ status = 200 } = {}) {
  let n = 0;
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push(new URLSearchParams(options.body));
      await new Promise((r) => setTimeout(r, 5));
      n += 1;
      return status === 200
        ? json({
            access_token: `access-${n + 1}`,
            refresh_token: `refresh-${n + 1}`,
            expires_in: 7200,
          })
        : json({ error: "invalid_request" }, status);
    },
  };
}
const base = (db, extra = {}) => ({
  db,
  keyBase64: KEY,
  clientId: "client-id",
  clientSecret: "client-secret",
  now: () => NOW,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  waitMs: 2,
  ...extra,
});

test("access token: 期限の5分前より前なら refresh しない、過ぎていたら refresh して保存する", async () => {
  const fresh = memoryDb(await storedRow("2026-10-13T03:10:00Z"));
  const mock = refreshMock();
  assert.equal(
    (await getXAccessToken(base(fresh, { fetchImpl: mock.fetchImpl })))
      .accessToken,
    "access-secret-1",
  );
  assert.equal(mock.calls.length, 0);

  const stale = memoryDb(await storedRow("2026-10-13T03:04:00Z"));
  const result = await getXAccessToken(
    base(stale, { fetchImpl: mock.fetchImpl }),
  );
  assert.equal(result.accessToken, "access-2");
  assert.equal(result.accountId, "1234567890");
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].get("grant_type"), "refresh_token");
  assert.equal(mock.calls[0].get("refresh_token"), "refresh-secret-1");
  assert.deepEqual(await decryptTokens(stale.row, KEY), {
    access_token: "access-2",
    refresh_token: "refresh-2",
  });
  assert.equal(stale.row.access_expires_at, "2026-10-13T05:00:00.000Z");
  assert.equal(stale.row.locked_by, null);
});

test("access token: 同時に3つ呼んでも refresh は1回（使い切りの refresh token を二重に使わない）", async () => {
  const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  const mock = refreshMock();
  const results = await Promise.all(
    [1, 2, 3].map(() =>
      getXAccessToken(base(db, { fetchImpl: mock.fetchImpl })),
    ),
  );
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(
    results.map((r) => r.accessToken),
    ["access-2", "access-2", "access-2"],
  );
});

test("access token: refresh に失敗したらロックを外して通知、保存に失敗したら連携のやり直しを通知", async () => {
  const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  const notices = [];
  await assert.rejects(
    getXAccessToken(
      base(db, {
        fetchImpl: refreshMock({ status: 400 }).fetchImpl,
        notify: async (m) => notices.push(m),
      }),
    ),
    /トークンを取得できません/,
  );
  assert.equal(db.row.locked_by, null);
  assert.match(notices[0], /更新できません/);

  const lost = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  lost.saveLocked = async () => false; // ロックが切れて別の呼び出しに取られた
  const notices2 = [];
  await assert.rejects(
    getXAccessToken(
      base(lost, {
        fetchImpl: refreshMock().fetchImpl,
        notify: async (m) => notices2.push(m),
      }),
    ),
    /連携のやり直し/,
  );
  assert.match(notices2[0], /連携のやり直しが要る/);

  await assert.rejects(
    getXAccessToken(
      base(memoryDb(null), { fetchImpl: refreshMock().fetchImpl }),
    ),
    /連携していません/,
  );
});

test("PostgREST: ロックは期限切れか空のときだけ取り、保存は locked_by が自分のときだけ", async () => {
  const calls = [];
  const db = createPostgrestTokenDb({
    url: "https://example.supabase.co",
    key: "service",
    fetchImpl: async (url, options) => {
      calls.push({ url: decodeURIComponent(String(url)), options });
      return json([{ provider: "x" }]);
    },
  });
  assert.equal(
    await db.tryLock("me", NOW, new Date(NOW.getTime() + 90000)),
    true,
  );
  assert.match(
    calls[0].url,
    /sns_oauth_tokens\?provider=eq\.x&or=\(lock_until\.is\.null,lock_until\.lt\.2026-10-13T03:00:00\.000Z\)$/,
  );
  assert.equal(calls[0].options.method, "PATCH");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    lock_until: "2026-10-13T03:01:30.000Z",
    locked_by: "me",
  });
  assert.equal(await db.saveLocked("me", { ciphertext: "c" }), true);
  assert.match(calls[1].url, /provider=eq\.x&locked_by=eq\.me$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    ciphertext: "c",
    lock_until: null,
    locked_by: null,
  });
});

test("access token: refresh 中にオーナーが連携をやり直したら、誤って『やり直しが要る』を出さず新しいトークンを使う", async () => {
  const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  const reconnected = await storedRow("2026-10-13T05:00:00Z", {
    access_token: "reconnected-access",
    refresh_token: "reconnected-refresh",
  });
  const notices = [];
  const result = await getXAccessToken(
    base(db, {
      notify: async (m) => notices.push(m),
      fetchImpl: async () => {
        await db.upsert(reconnected); // コールバックの upsert がロックを外して新しい値を入れる
        return json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 7200,
        });
      },
    }),
  );
  assert.equal(result.accessToken, "reconnected-access");
  assert.deepEqual(notices, []);
});

test("access token: 保存の DB エラーは理由つきで通知し、通知の失敗で元のエラーを隠さない、鍵の版違いは拒否する", async () => {
  const db = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  db.saveLocked = async () => {
    throw new Error("HTTP 500");
  };
  const notices = [];
  await assert.rejects(
    getXAccessToken(
      base(db, {
        fetchImpl: refreshMock().fetchImpl,
        notify: async (m) => notices.push(m),
      }),
    ),
    /DB の保存に失敗: HTTP 500/,
  );
  assert.match(notices[0], /HTTP 500/);

  const failing = memoryDb(await storedRow("2026-10-13T02:00:00Z"));
  await assert.rejects(
    getXAccessToken(
      base(failing, {
        fetchImpl: refreshMock({ status: 400 }).fetchImpl,
        notify: async () => {
          throw new Error("Slack down");
        },
      }),
    ),
    /トークンを取得できません/,
  );

  const old = { ...(await storedRow("2026-10-13T05:00:00Z")), key_version: 2 };
  await assert.rejects(getXAccessToken(base(memoryDb(old))), /未対応の鍵の版/);
});
