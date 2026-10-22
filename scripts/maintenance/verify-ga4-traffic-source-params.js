#!/usr/bin/env node
/**
 * サイトの中から GA4 のセッションの流入元を上書きしないことを検証する（BOA-996）。
 *
 * 崩れると、カスタムイベントのパラメータ（source 等）や内部リンクの utm_* が流入元になり、
 * そのセッションと、同じ人の後の直接の訪問が data_race_table 等の流入元（Unassigned）に化ける。
 * 2026-09 に deep_link_click の source でこれが起き（PR #656 で link_source に改名）、
 * 10/18〜22 も改名前に汚れた15人の直接の訪問が 47 セッション Unassigned に残っていた。
 *
 * 1. trackEvent が予約名のパラメータを gtag に渡さない（ev.params のような動的な引数も含め、入口で止める）
 * 2. src の trackEvent の引数に書いた予約名のキーが無い（入口で落ちる前に、書いた時点で気づく）
 * 3. src・ロケールの文に、サイトの中を指す URL で utm_ を付けたものが無い
 *    （外部の SNS 投稿用の URL は searchParams.set で作るので対象外。snsObservations.js）
 *
 *   node scripts/maintenance/verify-ga4-traffic-source-params.js
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const sent = [];
const errors = [];
globalThis.window = { gtag: (...args) => sent.push(args) };
const origError = console.error;
console.error = (msg) => errors.push(String(msg));
const { trackEvent, GA4_RESERVED_EVENT_PARAMS } =
  await import("../../src/utils/analytics.js");

// 1. 入口の防御
trackEvent("deep_link_click", {
  tab: "motor",
  link_source: "data_race_table",
  source: "data_race_table",
  utm_source: "x",
});
assert.deepEqual(
  sent.at(-1),
  [
    "event",
    "deep_link_click",
    { tab: "motor", link_source: "data_race_table" },
  ],
  "trackEvent が予約名（source・utm_source）を gtag に渡している",
);
assert.ok(
  errors.some((e) => e.includes("source") && e.includes("utm_source")),
  "予約名を落としたときにエラーを出していない",
);
errors.length = 0;
trackEvent("ai_copy", { race_id: "2026-10-22-01-01" });
assert.deepEqual(sent.at(-1), [
  "event",
  "ai_copy",
  { race_id: "2026-10-22-01-01" },
]);
assert.equal(errors.length, 0, "予約名が無いのにエラーを出している");
trackEvent("ai_copy", null);
assert.deepEqual(
  sent.at(-1),
  ["event", "ai_copy", null],
  "params が null で落ちる",
);
console.error = origError;

// 2・3. src の静的検査
const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(jsx?|json)$/.test(f));
const isReserved = (k) =>
  GA4_RESERVED_EVENT_PARAMS.includes(k) || k.startsWith("utm_");
const INTERNAL_UTM =
  /["'`](?:\/(?!\/)|https?:\/\/(?:www\.)?boat-ai\.jp)[^"'`\s]*[?&]utm_[a-z]+=/g;
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

/** trackEvent の第2引数に書いたオブジェクトのキーのうち予約名のもの */
const reservedTrackEventKeys = (text) =>
  [...text.matchAll(/trackEvent\(\s*[^,()]+,\s*\{([^{}]*)\}/g)].flatMap((m) =>
    m[1]
      .split(",")
      .map((p) => p.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/)?.[1])
      .filter((k) => k && isReserved(k))
      .map((key) => ({ key, line: lineOf(text, m.index) })),
  );

// 検査が効いていること（効かないと 2・3 が常に通る）
assert.deepEqual(
  reservedTrackEventKeys('trackEvent("x", { tab, source: "a" })').map(
    (r) => r.key,
  ),
  ["source"],
);
assert.deepEqual(
  reservedTrackEventKeys(
    'trackEvent("x", {\n  tab_id: id,\n  from: a?.id ?? null,\n  medium\n})',
  ).map((r) => r.key),
  ["medium"],
  "値の id をキーと誤認している、または shorthand のキーを見落としている",
);
assert.ok('to="/race/1?tab=a&utm_source=data_race_table"'.match(INTERNAL_UTM));
assert.ok("`https://www.boat-ai.jp/today?utm_source=x`".match(INTERNAL_UTM));
assert.ok(!'"https://example.com/?utm_source=x"'.match(INTERNAL_UTM));

const failures = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const { key, line } of reservedTrackEventKeys(text))
    failures.push(`${file}:${line} trackEvent のパラメータ名 ${key}`);
  for (const m of text.matchAll(INTERNAL_UTM))
    failures.push(
      `${file}:${lineOf(text, m.index)} サイトの中を指す URL に utm_: ${m[0]}`,
    );
}

if (failures.length > 0) {
  console.error(
    `❌ GA4 の流入元を上書きするものが src にあります（${failures.length}件）\n` +
      failures.map((f) => `  - ${f}`).join("\n"),
  );
  process.exit(1);
}
console.log(
  `✅ verify-ga4-traffic-source-params: trackEvent が予約名を送らない・src ${files.length} ファイルに予約名のパラメータと内部リンクの utm_ が無い`,
);
