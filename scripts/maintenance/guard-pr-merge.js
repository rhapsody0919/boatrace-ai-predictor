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
 * 4. e2e を軽い組（記事だけ）・0件（docs と e2e が読まないパス、ADR-0100 追記）で済ませた PR が、本当にそれで済む差分かを確かめる（BOA-929）。
 *
 *    PR ゲートの e2e は差分で流す範囲を変える（scripts/maintenance/e2e-scope.js）。ワークフローは base 側の
 *    一覧で判定するが、pull_request のワークフロー自体は PR の側の定義で動くので、.github を書き換えれば
 *    軽い組に逃げられる。そこでマージの時点で、master の一覧（origin/master の content-pr-gate.json）で
 *    差分を判定し直し、全部流すべき PR なのに e2e-shard が成功していなければ止める。
 *    記事の PR が免除の一覧（internalLinkGrandfathered）から行を外すだけの設定の変更を含むときは、
 *    PR の分岐元と先頭の設定を gh api で読んで確かめ、CI と同じく軽い組として扱う（オーナー決定 2026-10-26）。
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
import {
  classifyE2eScope,
  GATE_CONFIG_PATH,
  grandfatherRemovals,
} from "./e2e-scope.js";
import {
  judgeMergeOrder,
  ledgerPath,
  prerequisitesOf,
  readLedger,
} from "../lib/mergeOrder.js";
import { extractMergeTargets, deletesBranch } from "./guardPrMergeCommand.js";
import { judgeChecks, rulesetEnforcesChecks } from "./guardPrMergeChecks.js";

const SUBPROCESS_TIMEOUT_MS = 15000;

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
export function judgeE2eScope(pr, scope, checks, note = "") {
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
      `ワークフロー（.github/workflows/e2e-smoke-test.yml）や一覧を PR の側で変えていないか確かめ、e2e を全部流してからマージしてください。` +
      (note ? ` ${note}` : ""),
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

/**
 * master の一覧で差分を判定する。一覧が読めなければ full に倒す（軽い組を通す方へは倒さない）。
 * 手元の origin/master が古いと一覧の鍵が足りず full に倒れ、正しい軽い組の PR まで止めるので、先に取り直す
 * （取り直せなければ手元のままで判定する）。
 */
function masterE2eScope(pr, files) {
  gitIn(["fetch", "-q", "origin", "master"]);
  const raw = gitIn(["show", `origin/master:${GATE_CONFIG_PATH}`]);
  let config;
  try {
    config = JSON.parse(raw ?? "");
    const plain = classifyE2eScope(files, config).scope;
    if (plain !== "full" || !files.includes(GATE_CONFIG_PATH))
      return { scope: plain };
    // 設定の変更が免除の一覧から外すだけなら軽い組で足りる差分か。足りない差分なら gh を呼ばずに full
    const ifRemoval = classifyE2eScope(files, config, {
      gateConfigRemovalOnly: true,
    }).scope;
    if (ifRemoval === "full") return { scope: "full" };
    if (prGateConfigRemovalOnly(pr, files)) return { scope: ifRemoval };
    return {
      scope: "full",
      note:
        `差分の ${GATE_CONFIG_PATH} が免除の一覧から外すだけの変更かを確かめられませんでした` +
        "（外すだけでない、または gh api で PR の分岐元と先頭の設定を読めない）。外すだけの変更で、読み取りの一時的な失敗なら、もう一度マージを試してください。",
    };
  } catch {
    return { scope: "full" };
  }
}

/** gh api で ref の時点の設定（content-pr-gate.json）を読む。読めなければ null */
const readGateConfigAt = (ref) => {
  const raw = gh([
    "api",
    "-H",
    "Accept: application/vnd.github.raw",
    `repos/{owner}/{repo}/contents/${GATE_CONFIG_PATH}?ref=${ref}`,
  ]);
  try {
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
};
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * PR の設定の変更が、免除の一覧（internalLinkGrandfathered）から外すだけか（オーナー決定 2026-10-26）。
 * CI（e2e-scope.js）は base と PR のマージコミットを比べる。ここでは PR の分岐元（master との merge-base）と
 * PR の先頭を比べる（分岐後に master で一覧が変わっても、PR が足した変更だけを見る）。
 * 読めないときは false（full に倒す。軽い組を通す方へは倒さない）
 */
function prGateConfigRemovalOnly(pr, files) {
  if (!files.includes(GATE_CONFIG_PATH)) return false;
  const head = gh([
    "pr",
    "view",
    pr,
    "--json",
    "headRefOid",
    "-q",
    ".headRefOid",
  ]);
  if (!head || !SHA_RE.test(head)) return false;
  const mergeBase = gh([
    "api",
    `repos/{owner}/{repo}/compare/master...${head}`,
    "--jq",
    ".merge_base_commit.sha",
  ]);
  if (!mergeBase || !SHA_RE.test(mergeBase)) return false;
  return (
    grandfatherRemovals(readGateConfigAt(mergeBase), readGateConfigAt(head)) !==
    null
  );
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

/** フックの入力から `gh pr merge` のコマンドと、それが走るディレクトリを読む。対象でなければ素通しで終える */
function readMergeCommand() {
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
  return { command, cwd };
}

/** 必須チェックと e2e の範囲。--auto で GitHub に任せる PR（byGithub）はワークフローの変更だけを見る */
function checkGate(pr, files, byGithub) {
  if (byGithub) {
    const auto = files && judgeAutoWorkflowChange(pr, files);
    if (auto) respond(auto.decision, auto.reason);
    return;
  }
  const checks = fetchChecks(pr);
  const gate = checks && judgeChecks(pr, checks);
  if (gate) respond(gate.decision, gate.reason);
  if (files && checks) {
    const master = masterE2eScope(pr, files);
    const scope = judgeE2eScope(pr, master.scope, checks, master.note);
    if (scope) respond(scope.decision, scope.reason);
  }
}

/** 1本の PR の検査（マージ順 → 必須チェックと e2e の範囲 → worktree のデータ）。止めるときは respond が終える */
function checkOnePr(pr, { command, ledger, byGithub }) {
  const order = checkMergeOrder(pr, ledger);
  if (order) respond(order.decision, order.reason);

  const files = fetchPrFiles(pr);
  checkGate(pr, files, byGithub);

  const data = checkWorktreeData(pr, command);
  if (data) respond(data.decision, data.reason);
}

function main() {
  const { command, cwd } = readMergeCommand();
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
  for (const pr of prs)
    checkOnePr(pr, {
      command,
      ledger,
      byGithub: Boolean(rulesEnforce && autoOnly(pr)),
    });

  respond("allow");
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) main();

export { extractMergeTargets, deletesBranch } from "./guardPrMergeCommand.js";

export {
  REQUIRED_CHECK_NAMES,
  judgeChecks,
  rulesetEnforcesChecks,
} from "./guardPrMergeChecks.js";
