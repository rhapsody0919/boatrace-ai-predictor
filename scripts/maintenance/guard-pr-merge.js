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
 * 3. 並行セッションのオーケストレーションが決めたマージ順を守る。
 *
 *    台帳（scripts/lib/mergeOrder.js）で「このPRは #N の後に」とされていれば、#N が MERGED に
 *    なるまで止める。台帳が無い・PRが台帳に無い・台帳が読めない・ghが失敗した場合は素通し。
 *
 *    ただし台帳に順序の制約が1つでもあるのに、コマンドからマージ対象のPR番号を確定できない場合は
 *    止める（fail-closed）。`for n in 917 918; do gh pr merge $n; done`・`gh pr merge "$PR"`・
 *    `$(...)`・xargs のように番号がシェルの展開で決まる書き方は、フックの時点では番号が読めない。
 *    2026-09-29 にこれで素通しし、#918 が先行の #917 より先にマージされた。
 *    1つのコマンドに `gh pr merge` が複数あれば、全部を確定できたときだけ通し、全部を検査する。
 *
 * それ以外で判定できない場合（台帳に制約が無いときの番号不明、ghが応答しない等）は素通しする。
 * 止めるべきものを見逃す方が、止めるべきでないものを止めて作業を詰まらせるより軽いため。
 *
 * 検証: scripts/maintenance/verify-guard-pr-merge.js
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";
import {
  judgeMergeOrder,
  ledgerPath,
  prerequisitesOf,
  readLedger,
} from "../lib/mergeOrder.js";

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
  "-R",
  "--repo",
]);
/** 番号がシェルの展開で決まる印（変数・コマンド置換・xargs/find の置換文字列）。 */
const SHELL_EXPANSION = /[$`{}]/;
/** gh が位置引数として受け付けるブランチ名（`OWNER:BRANCH` を含む）。 */
const BRANCH_NAME = /^[\w./:-]+$/;
/** 引数を標準入力などから補って別のコマンドを起動するコマンド。 */
const ARG_FEEDERS = /(?:^|\s)(?:xargs|parallel)(?=\s|$)|\s-exec(?:dir)?(?=\s)/;
/** gh pr merge より前にループの本体が始まっているか（`for ...; do gh pr merge`）。 */
const LOOP = /\b(?:for|while|until)\b[\s\S]*\bdo\b/;

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
 * 1つの `gh pr merge` の引数部分から、マージ対象を読む。
 *   { kind: "number", pr }   番号・PRのURL
 *   { kind: "branch", name } ブランチ名（gh でそのブランチのPRに解決する）
 *   { kind: "current" }      位置引数なし（現在のブランチのPR）
 *   { kind: "unresolved" }   番号がシェルの展開で決まる等、フックの時点では確定できない
 *
 * gh は位置引数の位置を問わないので `gh pr merge --merge 123` も有効。先頭だけ見ると
 * 番号を取り逃がし、カレントブランチの別のPRのチェック結果で判定してしまう。
 */
function parseMergeArgs(args, inLoop) {
  // 引用符で囲まれた値は中に空白を含む（`-b "fix 42"`）。そのまま空白で割ると
  // 値の断片を位置引数と読んでしまうので、1トークンに潰してから割る。
  // ただし二重引用符の中の $ や ` は展開されるので、潰しても展開の印は残す（`"$PR"` を見逃さない）。
  const tokens = args
    .replace(/"([^"]*)"|'([^']*)'/g, (_, dq, sq) => {
      const value = dq ?? sq;
      if (!/\s/.test(value)) return value;
      return dq !== undefined && SHELL_EXPANSION.test(value)
        ? "$__quoted__"
        : "__quoted__";
    })
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
    if (SHELL_EXPANSION.test(token)) return { kind: "unresolved" };
    const byNumber = token.match(/^(\d+)$/);
    if (byNumber) return { kind: "number", pr: byNumber[1] };
    const byUrl = token.match(/^https?:\/\/\S*?\/pull\/(\d+)\/?$/);
    if (byUrl) return { kind: "number", pr: byUrl[1] };
    if (BRANCH_NAME.test(token)) return { kind: "branch", name: token };
    return { kind: "unresolved" };
  }
  // ループの本体の中の位置引数なしは、繰り返しごとに別のブランチで走りうる
  return inLoop ? { kind: "unresolved" } : { kind: "current" };
}

