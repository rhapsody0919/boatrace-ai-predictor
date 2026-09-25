#!/usr/bin/env node
/**
 * PreToolUse(Bash): `gh pr merge` を2つの観点で検査する。
 *
 * 1. 品質ゲート（Quality Gates の verify ジョブ）が緑でないPRのマージを止める。
 *
 *    本来はGitHubのブランチ保護で止めたいが、このリポジトリでは使えない。
 *    必須ステータスチェックはPRのマージだけでなくブランチへの直接pushにも効き、
 *    scrape系・train系・update-sitemap の8ワークフローが GITHUB_TOKEN で master へ
 *    直接 push しているため、全部落ちる。GitHub Actions をバイパス対象に指定できるのは
 *    Organization 所有のリポジトリだけで、個人リポジトリでは
 *    "Actor GitHub Actions integration must be part of the ruleset source or owner organization"
 *    で拒否される（2026-09-25実測）。
 *    そこでマージを実行する側（＝このリポジトリでは実質すべてClaude）をローカルで止める。
 *
 * 2. `--delete-branch` で worktree ごと消える、取り直しの効かないデータを守る。
 *
 *    gh は「ローカルとリモートのブランチを削除する」としか説明しないが、実際には
 *    そのブランチの worktree ディレクトリごと削除する。しかも worktree の中から
 *    実行した場合は止まり、外から実行した場合だけ消えるという直感に反する挙動。
 *    2026-09-25に、これで数夜かけて取得したK/Bファイル約2,730日分を失っている。
 *
 * 判定できない場合（PR番号が読めない、ghが応答しない等）は素通しする。
 * 止めるべきものを見逃す方が、止めるべきでないものを止めて作業を詰まらせるより軽いため。
 *
 * 検証: scripts/maintenance/verify-guard-pr-merge.js
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";

const REQUIRED_CHECK = "verify";
/** まだ結果が出ていない状態。落ちたのではないので「待て」に倒す。 */
const RUNNING_STATES = new Set([
  "PENDING",
  "QUEUED",
  "IN_PROGRESS",
  "WAITING",
  "REQUESTED",
]);
const SUBPROCESS_TIMEOUT_MS = 15000;
/** 値を取るオプション。次のトークンは値であって位置引数ではない。 */
const VALUE_OPTIONS = new Set([
  "-b",
  "--body",
  "-F",
  "--body-file",
  "-t",
  "--subject",
  "--match-head-commit",
  "--author-email",
]);

/**
 * このスクリプトが置かれているリポジトリのルート。
 * フックのカレントディレクトリは保証されない（$CLAUDE_PROJECT_DIR が渡されるのはそのため）。
 * cwd を指定しないと gh も git もリポジトリ外で走って失敗し、ゲートが静かに素通しになる。
 */
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/**
 * 外部コマンドを1回だけ実行する。失敗・タイムアウトは null を返す（呼び出し側で素通しする）。
 */
function run(file, args, cwd = repoRoot) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      timeout: SUBPROCESS_TIMEOUT_MS,
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const gh = (args) => run("gh", args);
const gitIn = (args, cwd) => run("git", args, cwd);

/**
 * `gh pr merge 123 --merge` の 123。番号が無ければ null（呼び出し側が現在のブランチのPRを引く）。
 *
 * gh は位置引数の位置を問わないので `gh pr merge --merge 123` も有効。先頭だけ見ると
 * 番号を取り逃がし、カレントブランチの別のPRのチェック結果で判定してしまう。
 * 番号・PRのURL・ブランチ名のいずれも来るので、番号かURLのときだけ返す。
 */
export function extractExplicitPrNumber(command) {
  const m = command.match(/\bgh\s+pr\s+merge\b([^\n;&|]*)/);
  if (!m) return null;
  // 引用符で囲まれた値は中に空白を含む（`-b "fix 42"`）。そのまま空白で割ると
  // 値の断片を位置引数と読んでしまうので、1トークンに潰してから割る。
  const tokens = m[1]
    .replace(/"[^"]*"|'[^']*'/g, "__quoted__")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      const [name] = token.split("=");
      // `-b text` のように値が次のトークンに来る場合、その値を位置引数と読まない
      if (VALUE_OPTIONS.has(name) && !token.includes("=")) i += 1;
      continue;
    }
    const byNumber = token.match(/^(\d+)$/);
    if (byNumber) return byNumber[1];
    const byUrl = token.match(/^https?:\/\/\S*?\/pull\/(\d+)\/?$/);
    if (byUrl) return byUrl[1];
    return null; // ブランチ名など、番号に解決できない位置引数
  }
  return null;
}

/** コマンドが worktree ごと消す形の `--delete-branch` / `-d` を含むか。 */
export function deletesBranch(command) {
  if (/--delete-branch\b/.test(command)) return true;
  // pflag はショートハンドの結合を許す（-md は -m -d と同じ）。`-d` 単独だけを見ると
  // 取りこぼし、worktree ごと消えるのを防げない。d を含むショートハンドは -d だけ。
  return /(?:^|\s)-[a-zA-Z]*d[a-zA-Z]*(?=\s|$)/.test(command);
}

