#!/usr/bin/env node
/**
 * PreToolUse(Bash): `gh pr merge` を3つの観点で検査する。
 *
 * 1. 必須チェック（verify・ml-tests・e2e の集約）が緑でないPRのマージを止める。
 *    集合は GitHub の ruleset「master-checks」の必須チェックと同じにしてある（REQUIRED_CHECKS）。
 *
 *    `gh pr merge N --auto` は、ruleset が3つの必須チェックを全部持っているときだけチェックの結果を見ない。
 *    判定は GitHub 側が行い、チェックが緑になった時点でマージされるため（2026-10-18 オーナー判断）。
 *    ruleset が無い・足りない・読めないときは、--auto でも従来どおり検査する。必須チェックの無い
 *    リポジトリでは、--auto がその場のマージになりうるため（ruleset が入る前の運用を壊さない）。
 *
 *    ruleset が無かったころの経緯（このフックで止めている理由）: 必須ステータスチェックはPRのマージだけでなくブランチへの直接pushにも効き、
 *    scrape系・train系・update-sitemap の8ワークフローが GITHUB_TOKEN で master へ
 *    直接 push しているため、全部落ちる。GitHub Actions をバイパス対象に指定できるのは
 *    Organization 所有のリポジトリだけで、個人リポジトリでは
 *    "Actor GitHub Actions integration must be part of the ruleset source or owner organization"
 *    で拒否される（2026-09-25実測）。
 *    そこでマージを実行する側（＝このリポジトリでは実質すべてClaude）をローカルで止める。
 *    2026-10-18 に、master への定期 push をアプリ ryujin-bot に寄せた上で、ryujin-bot だけを bypass にした
 *    ruleset を入れる判断になった。入った後も、--auto 以外のマージはこのフックが同じ集合を先に見る
 *    （GitHub の拒否より前に、理由つきで止めるため）。
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
 *    ブランチ名・位置引数なしを gh でPRに解決できない場合も、確定できないものとして同じく止める。
 *
 * 4. e2e を軽い組（記事だけ）・0件（docs だけ）で済ませた PR が、本当にそれで済む差分かを確かめる（BOA-929）。
 *
 *    PR ゲートの e2e は差分で流す範囲を変える（scripts/maintenance/e2e-scope.js）。ワークフローは base 側の
 *    一覧で判定するが、pull_request のワークフロー自体は PR の側の定義で動くので、.github を書き換えれば
 *    軽い組に逃げられる。そこでマージの時点で、master の一覧（origin/master の content-pr-gate.json）で
 *    差分を判定し直し、全部流すべき PR なのに e2e-shard が成功していなければ止める。
 *    --auto で GitHub にチェックを任せる場合は、e2e の集約しか見られないので、.github/workflows を変える PR を止めて手のマージに回す。
 *
 * それ以外で判定できない場合（台帳に制約が無いときの番号不明、検査中にghが応答しない等）は素通しする。
 * 止めるべきものを見逃す方が、止めるべきでないものを止めて作業を詰まらせるより軽いため。
 *
 * 検証: scripts/maintenance/verify-guard-pr-merge.js
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRECIOUS_PATHS } from "../lib/preciousPaths.js";
import { classifyE2eScope } from "./e2e-scope.js";
import {
  judgeMergeOrder,
  ledgerPath,
  prerequisitesOf,
  readLedger,
} from "../lib/mergeOrder.js";

/**
 * 必須チェック。ruleset「master-checks」の必須チェックと同じ集合（どちらかを変えたらもう片方も変える）。
 * onFailure: 終わって成功以外のときの判定。e2e は録画に無い通信を本番へ素通しするため DB の状態で
 * 落ちることがあり（ADR-0077）、止めずに確認を挟む。
 */
