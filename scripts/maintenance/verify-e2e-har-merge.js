#!/usr/bin/env node
/**
 * E2E の録画を束ねる規則（e2e/har-merge.js）と、部分録画の判定（e2e/global-setup.js）を
 * 固定の入力で確かめる（ADR-0077）。
 *
 * どれも壊れると「PRゲートが録画外で abort して大量に落ちる」か「録画が静かに痩せる」
 * かのどちらかで、原因が録画の中身に埋もれて見つけにくい。実際の E2E・本番には依存しない。
 */

import { canonicalUrl, harKey, mergeHarLogs } from "../../e2e/har-merge.js";
import { isPartialRun } from "../../e2e/global-setup.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// --- in.(...) の並びを揃える（フロントが非同期応答の到着順で組み立てるため）
const base = "https://x.supabase.co/rest/v1/race_entries?select=race_id";
check(
  "in-list の並びが違っても同じURLになる",
  canonicalUrl(`${base}&race_id=in.%28b%2Ca%29`),
  canonicalUrl(`${base}&race_id=in.%28a%2Cb%29`),
);
check(
  "in-list が無ければ元の文字列のまま",
  canonicalUrl(`${base}&race_id=eq.a`),
  `${base}&race_id=eq.a`,
);
check(
  "引用符を含む in-list は触らない（値にカンマを含みうる）",
  canonicalUrl(`${base}&name=in.%28%22b%2Cc%22%2C%22a%22%29`),
  `${base}&name=in.%28%22b%2Cc%22%2C%22a%22%29`,
);

// --- 束ね方
const entry = (url, status, text, at) => ({
  startedDateTime: at,
  request: { method: "GET", url, headers: [{ name: "apikey", value: "k" }] },
  response: {
    status,
    headers: [{ name: "content-type", value: "application/json" }],
    content:
      text === undefined
        ? { mimeType: "application/json" }
        : { mimeType: "application/json", text },
  },
});
const u = "https://x.supabase.co/rest/v1/t?select=*";
const merged = mergeHarLogs([
  {
    entries: [
      entry(u, 500, "{}", "2026-01-01T00:00:00Z"),
      entry(u, 200, "[1]", "2026-01-01T00:00:01Z"),
      entry(`${u}&a=eq.1`, 200, undefined, "2026-01-01T00:00:00Z"),
      entry(`${u}&a=eq.1`, 200, "[2]", "2026-01-01T00:00:02Z"),
      entry(
        "http://localhost:41234/api/races/today",
        200,
        "[]",
        "2026-01-01T00:00:00Z",
      ),
    ],
  },
]);
const byUrl = Object.fromEntries(
  merged.har.log.entries.map((e) => [e.request.url, e]),
);
check("5xx より成功した応答を残す", byUrl[u]?.response.status, 200);
check(
  "本文が欠けた応答は捨て、完全なものを残す",
  byUrl[`${u}&a=eq.1`]?.response.content.text,
  "[2]",
);
check(
  "ローカルのポートはプレースホルダにする",
  Object.keys(byUrl).includes("http://localhost:0/api/races/today"),
  true,
);
check(
  "リクエストヘッダー（apikey 等）は残さない",
  merged.har.log.entries.every((e) => e.request.headers.length === 0),
  true,
);
check(
  "キーはメソッド + URL + POST本文",
  harKey("POST", "u", '{"a":1}'),
  'POST u {"a":1}',
);

// --- 部分録画の判定（部分録画で全体を置き換えると、走らせていないテストの応答が消える）
const argv = (...args) => ["node", "playwright", "test", ...args];
check("引数なしは全体", isPartialRun(argv()), false);
check("--workers=3 は全体", isPartialRun(argv("--workers=3")), false);
check("--workers 3 は全体", isPartialRun(argv("--workers", "3")), false);
check("spec 指定は部分", isPartialRun(argv("e2e/layout.spec.js")), true);
check("-g は部分", isPartialRun(argv("-g", "x")), true);
check("--project は部分", isPartialRun(argv("--project=smoke")), true);
check(
  "値を取らないフラグの後の spec 指定も部分",
  isPartialRun(argv("--headed", "e2e/a.spec.js")),
  true,
);

if (failures.length > 0) {
  console.error(
    `E2E 録画の規則が壊れています（${failures.length}/${checked}）:`,
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`OK: E2E 録画の規則 ${checked}件`);
