#!/usr/bin/env node
/**
 * e2e-new-reds-decide.js の判定を固定の入力で確かめる（設計 docs/design/harness-migration/design.md §2）。
 * この判定が壊れると「新しい赤でも Slack が鳴らない」か「同じ赤で毎回鳴る」になり、どちらも黙って続く。
 * 通信・本番・Playwright・gh は使わない。
 */
import {
  BASELINE_SEARCH,
  MAX_LISTED,
  MAX_TEXT,
  baselineCandidates,
  decideNotify,
  noticeText,
} from "./e2e-new-reds-decide.js";

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

const FILE = "e2e/race.spec.js";
const A = `smoke › ${FILE} › 締切前のカード`;
const B = `layout-wide › ${FILE} › AI タブ › 展開が出る`;
const NOW = new Date("2026-11-25T12:00:00Z");
const HOURS_AGO = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();
const d = (input) => decideNotify({ now: NOW, ...input });

// --- 知らせるか ---
check(
  "緑は知らせない",
  d({ failed: false, current: [A], baseline: null }).notify,
  false,
);
check(
  "レポートが無い赤は知らせる",
  d({ failed: true, current: null, baseline: null }).reason,
  "no_report",
);
check(
  "組が欠けたら、基準と同じ赤でも知らせる",
  d({ failed: true, incomplete: true, current: [A], baseline: { keys: [A] } })
    .reason,
  "incomplete",
);
check(
  "試験が通って後の step が落ちたら知らせる",
  d({ failed: true, current: [], baseline: { keys: [A] } }).reason,
  "other_failure",
);
check(
  "基準が無ければ全部新しい赤",
  d({ failed: true, current: [A, B], baseline: null }),
  {
    notify: true,
    reason: "no_baseline",
    fresh: [A, B],
    renotify: [],
    kept: [],
    notifiedAt: { [A]: NOW.toISOString(), [B]: NOW.toISOString() },
  },
);
check(
  "24時間内に知らせた赤だけなら黙り、知らせた時刻を引き継ぐ",
  d({
    failed: true,
    current: [A],
    baseline: { keys: [A, B], notifiedAt: { [A]: HOURS_AGO(3) } },
  }),
  {
    notify: false,
    reason: "same_red",
    fresh: [],
    renotify: [],
    kept: [A],
    notifiedAt: { [A]: HOURS_AGO(3) },
  },
);
check(
  "続いている赤も24時間たてば鳴らし直す",
  d({
    failed: true,
    current: [A],
    baseline: { keys: [A], notifiedAt: { [A]: HOURS_AGO(25) } },
  }),
  {
    notify: true,
    reason: "new_red",
    fresh: [],
    renotify: [A],
    kept: [],
    notifiedAt: { [A]: NOW.toISOString() },
  },
);
check(
  "知らせた時刻の無い続く赤は鳴らす側",
  d({ failed: true, current: [A], baseline: { keys: [A] } }).renotify,
  [A],
);
check(
  "1つでも新しければ鳴らし、知らせて間もない赤は分ける",
  d({
    failed: true,
    current: [A, B],
    baseline: { keys: [A], notifiedAt: { [A]: HOURS_AGO(1) } },
  }),
  {
    notify: true,
    reason: "new_red",
    fresh: [B],
    renotify: [],
    kept: [A],
    notifiedAt: { [A]: HOURS_AGO(1), [B]: NOW.toISOString() },
  },
);
check(
  "基準が空（前は緑）なら今の赤は新しい",
  d({ failed: true, current: [A], baseline: { keys: [] } }).fresh,
  [A],
);

// --- 文: 上限で切り、続く赤の数を書く ---
const many = Array.from({ length: MAX_LISTED + 2 }, (_, i) => `k${i}`);
const text = noticeText({
  reason: "new_red",
  fresh: many,
  renotify: [],
  kept: [A],
});
check("上限の後は件数", text.includes("…ほか 2 件"), true);
check("上限より後の鍵は並べない", text.includes(`k${MAX_LISTED}`), false);
check(
  "知らせた赤の数",
  text.includes("続いている赤（前に知らせた）: 1 件"),
  true,
);
const long = noticeText({
  reason: "new_red",
  fresh: ["x".repeat(MAX_TEXT * 2)],
  renotify: [],
  kept: [],
});
check("文は上限で切る", long.length <= MAX_TEXT + 1, true);

// --- 基準を探す run: 今の run を除き、master・完了だけ、上限まで ---
const runs = [
  { databaseId: 9, headBranch: "master", status: "completed" },
  { databaseId: 8, headBranch: "claude/x", status: "completed" },
  { databaseId: 7, headBranch: "master", status: "in_progress" },
  ...Array.from({ length: BASELINE_SEARCH + 1 }, (_, i) => ({
    databaseId: 6 - i,
    headBranch: "master",
    status: "completed",
  })),
];
check("基準の候補", baselineCandidates(runs, 9), ["6", "5", "4", "3", "2"]);

if (failures.length > 0) {
  console.error(`NG: ${failures.length}/${checked}`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-new-reds の判定 ${checked} 件`);