const REQUIRED_CHECKS = [
  {
    name: "verify",
    onFailure: "deny",
    duration: "実測で1分半程度",
    failureNote:
      "verify は verify-registry.json の tier=ci をまとめて実行しており、マイグレーション番号の重複・" +
      "ADR番号の重複・sitemap登録漏れ等を検知します。内容を確認して直してからマージしてください",
  },
  {
    name: "ml-tests",
    onFailure: "deny",
    duration: "scripts/ml/ を変えていなければ数十秒",
    failureNote:
      "ml-tests は scripts/ml/analogy/tests の pytest です。内容を確認して直してからマージしてください",
  },
  {
    name: "e2e",
    onFailure: "ask",
    duration:
      "3つに分けたshardが並行で走り、実測で約20〜37分（記事だけの PR は軽い組、docs だけの PR は0件）。止まって終わらないときは " +
      "node scripts/maintenance/e2e-rerun.js で再実行を判定できます",
    failureNote:
      "e2eは録画（HAR）の再生で決定的に実行するが、録画に無い通信は本番へ素通しするため、" +
      "DBの状態で落ちることがあります（ADR-0077）。自動では止めませんが、コードの退行でないことを確認してから" +
      "マージしてください（再実行の判定: node scripts/maintenance/e2e-rerun.js）",
  },
];
export const REQUIRED_CHECK_NAMES = REQUIRED_CHECKS.map((c) => c.name);
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
/** 作業ディレクトリやブランチを変えるコマンド。この後の番号なしの merge は、フックからは対象が分からない。 */
const CHANGES_CONTEXT = /\b(?:cd|pushd)\b|\bgit\s+(?:checkout|switch)\b/;

/** gh pr merge より前でループの本体が閉じずに続いているか（`for ...; do gh pr merge`）。 */
function insideLoop(before) {
  const count = (re) => (before.match(re) ?? []).length;
  return (
    /\b(?:for|while|until)\b/.test(before) &&
    count(/\bdo\b/g) > count(/\bdone\b/g)
  );
}

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
 * --auto / --disable-auto があれば、上に auto: true が付く。
 *
 * gh は位置引数の位置を問わないので `gh pr merge --merge 123` も有効。先頭だけ見ると
 * 番号を取り逃がし、カレントブランチの別のPRのチェック結果で判定してしまう。
 */
function parseMergeArgs(args, currentUnknown) {
  // 引用符で囲まれた値は中に空白を含む（`-b "fix 42"`）。そのまま空白で割ると
  // 値の断片を位置引数と読んでしまうので、1トークンに潰してから割る。
  // ただし二重引用符の中の $ や ` は展開されるので、潰しても展開の印は残す（`"$PR"` を見逃さない）。
  const tokens = args
    .replace(/"([^"]*)"|'([^']*)'/g, (_, dq, sq) => {
      const value = dq ?? sq;
      // 空の値（-b ""）を消すと、次の番号が -b の値に読まれてしまう
      if (value && !/\s/.test(value)) return value;
      return dq !== undefined && SHELL_EXPANSION.test(value)
        ? "$__quoted__"
        : "__quoted__";
    })
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  // --auto（自動マージの予約）・--disable-auto（予約の取り消し）は、その場ではマージしない
  let auto = false;
  let target = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith("-")) {
      const [name] = token.split("=");
      if (name === "--auto" || name === "--disable-auto") auto = true;
      // `-b text` のように値が次のトークンに来る場合、その値を位置引数と読まない
      if (VALUE_OPTIONS.has(name) && !token.includes("=")) i += 1;
      continue;
    }
    // 位置引数は最初の1つだけ読む。後ろのオプション（--auto 等）は読み続ける
    if (target) continue;
    target = readPositional(token);
  }
  // 位置引数なしは「現在のブランチのPR」だが、ループの本体の中や cd・git switch の後では、
  // フックが見る現在のブランチと実際に merge が走るブランチが一致しない
  target ??= currentUnknown ? { kind: "unresolved" } : { kind: "current" };
  return auto ? { ...target, auto } : target;
}

