#!/usr/bin/env node
/**
 * check-worktrees.js が、稼働中セッションの worktree を「片付けてよい」に
 * 分類しないことを検証する。
 *
 * 2026-09-28、作業開始直後でコミット前の worktree（ブランチ先頭 = origin/master）が
 * 「ahead=0 なのでマージ済み」と判定され、稼働中セッション4本
 * （reverent-kilby-97d67e / kind-taussig-c5400d / distracted-archimedes-a67048 /
 * wizardly-tereshkova-f90f80）に `git worktree remove --force` が提示された。
 * デスクトップアプリのセッションは git のロックを掛けないため、ロック判定でも止まらなかった。
 *
 * 固定の入力で純関数だけを検証する。実リポジトリ・gh・lsof には依存しない。
 */

import {
  classify,
  hasProcessInside,
  isMergedByPr,
  isRecentlyActive,
  parseCwdPaths,
} from "./check-worktrees.js";

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

const MASTER_TIP = "a".repeat(40);
const PR_HEAD = "b".repeat(40);
const WT = "/repo/.claude/worktrees/reverent-kilby-97d67e";

const mergedPrs = [
  { headRefName: "fix/done", headRefOid: PR_HEAD },
  { headRefName: "fix/squashed", headRefOid: "c".repeat(40) },
];

// --- マージ判定: ahead=0 だけではマージ済みにしない ---
check(
  "再現: 作業開始直後（先頭=origin/master、PRなし）はマージ済みでない",
  isMergedByPr({
    branch: "claude/reverent-kilby-97d67e",
    tip: MASTER_TIP,
    mergedPrs,
  }),
  false,
);
check(
  "MERGEDのPRのheadと先頭が一致すればマージ済み",
  isMergedByPr({ branch: "fix/done", tip: PR_HEAD, mergedPrs }),
  true,
);
check(
  "squashマージ（先頭がmasterの祖先でない）もPRのheadで拾う",
  isMergedByPr({ branch: "fix/squashed", tip: "c".repeat(40), mergedPrs }),
  true,
);
check(
  "マージ後にローカルでコミットを積んだものはマージ済みでない",
  isMergedByPr({ branch: "fix/done", tip: "d".repeat(40), mergedPrs }),
  false,
);
check(
  "同名ブランチを作り直したもの（先頭が違う）はマージ済みでない",
  isMergedByPr({ branch: "fix/done", tip: MASTER_TIP, mergedPrs }),
  false,
);
check(
  "PR一覧を取れなければマージ済みにしない",
  isMergedByPr({ branch: "fix/done", tip: PR_HEAD, mergedPrs: null }),
  false,
);
check(
  "detachedはマージ済みにしない",
  isMergedByPr({ branch: null, tip: PR_HEAD, mergedPrs }),
  false,
);

// --- プロセスの cwd ---
const lsofOutput = [
  "p123",
  "fcwd",
  `n${WT}`,
  "p456",
  "fcwd",
  "n/repo/.claude/worktrees/other/sns-video-studio/remotion",
  "p789",
  "fcwd",
  "n/repo/.claude/worktrees/reverent-kilby-97d67e-2",
].join("\n");
const cwds = parseCwdPaths(lsofOutput);
check("cwdを読み取る", cwds, [
  WT,
  "/repo/.claude/worktrees/other/sns-video-studio/remotion",
  "/repo/.claude/worktrees/reverent-kilby-97d67e-2",
]);
check("空出力", parseCwdPaths(""), []);
check("worktree直下のプロセスを検出", hasProcessInside(WT, cwds), true);
check(
  "サブディレクトリのプロセスも検出",
  hasProcessInside("/repo/.claude/worktrees/other", cwds),
  true,
);
check(
  "前方一致の別名worktreeを誤検出しない",
  hasProcessInside("/repo/.claude/worktrees/reverent-kilby", cwds),
  false,
);

// --- 直近の操作 ---
const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;
check("1時間前は直近", isRecentlyActive(NOW - HOUR, NOW), true);
check("25時間前は直近でない", isRecentlyActive(NOW - 25 * HOUR, NOW), false);
check("不明は直近でない", isRecentlyActive(null, NOW), false);

// --- 分類 ---
check(
  "再現: 作業開始直後・ロックなし・プロセスなしでも片付け対象にしない",
  classify({
    merged: isMergedByPr({ branch: "x", tip: MASTER_TIP, mergedPrs }),
    dirtyCount: 0,
    precious: [],
    locked: null,
  }),
  "active",
);
check(
  "再現: ロックなしでも中にプロセスがいれば使用中",
  classify({
    merged: true,
    dirtyCount: 0,
    precious: [],
    locked: null,
    inUse: true,
  }),
  "locked",
);
check(
  "マージ済みでも直近に操作があれば片付けない",
  classify({
    merged: true,
    dirtyCount: 0,
    precious: [],
    locked: null,
    recent: true,
  }),
  "recent",
);
check(
  "マージ済み・空・プロセスなし・古いなら片付けてよい",
  classify({
    merged: true,
    dirtyCount: 0,
    precious: [],
    locked: null,
    inUse: false,
    recent: false,
  }),
  "removable",
);
check(
  "未コミットは直近判定より優先",
  classify({
    merged: true,
    dirtyCount: 2,
    precious: [],
    locked: null,
    recent: true,
  }),
  "blocked",
);

if (failures.length > 0) {
  console.error("NG: worktree の使用中判定の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: worktree の使用中判定${checked}件を検証`);
