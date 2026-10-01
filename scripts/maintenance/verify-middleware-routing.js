/**
 * middleware.js の2つの関心事（管理画面のBasic認証・AIクローラー向けスナップショット配信）が
 * 互いを壊していないことを、middleware 関数を直接呼んで確かめる（BOA-555）。
 *
 * 1. 管理画面（/admin/rules・/admin/sns-hub）は認証なしで401、正しい認証で素通り
 * 2. 一般ページ（/、/race/…、/blog 等）は認証の対象外
 * 3. resolveSnapshotPath が配信対象にするパスは、必ず config.matcher にも一致する
 *    （Vercel は matcher に一致したパスでしか middleware を起動しないため、
 *     片方だけに足すと本番で黙って配信されない。ローカルビルドでは気づけない）
 * 4. 管理画面のパスはボットのUser-Agentでもスナップショットに振り分けられない
 * 5. 認証判定は api/_lib/adminAuth.js の requireAdminAuth と同じ（環境変数が空なら拒否、
 *    パスワードは最初の ":" だけで分割、方式名 "Basic" は大文字小文字を区別しない、UTF-8 で復号）
 *
 * Vercel の matcher は path-to-regexp 構文。このリポジトリが使う
 * 「固定パス」と「/prefix/:path*」の2形だけを解釈し、それ以外の形が足されたら
 * 解釈を誤らないよう失敗させる。
 */

import middleware, { config } from "../../middleware.js";
import { resolveSnapshotPath } from "../../src/config/aiCrawlerBots.js";

const USER = "verify-user";
const PASSWORD = "verify-pass";
const BOT_UA =
  "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

function toMatcherRegExp(pattern) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = pattern.match(/^(\/[^:*()]*?)\/:path\*$/);
  if (wildcard) return new RegExp(`^${escape(wildcard[1])}(?:/.*)?$`);
  if (/^\/[^:*()]*$/.test(pattern)) return new RegExp(`^${escape(pattern)}$`);
  throw new Error(
    `matcher "${pattern}" はこの検証が解釈できない形。toMatcherRegExp に対応を足すこと`,
  );
}

const matcherRegExps = config.matcher.map(toMatcherRegExp);
const matchesMatcher = (pathname) =>
  matcherRegExps.some((re) => re.test(pathname));

// UTF-8 のバイト列を base64 にする（btoa は latin1 しか扱えないため）
const toBase64 = (text) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)));

// auth は "user:password"（"Basic " を付けて base64 化する）、
// authorization はヘッダーの値をそのまま渡したいとき用
async function call(pathname, { auth, authorization, ua = HUMAN_UA } = {}) {
  const headers = { "user-agent": ua };
  if (auth !== undefined) headers.authorization = `Basic ${toBase64(auth)}`;
  if (authorization !== undefined) headers.authorization = authorization;
  return middleware(
    new Request(`https://www.boat-ai.jp${pathname}`, { headers }),
  );
}