/** 位置引数1つをマージ対象として読む（形は parseMergeArgs）。 */
function readPositional(token) {
  if (SHELL_EXPANSION.test(token)) return { kind: "unresolved" };
  const byNumber = token.match(/^(\d+)$/);
  if (byNumber) return { kind: "number", pr: byNumber[1] };
  const byUrl = token.match(/^https?:\/\/\S*?\/pull\/(\d+)\/?$/);
  if (byUrl) return { kind: "number", pr: byUrl[1] };
  if (BRANCH_NAME.test(token)) return { kind: "branch", name: token };
  return { kind: "unresolved" };
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
        : parseMergeArgs(
            m[1],
            insideLoop(before) || CHANGES_CONTEXT.test(before),
          ),
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

/** 1つの必須チェックの判定。問題が無ければ null。 */
function judgeOneCheck(pr, spec, check) {
  if (!check) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} に必須チェック（${spec.name}）の結果がまだありません。` +
        `ワークフローが走り終わるのを待つか、待たない理由を述べてからマージしてください（gh pr checks ${pr}）。`,
    };
  }
  // BOA-769 D（2026-10-12〜）: e2e の実行中も待たせる。以前は素通しにしていたため、走り終わる前に
  // マージできてしまった。手元のE2E全件実行をやめ、CIとこのガードだけでデグレを検知する運用のため
  if (RUNNING_STATES.has(check.state)) {
    return {
      decision: "ask",
      reason:
        `PR #${pr} の ${spec.name} はまだ実行中です（${check.state}）。` +
        `結果が出てからマージしてください（${spec.duration}）。`,
    };
  }
  if (check.state !== "SUCCESS") {
    return {
      decision: spec.onFailure,
      reason:
        `PR #${pr} の ${spec.name} が ${check.state} です。${spec.failureNote}` +
        `（gh pr checks ${pr}）。`,
    };
  }
  return null;
}

/**
 * チェック一覧から判定する。止まる側も検証できるよう、ghの呼び出しとは分けてある
 * （「素通しだけ確かめて、止まることを一度も確かめていない」ゲートにしないため）。
 * 必須チェックを全部見て、deny が1つでもあれば deny、無ければ最初の ask を返す。止める必要が無ければ null。
 */
export function judgeChecks(pr, checks) {
  if (!Array.isArray(checks)) return null;
  const results = REQUIRED_CHECKS.map((spec) =>
    judgeOneCheck(
      pr,
      spec,
      checks.find((c) => c.name === spec.name),
    ),
  ).filter(Boolean);
  return results.find((r) => r.decision === "deny") ?? results[0] ?? null;
}

/**
 * `gh api repos/{owner}/{repo}/rules/branches/master` の結果に、REQUIRED_CHECKS が全部
 * 必須チェックとして入っているか。入っていれば --auto のマージは GitHub がチェックを待つ。
 * 配列でない（API の失敗等）・足りないときは false（ローカルで検査する側に倒す）。
 */
export function rulesetEnforcesChecks(rules) {
  if (!Array.isArray(rules)) return false;
  const contexts = new Set(
    rules
      .filter((r) => r?.type === "required_status_checks")
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c?.context),
  );
  return REQUIRED_CHECK_NAMES.every((name) => contexts.has(name));
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

