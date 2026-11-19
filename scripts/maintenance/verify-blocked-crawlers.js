/**
 * 断るクローラー（Reflectionbot・meta-externalagent・Bytespider。Supabase の枠越えの主因、オーナー 2026-11-19）の検査。
 * 1. 見本の UA（大文字小文字を変えた物も）は middleware.js が matcher の全パスで 403・no-store を返す
 * 2. 検索ボット（Googlebot・bingbot）・他の AI（GPTBot・ClaudeBot 等）・SNS・人のブラウザは 403 にならず今の経路のまま
 * 3. public/robots.txt に同じ3つだけの Disallow: / があり、User-agent: * は Allow: / のまま
 * middleware 関数を直接呼ぶ（verify-middleware-routing.js と同じ作り）。
 */

import { readFileSync } from "node:fs";
import middleware, { config } from "../../middleware.js";
import {
  BLOCKED_CRAWLER_USER_AGENTS,
  isBlockedCrawler,
} from "../../src/config/aiCrawlerBots.js";

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
    check(`${ua} は断る対象`, isBlockedCrawler(ua));
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
    check(`${ua} は断る対象でない`, !isBlockedCrawler(ua));
    for (const path of PATHS) {
      const res = await call(path, { ua });
      check(`${ua} ${path} → 403 にならない`, res?.status !== 403, describe(res));
    }
  }
  check("UA なしは断る対象でない", !isBlockedCrawler(null) && !isBlockedCrawler(""));
  check(
    "Googlebot の / は今のまま素通り",
    (await call("/", { ua: ALLOWED_SAMPLES[2] })) === undefined,
  );
  check(
    "GPTBot の / は今のまま関数へ",
    (await call("/", { ua: BOT_UA }))?.headers.get("x-middleware-rewrite") ===
      "https://www.boat-ai.jp/api/bot-page/top",
  );

  // robots.txt: 3つそれぞれの組に Disallow: / があり、User-agent: * の組は Allow: / のまま
  const robots = readFileSync(new URL("../../public/robots.txt", import.meta.url), "utf8");
  const groups = robots
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));
  const groupOf = (name) =>
    groups.find((lines) =>
      lines.some((l) => l.toLowerCase() === `user-agent: ${name.toLowerCase()}`),
    ) ?? [];
  for (const name of BLOCKED_CRAWLER_USER_AGENTS) {
    check(`robots.txt: ${name} は Disallow: /`, groupOf(name).includes("Disallow: /"));
  }
  check(
    "robots.txt: User-agent: * は Allow: / のまま（検索・他の AI は止めない）",
    groupOf("*").includes("Allow: /") && !groupOf("*").includes("Disallow: /"),
  );
  const named = groups
    .flat()
    .filter((l) => /^user-agent:/i.test(l))
    .map((l) => l.replace(/^user-agent:\s*/i, ""))
    .filter((n) => n !== "*");
  check(
    "robots.txt で名指しで断るのは BLOCKED_CRAWLER_USER_AGENTS と同じ3つだけ",
    JSON.stringify([...named].sort()) === JSON.stringify([...BLOCKED_CRAWLER_USER_AGENTS].sort()),
    named.join(","),
  );
}

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: 断るクローラーだけが 403、robots.txt と一覧が一致している");
