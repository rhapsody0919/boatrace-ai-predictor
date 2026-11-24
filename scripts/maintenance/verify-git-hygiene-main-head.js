#!/usr/bin/env node
/**
 * verify-git-hygiene-main-head.js — メインの作業ツリーが master から外れて古い版にいるときに、
 * セッションの始めの確認（check-git-hygiene.js の mainHeadLines）が警告を出すか。
 *
 * 2026-11-24: メインの作業ツリーが master から外れた ef0b56f93 のままで、.worktreeinclude の直し（#3323）が
 * 新しい worktree に届かず、作り手が .env.local の写しで6回止まった。ローカルの master の遅れしか見ていなかった。
 */
import { mainHeadLines } from "./check-git-hygiene.js";

let failures = 0;
const check = (label, pass) => {
  console.log(`${pass ? "✅" : "❌"} ${label}`);
  if (!pass) failures += 1;
};

const detached = mainHeadLines({ mainPath: "/repo", branch: "", headBehind: 12 });
check("master から外れて古いと警告を出す", detached.length > 0 && detached[0].includes("12 コミット"));
check("戻す手順（checkout master と ff-only）を添える", detached.some((l) => l.includes("checkout master") && l.includes("--ff-only")));
const otherBranch = mainHeadLines({ mainPath: "/repo", branch: "claude/x", headBehind: 3 });
check("別の枝で古いときも警告を出す", otherBranch.length > 0 && otherBranch[0].includes("claude/x"));
check("master にいれば出さない（遅れは behindLines が見る）", mainHeadLines({ mainPath: "/repo", branch: "master", headBehind: 5 }).length === 0);
check("最新なら出さない", mainHeadLines({ mainPath: "/repo", branch: "", headBehind: 0 }).length === 0);
check("数えられなければ出さない", mainHeadLines({ mainPath: "/repo", branch: "", headBehind: null }).length === 0);

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