/** master に効いている ruleset の規則。読めなければ null。 */
function fetchMasterRules() {
  const raw = gh(["api", "repos/{owner}/{repo}/rules/branches/master"]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** PR のチェック一覧。読めなければ null（呼び出し側で素通しする）。 */
function fetchChecks(pr) {
  const raw = gh(["pr", "checks", pr, "--json", "name,state"]);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** e2e の各組のジョブ名（e2e-smoke-test.yml の e2e-shard。skip されると matrix が展開されない名前で1件出る）。 */
const isShardCheck = (c) => /^e2e-shard\b/.test(c?.name ?? "");

/**
 * master の一覧で判定した範囲（scope）と、実際に走った e2e の組を突き合わせる（純関数）。止める必要が無ければ null。
 * full なのに、e2e の集約が緑のまま e2e-shard が1つも無い・成功以外がある（skip を含む）なら止める。
 * e2e が緑でないときは judgeChecks が先に扱うので、ここでは見ない。
 */
export function judgeE2eScope(pr, scope, checks) {
  if (scope !== "full" || !Array.isArray(checks)) return null;
  if (checks.find((c) => c.name === "e2e")?.state !== "SUCCESS") return null;
  const shards = checks.filter(isShardCheck);
  const bad = shards.filter((c) => c.state !== "SUCCESS");
  if (shards.length > 0 && bad.length === 0) return null;
  const seen =
    shards.map((c) => `${c.name}=${c.state}`).join(", ") || "e2e-shard が無い";
  return {
    decision: "deny",
    reason:
      `PR #${pr} は master の一覧（scripts/content/content-pr-gate.json）では e2e を全部流すべき差分ですが、` +
      `全部の組が成功していません（${seen}）。軽い組・0件で済ませた e2e は、この差分には足りません。` +
      `ワークフロー（.github/workflows/e2e-smoke-test.yml）や一覧を PR の側で変えていないか確かめ、e2e を全部流してからマージしてください。`,
  };
}

/** --auto で GitHub に任せるとき、ワークフローを変える PR を止める（純関数）。止める必要が無ければ null。 */
export function judgeAutoWorkflowChange(pr, files) {
  if (!files.some((f) => f.startsWith(".github/workflows/"))) return null;
  return {
    decision: "ask",
    reason:
      `PR #${pr} は .github/workflows を変えています。pull_request の e2e は PR の側のワークフローで動くため、` +
      `GitHub の必須チェック（e2e の集約）だけでは全部流したかを確かめられません。--auto を外し、` +
      `e2e-shard が全部成功してからマージしてください。`,
  };
}

/** PR の差分のパス（改名は元と先の両方）。読めなければ null。 */
function fetchPrFiles(pr) {
  const raw = gh([
    "api",
    "--paginate",
    `repos/{owner}/{repo}/pulls/${pr}/files`,
    "--jq",
    ".[] | .filename, (.previous_filename // empty)",
  ]);
  return raw === null ? null : raw.split("\n").filter(Boolean);
}

/** master の一覧で差分を判定する。一覧が読めなければ full に倒す（軽い組を通す方へは倒さない）。 */
function masterE2eScope(files) {
  const raw = gitIn([
    "show",
    "origin/master:scripts/content/content-pr-gate.json",
  ]);
  try {
    return classifyE2eScope(files, JSON.parse(raw ?? "")).scope;
  } catch {
    return "full";
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
function resolveTarget(target, cwd) {
  if (target.kind === "number") return target.pr;
  if (target.kind === "unresolved") return null;
  const where = target.kind === "branch" ? [target.name] : [];
  const n = run(
    "gh",
    ["pr", "view", ...where, "--json", "number", "-q", ".number"],
    cwd,
  );
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

  // 「現在のブランチ」はコマンドが走るディレクトリ（worktree）のもの。フックの置き場所ではない
  const cwd =
    typeof payload.cwd === "string" && existsSync(payload.cwd)
      ? payload.cwd
      : repoRoot;
  const targets = extractMergeTargets(command);
  const resolved = targets.map((t) => resolveTarget(t, cwd));
  const ledger = loadLedger();
  const unresolved = judgeUnresolved(resolved, ledger);
  if (unresolved) respond(unresolved.decision, unresolved.reason);

  // --auto でチェックを GitHub に任せてよいのは、ruleset が必須チェックを全部持っているときだけ。
  // ruleset の読み込みは --auto があるときだけ行う（ふだんのマージに gh の呼び出しを足さない）
  const prs = [...new Set(resolved.filter(Boolean))];
  const autoOnly = (pr) =>
    targets.every((t, i) => resolved[i] !== pr || t.auto === true);
  const rulesEnforce =
    prs.some(autoOnly) && rulesetEnforcesChecks(fetchMasterRules());

  // 台帳に制約が無ければ、確定できなかったものは従来どおり検査せずに通す
  for (const pr of prs) {
    const order = checkMergeOrder(pr, ledger);
    if (order) respond(order.decision, order.reason);

    const files = fetchPrFiles(pr);
    if (rulesEnforce && autoOnly(pr)) {
      const auto = files && judgeAutoWorkflowChange(pr, files);
      if (auto) respond(auto.decision, auto.reason);
    } else {
      const checks = fetchChecks(pr);
      const gate = checks && judgeChecks(pr, checks);
      if (gate) respond(gate.decision, gate.reason);
      const scope =
        files && checks && judgeE2eScope(pr, masterE2eScope(files), checks);
      if (scope) respond(scope.decision, scope.reason);
    }

    const data = checkWorktreeData(pr, command);
    if (data) respond(data.decision, data.reason);
  }

  respond("allow");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();