/** コマンド中のすべての `gh pr merge` について、マージ対象を読む（形は parseMergeArgs）。 */
export function extractMergeTargets(command) {
  const targets = [];
  for (const m of command.matchAll(/\bgh\s+pr\s+merge\b([^\n;&|]*)/g)) {
    const before = command.slice(0, m.index);
    // 同じ単純コマンドの中で gh より前にある部分（`echo 1 | xargs -n1 gh pr merge` の ` xargs -n1 `）。
    // xargs 等は位置引数を後から足すので、書かれた引数からは番号が分からない。
    const lead = before.slice(before.search(/[^\n;&|]*$/));
    targets.push(
      ARG_FEEDERS.test(lead)
        ? { kind: "unresolved" }
        : parseMergeArgs(m[1], LOOP.test(before)),
    );
  }
  return targets;
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

/** 台帳を読む。無い・壊れている場合は空の台帳（台帳の不調で作業は止めない。CLIの list で気づける）。 */
function loadLedger() {
  const file = ledgerPath(repoRoot);
  if (!file) return { rules: [] };
  try {
    return readLedger(file);
  } catch {
    return { rules: [] };
  }
}

/** 台帳に順序の制約が1つでもあるか。無ければ番号が分からなくても止める理由が無い。 */
export function hasOrderConstraints(ledger) {
  return ledger.rules.some((r) => r.after.length > 0);
}

/**
 * マージ対象の一部を確定できなかったときの判定。止める必要が無ければ null。
 * resolved は各 `gh pr merge` のPR番号（確定できなければ null）。
 */
export function judgeUnresolved(resolved, ledger) {
  if (!resolved.includes(null) || !hasOrderConstraints(ledger)) return null;
  return {
    decision: "deny",
    reason:
      "コマンドからマージ対象のPR番号を確定できません（シェル変数・$(...)・xargs・ループ等で番号が" +
      "実行時に決まる書き方か、PRに解決できないブランチ名）。マージ順の台帳に順序の制約があり、" +
      "番号が分からないと順序を守れているか判定できないため止めます。" +
      "PR 番号をリテラルで1件ずつ書いて（gh pr merge 918 --squash）、1コマンドに1件ずつ再実行してください" +
      "（台帳: node scripts/maintenance/merge-order.js list）。",
  };
}

function checkMergeOrder(pr, ledger) {
  const prerequisites = prerequisitesOf(ledger, pr);
  if (prerequisites.length === 0) return null;
  const states = {};
  for (const n of prerequisites) {
    const state = gh([
      "pr",
      "view",
      String(n),
      "--json",
      "state",
      "-q",
      ".state",
    ]);
    if (state) states[n] = state;
  }
  return judgeMergeOrder(pr, prerequisites, states);
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

/** マージ対象をPR番号（文字列）にする。確定できなければ null。 */
function resolveTarget(target) {
  if (target.kind === "number") return target.pr;
  if (target.kind === "unresolved") return null;
  const where = target.kind === "branch" ? [target.name] : [];
  const n = gh(["pr", "view", ...where, "--json", "number", "-q", ".number"]);
  return n && /^\d+$/.test(n) ? n : null;
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

  const resolved = extractMergeTargets(command).map(resolveTarget);
  const ledger = loadLedger();
  const unresolved = judgeUnresolved(resolved, ledger);
  if (unresolved) respond(unresolved.decision, unresolved.reason);

  // 台帳に制約が無ければ、確定できなかったものは従来どおり検査せずに通す
  for (const pr of new Set(resolved.filter(Boolean))) {
    const order = checkMergeOrder(pr, ledger);
    if (order) respond(order.decision, order.reason);

    const gate = checkQualityGate(pr);
    if (gate) respond(gate.decision, gate.reason);

    const data = checkWorktreeData(pr, command);
    if (data) respond(data.decision, data.reason);
  }

  respond("allow");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
