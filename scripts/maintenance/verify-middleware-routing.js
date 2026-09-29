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

function call(pathname, { auth, ua = HUMAN_UA } = {}) {
  const headers = { "user-agent": ua };
  if (auth) headers.authorization = `Basic ${btoa(auth)}`;
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
];

console.log("[1] 管理画面の認証");
for (const path of ADMIN_PATHS) {
  check(`${path} は matcher に一致する`, matchesMatcher(path));

  const noAuth = call(path);
  check(`${path} 認証なし → 401`, noAuth?.status === 401, describe(noAuth));
  check(
    `${path} 401 に WWW-Authenticate: Basic realm と no-store が付く`,
    /^Basic realm="[^"]+"$/.test(
      noAuth?.headers.get("www-authenticate") ?? "",
    ) && noAuth?.headers.get("cache-control") === "no-store",
  );

  const wrong = call(path, { auth: `${USER}:wrong` });
  check(`${path} 誤った認証 → 401`, wrong?.status === 401, describe(wrong));

  const ok = call(path, { auth: `${USER}:${PASSWORD}` });
  check(`${path} 正しい認証 → 素通り`, ok === undefined, describe(ok));

  const bot = call(path, { ua: BOT_UA });
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
    const res = call(path, { auth });
    check(
      `${path} 未設定・auth=${JSON.stringify(auth)} → 401`,
      res?.status === 401,
      describe(res),
    );
  }
}
process.env.SNS_HUB_BASIC_AUTH_USER = USER;
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = PASSWORD;

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
  const res = call(path);
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
  const res = call(path, { ua: BOT_UA });
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