/** `git worktree list --porcelain` の出力から、そのブランチの作業ツリーのパスを探す。 */
export function findWorktreePath(porcelain, branch) {
  let current = null;
  for (const line of porcelain.split("\n")) {
    if (line.startsWith("worktree ")) current = line.slice("worktree ".length);
    else if (line === `branch refs/heads/${branch}`) return current;
  }
  return null;
}

/** hookの応答。allow は何も出さずに終える（素通し）。 */
function respond(decision, reason) {
  if (decision !== "allow") {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: decision,
          permissionDecisionReason: reason,
        },
      }),
    );
  }
  process.exit(0);
}

/**
 * チェック一覧から判定する。止まる側も検証できるよう、ghの呼び出しとは分けてある
 * （「素通しだけ確かめて、止まることを一度も確かめていない」ゲートにしないため）。
 * 止める必要が無ければ null。
 */
export function judgeChecks(pr, checks) {
  if (!Array.isArray(checks)) return null;

  const verify = checks.find((c) => c.name === REQUIRED_CHECK);
  if (!verify) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} に品質ゲート（${REQUIRED_CHECK}）の結果がまだありません。` +
        `Quality Gates が走り終わるのを待つか、待たない理由を述べてからマージしてください。`,
    };
  }
  if (RUNNING_STATES.has(verify.state)) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} の品質ゲート（${REQUIRED_CHECK}）はまだ実行中です（${verify.state}）。` +
        `結果が出てからマージしてください（実測で1分半程度）。`,
    };
  }
  if (verify.state !== "SUCCESS") {
    return {
      decision: "deny",
      reason:
        `PR #${pr} の品質ゲート（${REQUIRED_CHECK}）が ${verify.state} です。` +
        `verify は verify-registry.json の tier=ci をまとめて実行しており、マイグレーション番号の重複・` +
        `ADR番号の重複・sitemap登録漏れ等を検知します。内容を確認して直してからマージしてください` +
        `（gh pr checks ${pr}）。`,
    };
  }
  const e2e = checks.find((c) => c.name === "e2e");
  if (e2e && e2e.state !== "SUCCESS" && !RUNNING_STATES.has(e2e.state)) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} の e2e が ${e2e.state} です。e2eは本番Supabaseに直結していてDBの状態で落ちることが` +
        `あるため自動では止めませんが、コードの退行でないことを確認してからマージしてください。`,
    };
  }
  return null;
}

function checkQualityGate(pr) {
  const raw = gh(["pr", "checks", pr, "--json", "name,state"]);
  if (!raw) return null;
  try {
    return judgeChecks(pr, JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * worktree の中身から、--delete-branch を止めるべきか判定する。
 * こちらも実ファイルシステムの走査とは分けてある。止める必要が無ければ null。
 */
export function judgeWorktree(worktreePath, precious, dirtyCount) {
  if (precious.length === 0 && dirtyCount === 0) return null;
  const details = [];
  if (precious.length > 0) {
    details.push(
      `gitに入らない取り直しの効かないデータがあります: ${precious.join(", ")}`,
    );
  }
  if (dirtyCount > 0) {
    details.push(
      `未コミットの変更が${dirtyCount}件あります（他セッションの作業中かもしれません）`,
    );
  }
  return {
    decision: "deny",
    reason:
      `--delete-branch はブランチだけでなく worktree ディレクトリ（${worktreePath}）ごと削除します。` +
      `${details.join(" / ")}。先に中身を退避するか、--delete-branch を外してマージしてから` +
      `worktree を個別に片付けてください。`,
  };
}

function checkWorktreeData(pr, command) {
  if (!deletesBranch(command)) return null;
  const branch = gh([
    "pr",
    "view",
    pr,
    "--json",
    "headRefName",
    "-q",
    ".headRefName",
  ]);
  if (!branch) return null;
  const porcelain = gitIn(["worktree", "list", "--porcelain"]);
  if (!porcelain) return null;
  const wt = findWorktreePath(porcelain, branch);
  if (!wt) return null;

  const precious = PRECIOUS_PATHS.filter((p) => existsSync(path.join(wt, p)));
  const dirty = gitIn(["status", "--short"], wt);
  const dirtyCount = dirty ? dirty.split("\n").filter(Boolean).length : 0;
  return judgeWorktree(wt, precious, dirtyCount);
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    respond("allow");
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== "string" || !/\bgh\s+pr\s+merge\b/.test(command))
    respond("allow");

  const pr =
    extractExplicitPrNumber(command) ??
    gh(["pr", "view", "--json", "number", "-q", ".number"]);
  if (!pr || !/^\d+$/.test(pr)) respond("allow");

  const gate = checkQualityGate(pr);
  if (gate) respond(gate.decision, gate.reason);

  const data = checkWorktreeData(pr, command);
  if (data) respond(data.decision, data.reason);

  respond("allow");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
