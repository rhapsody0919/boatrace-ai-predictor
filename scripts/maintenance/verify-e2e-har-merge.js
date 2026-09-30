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
import { countResults, judgeAdoption, scheduleGate } from "./e2e-recording.js";
import { summarize, toMarkdown, MARKER } from "./report-e2e-passthrough.js";

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

// --- 定期実行の起動判定（今日の採用済みは空振り・遅すぎる起動は撮らない）
const jst = (s) => new Date(`${s}+09:00`);
const adoptedAt = (s) => ({
  tag: "e2e-recording-x",
  recordedAt: jst(s).toISOString(),
});
check(
  "今日（JST）の録画を採用済みなら撮らない",
  scheduleGate(jst("2026-09-30T12:47:00"), adoptedAt("2026-09-30T10:30:00"))
    .run,
  false,
);
check(
  "JST の日付で比べる（UTC では前日の 00:30 JST 録画も今日扱い）",
  scheduleGate(jst("2026-09-30T10:23:00"), adoptedAt("2026-09-30T00:30:00"))
    .run,
  false,
);
check(
  "前日の録画なら撮る",
  scheduleGate(jst("2026-09-30T10:23:00"), adoptedAt("2026-09-29T15:04:00"))
    .run,
  true,
);
check(
  "JST 18時台はまだ撮る",
  scheduleGate(jst("2026-09-30T18:59:00"), adoptedAt("2026-09-29T15:04:00"))
    .run,
  true,
);
check(
  "JST 19時以降の起動は撮らない",
  scheduleGate(jst("2026-09-30T19:00:00"), adoptedAt("2026-09-29T15:04:00"))
    .run,
  false,
);
check(
  "ポインタが無くても判定できる",
  scheduleGate(jst("2026-09-30T10:23:00"), null).run,
  true,
);

check(
  "採用済みでの空振りは通知しない・遅れて撮れなかったときは通知する",
  [
    scheduleGate(jst("2026-09-30T12:47:00"), adoptedAt("2026-09-30T10:30:00"))
      .notify,
    scheduleGate(jst("2026-09-30T19:30:00"), adoptedAt("2026-09-29T15:04:00"))
      .notify,
  ],
  [false, true],
);

// --- 自動撮り直しの採用判定（全件通過・skip が増えていない）
const report = (statuses) => ({
  suites: [
    {
      title: "a.spec.js",
      specs: statuses.map((status, i) => ({
        title: `t${i}`,
        tests: [{ status }],
      })),
    },
  ],
});
const counts = countResults(
  report(["expected", "skipped", "unexpected", "flaky"]),
);
check("件数の数え方（flaky は失敗に数えない）", counts, {
  tests: 4,
  skipped: 1,
  failed: 1,
  flaky: 1,
  errors: 0,
});
check(
  "全件通過・skip 同数なら採用",
  judgeAdoption({ tests: 10, skipped: 1, failed: 0, errors: 0 }, { skipped: 1 })
    .adopt,
  true,
);
check(
  "skip が増えたら不採用",
  judgeAdoption({ tests: 10, skipped: 2, failed: 0, errors: 0 }, { skipped: 1 })
    .adopt,
  false,
);
check(
  "失敗があれば不採用",
  judgeAdoption({ tests: 10, skipped: 0, failed: 1, errors: 0 }, { skipped: 5 })
    .adopt,
  false,
);
check(
  "1件も走っていなければ不採用",
  judgeAdoption({ tests: 0, skipped: 0, failed: 0, errors: 0 }, null).adopt,
  false,
);
check(
  "現行の録画が無ければ skip は比べない",
  judgeAdoption({ tests: 10, skipped: 3, failed: 0, errors: 0 }, null).adopt,
  true,
);

check(
  "レポートに問題（途中停止・プロジェクト0件）があれば不採用",
  judgeAdoption({ tests: 10, skipped: 0, failed: 0, errors: 0 }, null, ["x"])
    .adopt,
  false,
);

// --- 素通し一覧（黙って本番依存に戻らないよう、PR に必ず出す）
const rows = summarize([
  { method: "GET", url: "/rest/v1/a", test: "x", project: "smoke" },
  { method: "GET", url: "/rest/v1/a", test: "y", project: "smoke" },
  { method: "GET", url: "/rest/v1/a", test: "x", project: "smoke" },
  { method: "POST", url: "/rest/v1/rpc/b", test: "z", project: "layout-wide" },
]);
check("同じ通信は1行にまとめ、テストを重複なく並べる", rows[0].tests, [
  "[smoke] x",
  "[smoke] y",
]);
check("通信の種類数", rows.length, 2);
check(
  "0件でも目印付きで出す（PRコメントを更新できるように）",
  toMarkdown([]).startsWith(MARKER),
  true,
);
check(
  "E2E が走らなかったときは 0件 と書かない",
  toMarkdown([], { ran: false }).includes("0件"),
  false,
);
check(
  "素通しがあれば URL を表に出す",
  toMarkdown(rows).includes("/rest/v1/rpc/b"),
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
