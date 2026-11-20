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
 * 6. 検索・ユーザー起点の取得に使う UA（OAI-SearchBot・bingbot 等）もスナップショットに振り分け、
 *    Googlebot と人間のブラウザは振り分けない
 * 7. 日本語の / と /venue/1〜24 は、配る UA のときだけ関数（/api/bot-page/*）へ振り分ける（ADR 0089）。
 *    /venue/01・範囲外・数字以外・/races/… は振り分けない（言語版は 7b）。
 *    rewrite 先に元のクエリ文字列を持ち込まない（CDN キャッシュのキーを増やさない）
 * 7b. 言語版の /{en|zh-TW|ko}/（末尾の / なしも）と /{lang}/venue/1〜24 は、配る UA のときだけ
 *    /api/bot-page/{lang}/top・/api/bot-page/{lang}/venue/{code} へ振り分ける（BOA-848 第2段）。
 *    言語ごとに rewrite 先が分かれ（CDN のキーが言語で混ざらない）、言語の一覧と会場コードの範囲が関数（api/_lib/botPage.js）と一致する
 * 8. vercel.json のページの no-store 規則は、/ と /venue/1〜24（と言語版）だけ配る UA を除外する（missing）。
 *    除外する UA の一覧が BOT_PAGE_USER_AGENTS と一致し、他のページの no-store は外れない
 *    （外すと関数の応答が CDN に残らない。Preview で MISS が続いたため、ADR 0089「未確認」の1）
 * 10. ブログ一覧（/blog・/{lang}/blog）と翻訳記事（/{lang}/blog/{id}）は、配る UA のときだけ
 *    /ai-snapshots/blog-list.html・/ai-snapshots/{lang}/blog-list.html・/ai-snapshots/{lang}/blog/{id}.html へ振り分ける（BOA-848 第2段）
 * 11. 本日（JST）のレース詳細（/race/{id}・/{lang}/race/{id}）は、配る UA のときだけ /api/bot-page/race/{id}・
 *    /api/bot-page/{lang}/race/{id} へ振り分ける（BOA-848 第2段）。過去・未来・形の違う id・/assist・対応外の言語は振り分けない。
 *    「本日」は JST の日付。vercel.json の no-store は、本日かどうかによらず id の形のパスだけ配る UA を除外する
 * 9. 選手ページ（/racer/{4桁}、BOA-848）は配る UA のときだけ /ai-snapshots/racer/{番号}.html へ振り分ける。
 *    Googlebot・人のブラウザ・番号の形が違うもの・言語の接頭辞付き・/racers は振り分けない
 * 12. /api の関門（BOA-1110 段階3、api/_lib/apiGate.js）: matcher に /api/:path* がある。rewrite 先の /api/bot-page/* と
 *    /api/admin/* は関門の除外（ログ無し・既存の分岐へ）。観測（API_GATE_MODE 未設定）は外の要求も通して would_deny の1行を出し、
 *    禁じた形のパスだけ 400。強制は環境変数だけで 403。env の鍵の末尾の改行を落として比べる（再現テスト）
 *
 * Vercel の matcher は path-to-regexp 構文。このリポジトリが使う
 * 「固定パス」と「/prefix/:path*」の2形だけを解釈し、それ以外の形が足されたら
 * 解釈を誤らないよう失敗させる。
 */

import { readFileSync } from "node:fs";
import middleware, { config } from "../../middleware.js";

import { BOT_PAGE_USER_AGENTS, resolveSnapshotPath } from "../../src/config/aiCrawlerBots.js";
import { compileIpRanges } from "../../api/_lib/apiGate.js";
import {
  runMiddlewareRoutingScenes1,
  runMiddlewareRoutingScenes2,
  runMiddlewareRoutingScenes3,
  runMiddlewareRoutingScenes4,
  runMiddlewareRoutingScenes5,
} from "./verifyData/middleware-routing-scenes-1.js";
import {
  runMiddlewareRoutingScenes6,
  runMiddlewareRoutingScenes7,
  runMiddlewareRoutingScenes8,
  runMiddlewareRoutingScenes9,
} from "./verifyData/middleware-routing-scenes-2.js";
import { runMiddlewareRoutingScenes10 } from "./verifyData/middleware-routing-scenes-3.js";

