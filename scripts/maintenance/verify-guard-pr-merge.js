#!/usr/bin/env node
/**
 * guard-pr-merge.js の判定と、保護対象パスの定義が壊れていないことを検査する。
 *
 * このガード自体が壊れても誰も気づかない（素通しするだけで、エラーも出ない）ため、
 * 純関数として切り出した判定を固定の入力で検証する。外部ネットワーク・実DBには触らない。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deletesBranch,
  extractExplicitPrNumber,
  findWorktreePath,
  judgeChecks,
  judgeWorktree,
} from "./guard-pr-merge.js";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok)
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
}

// --- PR番号の抽出 ---
check("番号を明示", extractExplicitPrNumber("gh pr merge 123 --merge"), "123");
check("番号なし", extractExplicitPrNumber("gh pr merge --merge"), null);
// ghは位置引数の位置を問わない。先頭だけ見ると番号を取り逃がし、カレントブランチの
// 別のPRのチェック結果で判定してしまう。
check(
  "オプションが先",
  extractExplicitPrNumber("gh pr merge --merge 123"),
  "123",
);
check(
  "値を取るオプションの値を位置引数と読まない",
  extractExplicitPrNumber('gh pr merge -b "fix 42" 123 --merge'),
  "123",
);
check(
  "値をイコールで渡す形",
  extractExplicitPrNumber("gh pr merge --body=text 123"),
  "123",
);
check(
  "値を取らないオプションは飛ばすだけ",
  extractExplicitPrNumber("gh pr merge --admin --squash 77"),
  "77",
);
check("別コマンド", extractExplicitPrNumber("gh pr view 123"), null);
check(
  "前に別コマンド",
  extractExplicitPrNumber("cd /tmp && gh pr merge 99 -m"),
  "99",
);
check(
  "番号の直後にハイフン",
  extractExplicitPrNumber("gh pr merge 45-x"),
  null,
);
check(
  "URL指定",
  extractExplicitPrNumber(
    "gh pr merge https://github.com/rhapsody0919/boatrace-ai-predictor/pull/777 --merge",
  ),
  "777",
);
check(
  "URL指定(末尾スラッシュ)",
  extractExplicitPrNumber(
    "gh pr merge https://github.com/o/r/pull/12/ --merge",
  ),
  "12",
);
check(
  "ブランチ名指定",
  extractExplicitPrNumber("gh pr merge feature/x --merge"),
  null,
);

// --- --delete-branch の検出 ---
check("長い形式", deletesBranch("gh pr merge 1 --merge --delete-branch"), true);
check("短い形式", deletesBranch("gh pr merge 1 --merge -d"), true);
check("末尾の短い形式", deletesBranch("gh pr merge 1 -d"), true);
check("指定なし", deletesBranch("gh pr merge 1 --merge"), false);
// pflag はショートハンドの結合を許す。-d 単独だけを見ると取りこぼす。
check("結合ショートハンド(-md)", deletesBranch("gh pr merge 1 -md"), true);
check("結合ショートハンド(-dm)", deletesBranch("gh pr merge 1 -dm"), true);
check("dを含まない結合は対象外", deletesBranch("gh pr merge 1 -sa"), false);
check(
  "長いオプションを誤検出しない",
  deletesBranch("gh pr merge 1 --squash"),
  false,
);
check(
  "-dで始まる別オプション",
  deletesBranch("gh pr merge 1 --dry-run"),
  false,
);
check(
  "別の語に含まれる-d",
  deletesBranch("gh pr merge 1 --merge --admin"),
  false,
);

// --- worktree の探索 ---
const porcelain = [
  "worktree /repo",
  "HEAD abc",
  "branch refs/heads/master",
  "",
  "worktree /repo/.claude/worktrees/feat-a",
  "HEAD def",
  "branch refs/heads/feature/a",
  "",
  "worktree /repo/.claude/worktrees/detached",
  "HEAD 999",
  "detached",
].join("\n");
check(
  "該当あり",
  findWorktreePath(porcelain, "feature/a"),
  "/repo/.claude/worktrees/feat-a",
);
check("master", findWorktreePath(porcelain, "master"), "/repo");
check("該当なし", findWorktreePath(porcelain, "feature/none"), null);
check(
  "detachedを誤って拾わない",
  findWorktreePath(porcelain, "detached"),
  null,
);

// --- チェック結果の判定（止まる側も必ず確かめる） ---
const green = [
  { name: "verify", state: "SUCCESS" },
  { name: "e2e", state: "SUCCESS" },
];
check("全部緑なら止めない", judgeChecks("1", green), null);
check(
  "verifyが落ちていれば止める",
  judgeChecks("1", [{ name: "verify", state: "FAILURE" }])?.decision,
  "deny",
);
check(
  "verifyが実行中なら待たせる",
  judgeChecks("1", [{ name: "verify", state: "IN_PROGRESS" }])?.decision,
  "ask",
);
check(
  "verifyの結果がまだ無ければ待たせる",
  judgeChecks("1", [{ name: "e2e", state: "SUCCESS" }])?.decision,
  "ask",
);
check(
  "verifyがSKIPPEDなら止める",
  judgeChecks("1", [{ name: "verify", state: "SKIPPED" }])?.decision,
  "deny",
);
check(
  "e2eだけ赤なら確認を挟む（止めはしない）",
  judgeChecks("1", [
    { name: "verify", state: "SUCCESS" },
    { name: "e2e", state: "FAILURE" },
  ])?.decision,
  "ask",
);
check(
  "e2eが実行中なら何もしない(PENDING)",
  judgeChecks("1", [
    { name: "verify", state: "SUCCESS" },
    { name: "e2e", state: "PENDING" },
  ]),
  null,
);
// 実際のPR #843 が e2e=IN_PROGRESS で、PENDINGしか除外していなかったため
// 「e2eが赤い」扱いで確認を求めてしまった（2026-09-25、実データで発覚）
check(
  "e2eが実行中なら何もしない(IN_PROGRESS)",
  judgeChecks("1", [
    { name: "verify", state: "SUCCESS" },
    { name: "e2e", state: "IN_PROGRESS" },
  ]),
  null,
);
check(
  "e2eが実行中なら何もしない(QUEUED)",
  judgeChecks("1", [
    { name: "verify", state: "SUCCESS" },
    { name: "e2e", state: "QUEUED" },
  ]),
  null,
);
check("配列でなければ判断しない", judgeChecks("1", null), null);
check(
  "止める理由にPR番号が入る",
  judgeChecks("42", [{ name: "verify", state: "FAILURE" }]).reason.includes(
    "#42",
  ),
  true,
);

// --- worktree の中身による判定 ---
check("空なら止めない", judgeWorktree("/w", [], 0), null);
check(
  "取り直しの効かないデータがあれば止める",
  judgeWorktree("/w", ["data/kb-archive"], 0)?.decision,
  "deny",
);
check("未コミットがあれば止める", judgeWorktree("/w", [], 3)?.decision, "deny");
check(
  "止める理由にworktreeのパスが入る",
  judgeWorktree("/w/x", ["data/ml"], 0).reason.includes("/w/x"),
  true,
);

// --- 保護対象パスが .gitignore と一致しているか ---
// PRECIOUS_PATHS にあるのに .gitignore に無いと、gitに入ってしまい定義の前提が崩れる。
const gitignore = readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const ignored = new Set(
  gitignore
    .split("\n")
    .map((l) => l.trim().replace(/\/$/, ""))
    .filter((l) => l && !l.startsWith("#")),
);
for (const p of PRECIOUS_PATHS) {
  if (!ignored.has(p))
    failures.push(`PRECIOUS_PATHS の ${p} が .gitignore に無い`);
}
if (PRECIOUS_PATHS.length !== new Set(PRECIOUS_PATHS).size) {
  failures.push("PRECIOUS_PATHS に重複がある");
}

if (failures.length > 0) {
  console.error("NG: guard-pr-merge の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `OK: guard-pr-merge の判定${checked}件と保護対象パス${PRECIOUS_PATHS.length}件を検証`,
);