const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  OK  ${label}`);
  } else {
    console.log(`  NG  ${label}${detail ? ` (${detail})` : ""}`);
    failures.push(label);
  }
}

const describe = (res) =>
  res === undefined
    ? "素通り"
    : `status=${res.status} rewrite=${res.headers.get("x-middleware-rewrite")}`;

process.env.SNS_HUB_BASIC_AUTH_USER = USER;
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = PASSWORD;

const ADMIN_PATHS = [
  "/admin/rules",
  "/admin/rules/",
  "/admin/rules/detail",
  "/admin/sns-hub",
  "/admin/sns-hub/insights",
  "/api/admin/sns-hub/trigger-weekly-proposer",
  "/api/admin/rules/performance",
];

console.log("[1] 管理画面の認証");
for (const path of ADMIN_PATHS) {
  check(`${path} は matcher に一致する`, matchesMatcher(path));

  const noAuth = await call(path);
  check(`${path} 認証なし → 401`, noAuth?.status === 401, describe(noAuth));
  check(
    `${path} 401 に WWW-Authenticate: Basic realm と no-store が付く`,
    /^Basic realm="[^"]+"$/.test(
      noAuth?.headers.get("www-authenticate") ?? "",
    ) && noAuth?.headers.get("cache-control") === "no-store",
  );

  const wrong = await call(path, { auth: `${USER}:wrong` });
  check(`${path} 誤った認証 → 401`, wrong?.status === 401, describe(wrong));

  const ok = await call(path, { auth: `${USER}:${PASSWORD}` });
  check(`${path} 正しい認証 → 素通り`, ok === undefined, describe(ok));

  const bot = await call(path, { ua: BOT_UA });
  check(
    `${path} ボットUAでもスナップショットに振り分けず401`,
    bot?.status === 401,
    describe(bot),
  );
}

console.log("[2] 環境変数が未設定なら拒否（fail-closed）");
delete process.env.SNS_HUB_BASIC_AUTH_USER;
delete process.env.SNS_HUB_BASIC_AUTH_PASSWORD;
for (const path of ["/admin/rules", "/admin/sns-hub"]) {
  for (const auth of [undefined, ":", "undefined:undefined"]) {
    const res = await call(path, { auth });
    check(
      `${path} 未設定・auth=${JSON.stringify(auth)} → 401`,
      res?.status === 401,
      describe(res),
    );
  }
}

console.log("[2b] 環境変数が空文字なら拒否（空:空 = Basic Og== でも通さない）");
for (const [envUser, envPassword] of [
  ["", ""],
  [USER, ""],
  ["", PASSWORD],
]) {
  process.env.SNS_HUB_BASIC_AUTH_USER = envUser;
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = envPassword;
  const envAuth = `Basic ${toBase64(`${envUser}:${envPassword}`)}`;
  for (const path of [
    "/admin/rules",
    "/admin/sns-hub",
    "/api/admin/sns-hub/drafts",
  ]) {
    for (const authorization of new Set(["Basic Og==", envAuth])) {
      const res = await call(path, { authorization });
      check(
        `${path} env=${JSON.stringify(`${envUser}:${envPassword}`)}・${authorization} → 401`,
        res?.status === 401,
        describe(res),
      );
    }
  }
}

console.log("[2c] 認証ヘッダーの解釈（requireAdminAuth と同じ）");
const COLON_PASSWORD = "pa:ss:word";
process.env.SNS_HUB_BASIC_AUTH_USER = USER;
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = COLON_PASSWORD;
{
  const path = "/admin/rules";
  const full = await call(path, { auth: `${USER}:${COLON_PASSWORD}` });
  check(
    "':'入りパスワードの完全一致 → 素通り",
    full === undefined,
    describe(full),
  );
  for (const partial of ["pa", "pa:ss", "pa:ss:wor", `${COLON_PASSWORD}:`]) {
    const res = await call(path, { auth: `${USER}:${partial}` });
    check(
      `':'入りパスワードの不一致(${partial}) → 401`,
      res?.status === 401,
      describe(res),
    );
  }
}

const UTF8_PASSWORD = "パスワード:é";
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = UTF8_PASSWORD;
{
  const res = await call("/admin/sns-hub", {
    auth: `${USER}:${UTF8_PASSWORD}`,
  });
  check(
    "UTF-8 のパスワード（base64 を UTF-8 として復号）→ 素通り",
    res === undefined,
    describe(res),
  );
}

process.env.SNS_HUB_BASIC_AUTH_USER = USER;
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = PASSWORD;
{
  const encode = (userPass) => toBase64(userPass);
  const cases = [
    ["誤ったパスワード", `Basic ${encode(`${USER}:wrong`)}`, 401],
    ["誤ったユーザー", `Basic ${encode(`other:${PASSWORD}`)}`, 401],
    [
      "パスワードの前方一致",
      `Basic ${encode(`${USER}:${PASSWORD.slice(0, -1)}`)}`,
      401,
    ],
    ["':' が無い", `Basic ${encode(`${USER}${PASSWORD}`)}`, 401],
    ["壊れた base64", "Basic !!!", 401],
    ["Basic 以外の方式", `Bearer ${PASSWORD}`, 401],
    // requireAdminAuth と同じく方式名の大文字小文字は区別しない（RFC 7235）
    ["方式名が小文字 basic", `basic ${encode(`${USER}:${PASSWORD}`)}`, null],
    ["方式名が大文字 BASIC", `BASIC ${encode(`${USER}:${PASSWORD}`)}`, null],
  ];
  for (const [label, authorization, expected] of cases) {
    const res = await call("/admin/rules", { authorization });
    check(
      `${label} → ${expected ?? "素通り"}`,
      expected === null ? res === undefined : res?.status === expected,
      describe(res),
    );
  }
}

console.log("[3] 一般ページは認証の対象外");
const PUBLIC_PATHS = [
  "/",
  "/race/20260929-01-01",
  "/venue/01",
  "/blog",
  "/blog/some-article",
  "/winning-technique",
  "/today",
  "/robots.txt",
  "/admin",
  "/admin/rulesx",
  "/en/admin/rules",
];
for (const path of PUBLIC_PATHS) {
  const res = await call(path);
  check(`${path} 人間のUA → 素通り`, res === undefined, describe(res));
}

console.log("[4] スナップショット配信の経路と matcher の一致");
const SNAPSHOT_CANDIDATES = [
  "/winning-technique",
  "/today",
  "/blog/some-article",
  ...PUBLIC_PATHS,
  ...ADMIN_PATHS,
];
for (const path of SNAPSHOT_CANDIDATES) {
  const snapshot = resolveSnapshotPath(path, BOT_UA);
  if (!snapshot) continue;
  check(`${path} → ${snapshot} は matcher に一致する`, matchesMatcher(path));
  const res = await call(path, { ua: BOT_UA });
  check(
    `${path} ボットUA → スナップショットへ rewrite`,
    res?.headers.get("x-middleware-rewrite")?.endsWith(snapshot) ?? false,
    describe(res),
  );
}
for (const path of ["/winning-technique", "/today", "/blog/some-article"]) {
  check(
    `${path} は配信対象のまま（resolveSnapshotPath が null を返さない）`,
    resolveSnapshotPath(path, BOT_UA) !== null,
  );
}

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log(
  "\nOK: middleware の認証とスナップショット配信の経路は整合している",
);