// [12] の判定に使う IP の範囲（検索ボットの経路は verify-api-gate.js が本物の表で固定する）
const GATE_TEST_RANGES = compileIpRanges({
  sources: [{ prefixes: ["192.0.2.0/24"] }],
});

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
  "/admin/sns-hub/metrics",
  "/api/admin/sns-hub/deadline-queue",
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

// ---- 後半の場面（verifyData/middleware-routing-scenes-1.js） ----
await runMiddlewareRoutingScenes1({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD });
// 実際の UA 文字列（各社の公開ドキュメントの形）。名前だけでなく文字列全体で判定できることを見る
const SEARCH_BOT_UAS = {
  "OAI-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
  "ChatGPT-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
  "Claude-SearchBot":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)",
  "Claude-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)",
  "Perplexity-User":
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
  bingbot:
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36",
  Applebot:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
  DuckDuckBot: "DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)",
  // BOA-899: Gemini Notebook の利用者起点の取得器。UA 全文は https://developers.google.com/crawling/docs/crawlers-fetchers/google-user-triggered-fetchers（2026-11-02）
  "Google-GeminiNotebook":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36 (compatible; Google-GeminiNotebook; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-gemininotebook)",
};

// ---- 後半の場面（verifyData/middleware-routing-scenes-1.js） ----
await runMiddlewareRoutingScenes2({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS });
const NOT_SNAPSHOT_UAS = {
  Googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  // BOA-899: Google の取得器は Google-GeminiNotebook 以外に配らない（ADR 0032 追記）
  "Google-InspectionTool":
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)",
  GoogleOther:
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; GoogleOther)",
  "Google-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko; compatible; Google-Agent; +https://developers.google.com/crawling/docs/crawlers-fetchers/google-agent) Chrome/141.0.0.0 Safari/537.36",
  // robots.txt の印。この文字列を名乗る取得は無いが、名乗っても配らない
  "Google-Extended": "Mozilla/5.0 (compatible; Google-Extended)",
  "Edge（人間）":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0",
  "Safari（人間）":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};

// ---- 後半の場面（verifyData/middleware-routing-scenes-1.js） ----
runMiddlewareRoutingScenes3({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS });
const ORIGIN = "https://www.boat-ai.jp";
const BOT_PAGE_UAS = {
  GPTBot: BOT_UA,
  ...SEARCH_BOT_UAS,
};
const BOT_PAGE_ROUTES = [
  ["/", "/api/bot-page/top"],
  // /today（BOA-848 第2段）。?date= 付きは振り分けない（下の NOT_BOT_PAGE_PATHS ではなく個別に見る）
  ["/today", "/api/bot-page/today"],
  ["/venue/1", "/api/bot-page/venue/1"],
  ["/venue/9", "/api/bot-page/venue/9"],
  ["/venue/10", "/api/bot-page/venue/10"],
  ["/venue/24", "/api/bot-page/venue/24"],
  // 言語版（BOA-848 第2段）。人の URL は /en/（canonical）だが、/en も同じ SPA のトップなので同じ HTML を返す
  ...["en", "zh-TW", "ko"].flatMap((lang) => [
    [`/${lang}/`, `/api/bot-page/${lang}/top`],
    [`/${lang}`, `/api/bot-page/${lang}/top`],
    [`/${lang}/venue/1`, `/api/bot-page/${lang}/venue/1`],
    [`/${lang}/venue/24`, `/api/bot-page/${lang}/venue/24`],
  ]),
];

// ---- 後半の場面（verifyData/middleware-routing-scenes-1.js） ----
await runMiddlewareRoutingScenes4({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, BOT_PAGE_ROUTES });
const NOT_BOT_PAGE_PATHS = [
  "/venue/01",
  "/venue/0",
  "/venue/25",
  "/venue/99",
  "/venue/abc",
  "/venue/1/",
  "/venue/1/extra",
  "/venue",
  "/races/2026-10-11/1",
  "/race/20260929-01-01",
  // 言語版でも、0埋め・範囲外・ほかのパス・対応外の言語・大文字違いは振り分けない
  "/en/venue/01",
  "/en/venue/0",
  "/en/venue/25",
  "/en/venue/abc",
  "/en/venue/1/",
  "/en/venue",
  "/en//",
  // /en/race/{id} は、本日なら関数へ振り分け、過去・未来は振り分けない（[6d]）。id の形のパスは本日かどうかによらず
  // vercel.json の no-store から配る UA を除くので、この一覧（[7] で no-store のままを確かめる）には入れない
  // /en/blog は翻訳記事の一覧としてスナップショットへ振り分ける（BOA-848 第2段、下の 7c）
  "/en/guide",
  "/en/venues",
  "/zh-TW/today",
  "/ko/racer/3256",
  "/fr/",
  "/fr/venue/1",
  "/EN/",
  "/EN/venue/1",
  "/zh-tw/venue/1",
  "/ja/",
  "/ja/venue/1",
  "/english",
  "/en-US/venue/1",
];

