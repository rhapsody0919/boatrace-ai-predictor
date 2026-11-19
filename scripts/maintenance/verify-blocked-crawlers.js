/**
 * 断るクローラー（Reflectionbot・meta-externalagent・Bytespider。Supabase の枠越えの主因、オーナー 2026-11-19）の検査。
 * 1. 見本の UA（大文字小文字を変えた物も）は middleware.js が matcher の全パスで 403・no-store を返す
 * 2. 検索ボット（Googlebot・bingbot）・他の AI（GPTBot・ClaudeBot 等）・SNS・人のブラウザは 403 にならず今の経路のまま
 * robots.txt の側は verify-robots-txt.js
 * middleware 関数を直接呼ぶ（verify-middleware-routing.js と同じ作り）。
 */

import middleware, { config } from "../../middleware.js";

// 正本は src/config/aiCrawlerBots.js の BLOCKED_CRAWLER_USER_AGENTS。ここは見本として持ち、middleware の振る舞いで確かめる
// （新しい verify は src の本文を読まない決まりのため import しない）
const BLOCKED_CRAWLER_USER_AGENTS = ["Reflectionbot", "meta-externalagent", "Bytespider"];

const BOT_UA =
  "Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)";
const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

// matcher は固定パスと /prefix/:path* の2形だけ（verify-middleware-routing.js が他の形を落とす）
const matcherRegExps = config.matcher.map((pattern) => {
  const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wildcard = pattern.match(/^(\/[^:*()]*?)\/:path\*$/);
  return wildcard
    ? new RegExp(`^${escape(wildcard[1])}(?:/.*)?$`)
    : new RegExp(`^${escape(pattern)}$`);
});
const matchesMatcher = (pathname) => matcherRegExps.some((re) => re.test(pathname));

const call = (pathname, { ua }) =>
  middleware(new Request(`https://www.boat-ai.jp${pathname}`, { headers: { "user-agent": ua } }));

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

// 管理画面は認証の環境変数が無いと 401 になるので、403 でないことだけを見る
process.env.SNS_HUB_BASIC_AUTH_USER = "verify-user";
process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "verify-pass";

console.log("断るクローラーは 403、他の UA は今のまま");
{
  // 見本は各社の公開の UA の形（大文字小文字を変えた物も含む）
  const BLOCKED_SAMPLES = [
    "Mozilla/5.0 (compatible; Reflectionbot/1.0; +https://reflection.ai/bot)",
    "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
    "Mozilla/5.0 (compatible; REFLECTIONBOT/2.0)",
    "Meta-ExternalAgent/1.1",
    "bytespider",
  ];
  const ALLOWED_SAMPLES = [
    HUMAN_UA,
    BOT_UA,
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "meta-externalfetcher/1.1",
    "Twitterbot/1.0",
  ];
  const PATHS = [
    "/",
    "/race/2026-11-19-01-01",
    "/racer/4561",
    "/venue/1",
    "/blog",
    "/today",
    "/en/",
    "/api/races/today",
    "/admin/rules",
  ];
  for (const ua of BLOCKED_SAMPLES) {
    for (const path of PATHS) {
      check(`${path} は matcher に一致する`, matchesMatcher(path));
      const res = await call(path, { ua });
      check(
        `${ua} ${path} → 403・no-store`,
        res?.status === 403 && res.headers.get("cache-control") === "no-store",
        describe(res),
      );
    }
  }
  for (const ua of ALLOWED_SAMPLES) {
    for (const path of PATHS) {
      const res = await call(path, { ua });
      check(`${ua} ${path} → 403 にならない`, res?.status !== 403, describe(res));
    }
  }
  check(
    "Googlebot の / は今のまま素通り",
    (await call("/", { ua: ALLOWED_SAMPLES[2] })) === undefined,
  );
  check(
    "GPTBot の / は今のまま関数へ",
    (await call("/", { ua: BOT_UA }))?.headers.get("x-middleware-rewrite") ===
      "https://www.boat-ai.jp/api/bot-page/top",
  );

}

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: 断るクローラーだけが 403");
