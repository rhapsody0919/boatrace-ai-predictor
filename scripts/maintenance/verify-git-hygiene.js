#!/usr/bin/env node
/**
 * check-git-hygiene.js / check-worktrees.js の判定を検証する。
 *
 * どちらもセッション開始時と棚卸しでしか動かず、壊れても「何も言わなくなる」だけで
 * 誰も気づかない。gitの出力の読み取りと分類を純関数として固定の入力で検証する。
 * 実リポジトリの状態・ネットワークには依存しない。
 */

import {
  parseBehindCount,
  parseWorktrees,
  selectManagedWorktrees,
} from "./check-git-hygiene.js";
import { classify } from "./check-worktrees.js";

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

// --- behind の読み取り ---
check("遅れあり", parseBehindCount("0\t23"), 23);
check("遅れなし", parseBehindCount("0\t0"), 0);
check("進んでいる", parseBehindCount("5\t0"), 0);
check("両方", parseBehindCount("2\t7"), 7);
check("空", parseBehindCount(""), null);
check("null", parseBehindCount(null), null);
check("想定外の形式", parseBehindCount("abc"), null);

// --- worktree 一覧の読み取り ---
const porcelain = [
  "worktree /repo",
  "HEAD aaa",
  "branch refs/heads/master",
  "",
  "worktree /repo/.claude/worktrees/feat-a",
  "HEAD bbb",
  "branch refs/heads/feature/a",
  "",
  "worktree /repo/.claude/worktrees/detached",
  "HEAD ccc",
  "detached",
].join("\n");
check("本数", parseWorktrees(porcelain).length, 3);
check("メイン", parseWorktrees(porcelain)[0], {
  path: "/repo",
  branch: "master",
  locked: null,
});
check(
  "スラッシュを含むブランチ名",
  parseWorktrees(porcelain)[1].branch,
  "feature/a",
);
check("detachedはbranchがnull", parseWorktrees(porcelain)[2].branch, null);
check("空文字", parseWorktrees("").length, 0);

// --- 棚卸し対象の絞り込み ---
// メインの作業ツリーは消す対象ではない。worktree の中から走らせたときに
// メインが「別のworktree」に見えて誤検知した実例がある（2026-09-25）。
const listed = parseWorktrees(porcelain);
check(
  "メインから実行: メインを除く",
  selectManagedWorktrees(listed, "/repo").map((w) => w.path),
  ["/repo/.claude/worktrees/feat-a", "/repo/.claude/worktrees/detached"],
);
check(
  "worktreeの中から実行: メインも自分も除く",
  selectManagedWorktrees(listed, "/repo/.claude/worktrees/feat-a").map(
    (w) => w.path,
  ),
  ["/repo/.claude/worktrees/detached"],
);
check("空の一覧", selectManagedWorktrees([], "/repo"), []);
check(
  "メインだけのリポジトリ",
  selectManagedWorktrees([{ path: "/repo", branch: "master" }], "/repo"),
  [],
);

// --- ロックの読み取り ---
// Claude Code は作業中の worktree をロックする。2026-09-25、この判定が無かったため
// 「片付けてよい」に他セッションの作業ツリーが2本並び、git側のロックだけが削除を止めた。
const lockedPorcelain = [
  "worktree /repo",
  "HEAD aaa",
  "branch refs/heads/master",
  "",
  "worktree /repo/.claude/worktrees/in-use",
  "HEAD bbb",
  "branch refs/heads/fix/x",
  "locked claude session in-use (pid 69628 start Fri Sep 25 05:52:06 2026)",
  "",
  "worktree /repo/.claude/worktrees/locked-no-reason",
  "HEAD ccc",
  "branch refs/heads/fix/y",
  "locked",
  "",
  "worktree /repo/.claude/worktrees/free",
  "HEAD ddd",
  "branch refs/heads/fix/z",
].join("\n");
const lockedList = parseWorktrees(lockedPorcelain);
check(
  "ロックの理由を拾う",
  lockedList[1].locked,
  "claude session in-use (pid 69628 start Fri Sep 25 05:52:06 2026)",
);
check("理由なしのロック", lockedList[2].locked, "(理由の記載なし)");
check("ロックされていない", lockedList[3].locked, null);
check("ロック行でブランチを壊さない", lockedList[1].branch, "fix/x");

// --- worktree の分類 ---
check(
  "マージ済みで空なら片付けてよい",
  classify({ merged: true, dirtyCount: 0, precious: [] }),
  "removable",
);
check(
  "未マージは作業中",
  classify({ merged: false, dirtyCount: 0, precious: [] }),
  "active",
);
check(
  "未コミットがあれば触らない",
  classify({ merged: true, dirtyCount: 3, precious: [] }),
  "blocked",
);
check(
  "データがあればマージ済みでも触らない",
  classify({ merged: true, dirtyCount: 0, precious: ["data/kb-archive"] }),
  "blocked",
);
check(
  "未マージ＋データも触らない",
  classify({ merged: false, dirtyCount: 0, precious: ["data/ml"] }),
  "blocked",
);
// ロックは他セッションが使用中の印なので、マージ済みで空でも片付け対象にしない
check(
  "ロック中はマージ済みでも片付けない",
  classify({
    merged: true,
    dirtyCount: 0,
    precious: [],
    locked: "claude session x (pid 1)",
  }),
  "locked",
);
check(
  "ロックは未コミットより優先して表示する",
  classify({
    merged: true,
    dirtyCount: 5,
    precious: ["data/ml"],
    locked: "claude session y (pid 2)",
  }),
  "locked",
);
check(
  "lockedがnullなら従来通り",
  classify({ merged: true, dirtyCount: 0, precious: [], locked: null }),
  "removable",
);

if (failures.length > 0) {
  console.error("NG: git衛生チェックの検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: git衛生チェックの判定${checked}件を検証`);