// ---- 後半の場面（verifyData/middleware-routing-scenes-1.js・middleware-routing-scenes-2.js） ----
await runMiddlewareRoutingScenes5({ USER, PASSWORD, BOT_UA, matchesMatcher, toBase64, call, check, describe, ADMIN_PATHS, COLON_PASSWORD, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, BOT_PAGE_ROUTES, NOT_BOT_PAGE_PATHS });
await runMiddlewareRoutingScenes6({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS });
{
  const routes = [
    ["/blog", "/ai-snapshots/blog-list.html"],
    ["/en/blog", "/ai-snapshots/en/blog-list.html"],
    ["/zh-TW/blog", "/ai-snapshots/zh-TW/blog-list.html"],
    ["/ko/blog", "/ai-snapshots/ko/blog-list.html"],
    ["/en/blog/some-article", "/ai-snapshots/en/blog/some-article.html"],
    ["/zh-TW/blog/some-article", "/ai-snapshots/zh-TW/blog/some-article.html"],
    ["/ko/blog/some-article", "/ai-snapshots/ko/blog/some-article.html"],
    // ja の記事は従来どおり
    ["/blog/some-article", "/ai-snapshots/blog/some-article.html"],
  ];
  for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
    for (const [path, target] of routes) {
      check(`${name} ${path} は matcher に一致する`, matchesMatcher(path));
      const res = await call(path, { ua });
      check(
        `${name} ${path} → ${target}`,
        res?.headers.get("x-middleware-rewrite") === `${ORIGIN}${target}`,
        describe(res),
      );
    }
  }
  for (const [name, ua] of Object.entries(NOT_SNAPSHOT_UAS)) {
    for (const [path] of routes) {
      const res = await call(path, { ua });
      check(`${name} ${path} → 素通り（SPA のまま）`, res === undefined, describe(res));
    }
  }
  for (const path of [
    "/blog/",
    "/en/blog/",
    "/en/blog/a/b",
    "/fr/blog",
    "/fr/blog/some-article",
    "/EN/blog/some-article",
    "/ja/blog/some-article",
    "/en/blogs",
  ]) {
    const res = await call(path, { ua: SEARCH_BOT_UAS.bingbot });
    check(`bingbot ${path} → 素通り（SPA のまま）`, res === undefined, describe(res));
  }
  {
    const res = await call("/en/blog/some-article?x=1", { ua: BOT_UA });
    check(
      "GPTBot /en/blog/some-article?x=1 → クエリを持ち込まない",
      res?.headers.get("x-middleware-rewrite") ===
        `${ORIGIN}/ai-snapshots/en/blog/some-article.html`,
      describe(res),
    );
  }
  // 振り分け先の翻訳記事の言語が、生成側（generate-ai-snapshots.js の BLOG_TRANSLATIONS）と languages.js の翻訳の言語と同じ
  const { SUPPORTED_LANGUAGES } = await import("../../src/config/languages.js");
  const langs = SUPPORTED_LANGUAGES.map((l) => l.code).filter((c) => c !== "ja");
  for (const lang of langs) {
    check(
      `${lang} の翻訳記事を振り分ける`,
      resolveSnapshotPath(`/${lang}/blog/x`, BOT_UA) === `/ai-snapshots/${lang}/blog/x.html`,
    );
  }
  const gen = readFileSync(
    new URL("../generate-ai-snapshots.js", import.meta.url),
    "utf8",
  );
  for (const lang of langs) {
    check(
      `生成側が ${lang} の翻訳記事を作る（BLOG_TRANSLATIONS）`,
      new RegExp(`(?:^|\\s|")${lang.replace("-", "\\-")}"?:\\s*blogPosts`, "m").test(gen),
    );
  }
}

// ---- 後半の場面（verifyData/middleware-routing-scenes-2.js） ----
runMiddlewareRoutingScenes7({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS });
const jstDateOf = (ms) =>
  new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const TODAY = jstDateOf(Date.now());
