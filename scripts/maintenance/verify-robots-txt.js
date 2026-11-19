/**
 * public/robots.txt の検査（断るクローラー、Supabase の枠越えの主因 2026-11-19）。
 * 1. Reflectionbot・meta-externalagent・Bytespider の組それぞれに Disallow: / がある
 * 2. User-agent: * の組は Allow: / のまま（検索ボット・他の AI は止めない）
 * 3. 名指しの組はこの3つだけ（正本は src/config/aiCrawlerBots.js の BLOCKED_CRAWLER_USER_AGENTS。
 *    middleware.js の 403 は verify-blocked-crawlers.js）
 */

import { readFileSync } from "node:fs";

const BLOCKED_CRAWLER_USER_AGENTS = ["Reflectionbot", "meta-externalagent", "Bytespider"];

const failures = [];
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  OK  ${label}`);
  } else {
    console.log(`  NG  ${label}${detail ? ` (${detail})` : ""}`);
    failures.push(label);
  }
}

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
  "robots.txt で名指しで断るのは同じ3つだけ",
  JSON.stringify([...named].sort()) === JSON.stringify([...BLOCKED_CRAWLER_USER_AGENTS].sort()),
  named.join(","),
);

if (failures.length > 0) {
  console.error(`\nNG: ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nOK: robots.txt は3つだけを断り、他は今のまま");