const RACE_ROUTES = [
  [`/race/${TODAY}-01-01`, `/api/bot-page/race/${TODAY}-01-01`],
  [`/race/${TODAY}-24-12`, `/api/bot-page/race/${TODAY}-24-12`],
  [`/en/race/${TODAY}-06-05`, `/api/bot-page/en/race/${TODAY}-06-05`],
  [`/zh-TW/race/${TODAY}-12-03`, `/api/bot-page/zh-TW/race/${TODAY}-12-03`],
  [`/ko/race/${TODAY}-01-12`, `/api/bot-page/ko/race/${TODAY}-01-12`],
];

// ---- 後半の場面（verifyData/middleware-routing-scenes-2.js） ----
await runMiddlewareRoutingScenes8({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, TODAY, RACE_ROUTES });
{
  const vercel = JSON.parse(
    readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  const isNoStore = (rule) =>
    rule.headers?.some(
      (h) => h.key === "Vercel-CDN-Cache-Control" && h.value === "no-store",
    );
  // source は固定パスか、正規表現の括弧を含む形だけ（:name の引数は使っていない）
  const sourceRegExp = (source) => {
    if (/\/:[A-Za-z]/.test(source)) {
      throw new Error(`source "${source}" の :name 形はこの検証が解釈できない`);
    }
    return new RegExp(`^${source}$`);
  };
  const noStoreRules = vercel.headers.filter(isNoStore).map((rule) => ({
    re: sourceRegExp(rule.source),
    missingUa: rule.missing?.find(
      (m) => m.type === "header" && m.key === "user-agent",
    )?.value,
  }));
  // 人・Googlebot のとき（missing が効かない）と、配る UA のとき（missing が効く）に no-store が付くか
  const noStoreFor = (path, ua) =>
    noStoreRules.some(
      ({ re, missingUa }) =>
        re.test(path) && !(missingUa && new RegExp(missingUa).test(ua)),
    );
  check(
    "missing の付いた no-store 規則は / ・/venue/N・言語版のトップ・言語版の会場・/today・レース詳細の6つ",
    noStoreRules.filter((r) => r.missingUa).length === 6,
    String(noStoreRules.filter((r) => r.missingUa).length),
  );
  for (const rule of noStoreRules.filter((r) => r.missingUa)) {
    const names = rule.missingUa.match(/\(\?:([^)]+)\)/)?.[1].split("|") ?? [];
    check(
      `${rule.re} の missing の UA が BOT_PAGE_USER_AGENTS と一致`,
      names.length === BOT_PAGE_USER_AGENTS.length &&
        BOT_PAGE_USER_AGENTS.every((ua) => names.includes(ua)),
      names.join(","),
    );
  }
  for (const [path] of [...BOT_PAGE_ROUTES, ...RACE_ROUTES]) {
    for (const [name, ua] of Object.entries(BOT_PAGE_UAS)) {
      check(`${name} ${path} は no-store を付けない`, !noStoreFor(path, ua));
    }
    for (const [name, ua] of Object.entries(NOT_SNAPSHOT_UAS)) {
      check(`${name} ${path} は no-store のまま`, noStoreFor(path, ua));
    }
  }
  for (const path of [
    ...NOT_BOT_PAGE_PATHS,
    "/winning-technique",
    "/blog/some-article",
    "/racer/3256",
    "/index.html",
  ]) {
    for (const [name, ua] of Object.entries({
      ...BOT_PAGE_UAS,
      ...NOT_SNAPSHOT_UAS,
    })) {
      check(`${name} ${path} は no-store のまま`, noStoreFor(path, ua));
    }
  }
  for (const path of ["/api/races/today", "/assets/index.js"]) {
    check(`${path} は no-store の規則に入らない`, !noStoreFor(path, HUMAN_UA));
  }
}

// ---- 後半の場面（verifyData/middleware-routing-scenes-2.js・middleware-routing-scenes-3.js） ----
runMiddlewareRoutingScenes9({ BOT_UA, matchesMatcher, call, check, describe, SEARCH_BOT_UAS, NOT_SNAPSHOT_UAS, ORIGIN, BOT_PAGE_UAS, TODAY, RACE_ROUTES });
await runMiddlewareRoutingScenes10({ GATE_TEST_RANGES, BOT_UA, HUMAN_UA, matchesMatcher, call, check, describe, ADMIN_PATHS, ORIGIN, BOT_PAGE_ROUTES, RACE_ROUTES });

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log(
  "\nOK: middleware の認証とスナップショット配信の経路は整合している",
);
