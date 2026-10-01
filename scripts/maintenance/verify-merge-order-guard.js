#!/usr/bin/env node
/**
 * verify-merge-order-guard.js - マージ順ガード（guard-pr-merge.js の3つ目の検査、scripts/lib/mergeOrder.js、
 * merge-order.js）の検証。本物の gh・GitHub・このリポジトリの状態には触らない。
 *
 * 確認すること:
 *   (a) 実際にフックとして起動した guard-pr-merge.js が、台帳で先行とされたPRが未マージなら deny し、
 *       マージ済みなら素通しする（偽の gh を使い、台帳は MERGE_ORDER_LEDGER で差し替える）。
 *       マージ順の検査が無かった版では deny しない（= このテストが修正前に落ちる）
 *   (b) 素通しする場合: 台帳が無い・PRが台帳に無い・台帳が壊れている・gh が失敗する
 *   (c) 判定の純関数と台帳の形式検査
 *   (d) CLI: add（既存の after に足す）・list・remove と、不正な入力の拒否
 *   (e) 台帳に制約があるのに、PR番号がシェルの展開で決まる書き方（for ループの $n・"$PR"・$(...)・xargs 等）
 *       ならフックが止める。番号を確定できる書き方と、台帳が空の場合は従来どおり
 *       （番号不明を素通ししていた版では、止める側の13件が落ちることを確認済み）
 *
 * 隔離（BOA-634）: 子プロセス（フック・CLI・偽の gh）は次の条件でだけ動かす。
 *   - 環境変数は process.env を引き継がず、ここで組み立てたものだけを渡す。PATH は偽の gh を置いた
 *     一時ディレクトリだけなので、本物の gh・git には届かない（偽の gh を消すと gh が見つからずに失敗する）。
 *     GH_TOKEN・GITHUB_TOKEN は渡さず、HOME・GH_CONFIG_DIR は空の一時ディレクトリにする
 *   - 子プロセスの cwd と、フックに渡す payload の cwd は、一時ディレクトリに作った独立した git リポジトリ
 *     （本物のリポジトリのブランチ・worktree・台帳を見ない）
 *   - 台帳はケースごとに別ファイル。フックの起動は互いに独立なので、並列に回す
 *     （手元の負荷が高いと、直列では verify:ci の上限180秒に近づいていた）
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addRule,
  judgeMergeOrder,
  parseLedger,
  prerequisitesOf,
  removeRule,
} from "../lib/mergeOrder.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, "guard-pr-merge.js");
const CLI = path.join(HERE, "merge-order.js");
/** 子プロセス1本あたりの上限。負荷で打ち切った場合は、判定の誤りと区別できるように理由を出す */
const CHILD_TIMEOUT_MS = 90_000;
/** 同時に起動する子プロセスの数 */
const CONCURRENCY = 4;

let failures = 0;
let passed = 0;
function check(label, pass, detail = "") {
  if (pass) passed++;
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const work = realpathSync(
  mkdtempSync(path.join(tmpdir(), "merge-order-guard-")),
);
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

// 偽の gh: pr checks は品質ゲート緑、pr view --json state は FAKE_GH_STATES（"902=OPEN,903=MERGED"）から返す。
// PATH に他のコマンドが無いので、bash は絶対パスで起動し、組み込みコマンドだけを使う
const bin = path.join(work, "bin");
mkdirSync(bin);
writeFileSync(
  path.join(bin, "gh"),
  `#!/bin/bash
if [ "$1 $2" = "pr checks" ]; then
  echo '[{"name":"verify","state":"SUCCESS"},{"name":"e2e","state":"SUCCESS"}]'
  exit 0
fi
if [ "$1 $2 $3" = "pr view --json" ] && [ "$4" = "number" ]; then
  # FAKE_GH_CURRENT_DIR があれば、そのディレクトリで起動されたときだけ現在のブランチのPRがある
  [ -n "$FAKE_GH_CURRENT_DIR" ] && [ "$(pwd -P)" != "$FAKE_GH_CURRENT_DIR" ] && exit 1
  [ -n "$FAKE_GH_CURRENT" ] && { echo "$FAKE_GH_CURRENT"; exit 0; }
  exit 1
fi
if [ "$1 $2" = "pr view" ] && [ "$4 $5" = "--json number" ]; then
  for kv in \${FAKE_GH_BRANCHES//,/ }; do
    [ "\${kv%%=*}" = "$3" ] && { echo "\${kv#*=}"; exit 0; }
  done
  exit 1
fi
if [ "$1 $2" = "pr view" ] && [ "$4 $5" = "--json state" ]; then
  [ -n "$FAKE_GH_FAIL" ] && exit 1
  for kv in \${FAKE_GH_STATES//,/ }; do
    [ "\${kv%%=*}" = "$3" ] && { echo "\${kv#*=}"; exit 0; }
  done
  exit 1
fi
exit 1
`,
);
chmodSync(path.join(bin, "gh"), 0o755);

const home = path.join(work, "home");
const ghConfig = path.join(work, "gh-config");
mkdirSync(home);
mkdirSync(ghConfig);

/** 独立した git リポジトリを作る（作るときだけ本物の git を使う。子プロセスからは git は見えない） */
function initRepo(dir) {
  mkdirSync(dir);
  const r = spawnSync("git", ["init", "-q"], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: home, GIT_CEILING_DIRECTORIES: work },
  });
  if (r.status !== 0) {
    console.error(
      `❌ 一時リポジトリを作れません: ${dir} ${r.error ?? r.stderr}`,
    );
    process.exit(1);
  }
  return dir;
}
const repo = initRepo(path.join(work, "repo"));
const otherRepo = initRepo(path.join(work, "wt"));

/** 子プロセスに渡す環境変数。process.env は引き継がない */
const isolatedEnv = (extra = {}) => ({
  PATH: bin,
  HOME: home,
  GH_CONFIG_DIR: ghConfig,
  GH_PROMPT_DISABLED: "1",
  GIT_CEILING_DIRECTORIES: work,
  FAKE_GH_STATES: "",
  FAKE_GH_FAIL: "",
  FAKE_GH_CURRENT: "",
  FAKE_GH_CURRENT_DIR: "",
  FAKE_GH_BRANCHES: "",
  ...extra,
});

// 同時起動数を絞る
let active = 0;
const queue = [];
function pump() {
  while (active < CONCURRENCY && queue.length > 0) {
    const task = queue.shift();
    active++;
    task().finally(() => {
      active--;
      pump();
    });
  }
}
const limited = (task) =>
  new Promise((resolve, reject) => {
    queue.push(() => task().then(resolve, reject));
    pump();
  });

/** node スクリプトを隔離した環境で起動する。{ status, stdout, stderr, timedOut } */
function runNode(script, args, { env = {}, input = "", cwd = repo } = {}) {
  return limited(
    () =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [script, ...args], {
          cwd,
          env: isolatedEnv(env),
        });
        let stdout = "";
        let stderr = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, CHILD_TIMEOUT_MS);
        child.stdout.setEncoding("utf8").on("data", (d) => (stdout += d));
        child.stderr.setEncoding("utf8").on("data", (d) => (stderr += d));
        child.on("error", (e) => {
          clearTimeout(timer);
          resolve({ status: null, stdout, stderr: String(e), timedOut });
        });
        child.on("close", (status) => {
          clearTimeout(timer);
          resolve({ status, stdout, stderr, timedOut });
        });
        child.stdin.end(input);
      }),
  );
}

// 台帳はケースごとに別ファイルにする（並列に回すため）
let ledgerSeq = 0;
/** rules の配列なら台帳として書く、文字列ならそのまま書く、null なら存在しないパスを返す */
function ledgerFor(content) {
  const file = path.join(work, `ledger-${++ledgerSeq}.json`);
  if (Array.isArray(content))
    writeFileSync(file, JSON.stringify({ rules: content }));
  else if (typeof content === "string") writeFileSync(file, content);
  return file;
}

/** フックとして起動する。deny なら理由、素通しなら null。spawnCwd はフックのプロセス自身の cwd */
async function runGuard(
  command,
  { ledgerFile, env = {}, payload = {}, spawnCwd = repo } = {},
) {
  const r = await runNode(GUARD, [], {
    cwd: spawnCwd,
    env: { MERGE_ORDER_LEDGER: ledgerFile, ...env },
    input: JSON.stringify({ cwd: repo, ...payload, tool_input: { command } }),
  });
  if (r.timedOut) return `タイムアウト: ${CHILD_TIMEOUT_MS / 1000}秒で打ち切り`;
  if (r.status !== 0) return `起動失敗: ${r.status} ${r.stderr}`;
  if (!r.stdout.trim()) return null;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return `${out.permissionDecision}: ${out.permissionDecisionReason}`;
}

const pending = [];
/** フックを起動して判定する（並列に走らせ、最後にまとめて待つ） */
function expectGuard(label, ledger, command, env, predicate, options = {}) {
  pending.push(
    runGuard(command, { ledgerFile: ledgerFor(ledger), env, ...options }).then(
      (r) => check(label, predicate(r), String(r)),
    ),
  );
}
const isDeny = (r) => typeof r === "string" && r.startsWith("deny:");
const isAllow = (r) => r === null;

// ---------------------------------------------------------------------------
// 隔離の前提: 子プロセスの PATH から見える gh は偽物だけで、git は見えない
// ---------------------------------------------------------------------------
{
  const r = spawnSync(
    "/bin/bash",
    ["-c", "command -v gh; command -v git; true"],
    {
      cwd: repo,
      encoding: "utf8",
      env: isolatedEnv(),
    },
  );
  check(
    "(隔離) 子プロセスで見える gh は偽物だけ・git は見えない",
    r.stdout.trim() === path.join(bin, "gh"),
    r.stdout.trim() || String(r.error),
  );
}

// ---------------------------------------------------------------------------
// (a) 止まる・通る
// ---------------------------------------------------------------------------
{
  const ledger = [{ pr: 901, after: [902] }];
  expectGuard(
    "(a) 先行の #902 が OPEN なら #901 のマージを止める",
    ledger,
    "gh pr merge 901 --squash",
    { FAKE_GH_STATES: "902=OPEN" },
    (r) =>
      isDeny(r) && r.includes("#902") && r.includes("オーケストレーション"),
  );
  expectGuard(
    "(a) 先行が CLOSED（マージされずに閉じた）でも止める",
    ledger,
    "gh pr merge 901",
    { FAKE_GH_STATES: "902=CLOSED" },
    isDeny,
  );
  expectGuard(
    "(a) 先行の #902 が MERGED なら素通し",
    ledger,
    "gh pr merge 901 --squash",
    { FAKE_GH_STATES: "902=MERGED" },
    isAllow,
  );
}
expectGuard(
  "(a) 先行が複数: 未マージのものだけを理由に挙げる",
  [{ pr: 901, after: [902, 903] }],
  "gh pr merge 901",
  { FAKE_GH_STATES: "902=MERGED,903=OPEN" },
  (r) => isDeny(r) && r.includes("#903") && !r.includes("#902"),
);

// ---------------------------------------------------------------------------
// (b) 素通し
// ---------------------------------------------------------------------------
expectGuard(
  "(b) 台帳が無ければ素通し",
  null,
  "gh pr merge 901",
  { FAKE_GH_STATES: "902=OPEN" },
  isAllow,
);
expectGuard(
  "(b) 台帳に無いPRは素通し",
  [{ pr: 901, after: [902] }],
  "gh pr merge 777",
  { FAKE_GH_STATES: "902=OPEN" },
  isAllow,
);
expectGuard(
  "(b) 制約なし（after が空）は素通し",
  [{ pr: 905, after: [] }],
  "gh pr merge 905",
  {},
  isAllow,
);
expectGuard(
  "(b) gh が失敗したら素通し",
  [{ pr: 901, after: [902] }],
  "gh pr merge 901",
  { FAKE_GH_FAIL: "1" },
  isAllow,
);
expectGuard(
  "(b) 台帳が壊れていたら素通し",
  "{ 壊れたJSON",
  "gh pr merge 901",
  { FAKE_GH_STATES: "902=OPEN" },
  isAllow,
);

// ---------------------------------------------------------------------------
// (e) PR番号がシェルの展開で決まる書き方（fail-closed）
//     2026-09-29、`for n in 917 918; do gh pr merge $n ...; done` で番号を読めずに素通しし、
//     #918 が #917 より先にマージされた。台帳に順序の制約があるのに番号を確定できなければ止める。
// ---------------------------------------------------------------------------
{
  const ledger = [{ pr: 918, after: [917] }];
  const open917 = { FAKE_GH_STATES: "917=OPEN" };
  const isUnresolvedDeny = (r) => isDeny(r) && r.includes("リテラルで1件ずつ");
  const includes917 = (r) =>
    typeof r === "string" && r.includes("#917（OPEN）");
  for (const [label, command] of [
    [
      "変数 $n の for ループ",
      "for n in 917 918; do gh pr merge $n --squash; done",
    ],
    ["${n} の形", "for n in 917 918; do gh pr merge ${n} --squash; done"],
    ['"$PR"', 'gh pr merge "$PR" --squash'],
    [
      "$(...)",
      "gh pr merge $(gh pr list --head fix/x --json number -q '.[0].number') --squash",
    ],
    ["バッククォート", "gh pr merge `cat pr.txt` --squash"],
    [
      "xargs（番号がパイプから来る）",
      "echo 917 918 | xargs -n1 gh pr merge --squash",
    ],
    [
      "xargs -I{}",
      "printf '917\\n918\\n' | xargs -I{} gh pr merge {} --squash",
    ],
    [
      "while read",
      'gh pr list -q .[].number | while read n; do gh pr merge "$n"; done',
    ],
    [
      "リテラルと展開の混在（1つでも確定できなければ止める）",
      "gh pr merge 917 --squash && gh pr merge $n --squash",
    ],
  ]) {
    expectGuard(
      `(e) ${label} は止める`,
      ledger,
      command,
      open917,
      isUnresolvedDeny,
    );
  }
  expectGuard(
    "(e) リテラル番号の複数行: 2件目（#918）の先行 #917 が未マージなら止める",
    ledger,
    "gh pr merge 917 --squash\ngh pr merge 918 --squash",
    open917,
    includes917,
  );
  expectGuard(
    "(e) リテラル番号の複数行: 先行がマージ済みなら素通し",
    ledger,
    "gh pr merge 917 --squash\ngh pr merge 918 --squash",
    { FAKE_GH_STATES: "917=MERGED" },
    isAllow,
  );
  // 番号を確定できる書き方の挙動は変えない
  expectGuard(
    "(e) リテラル番号（台帳に無いPR）は素通し",
    ledger,
    "gh pr merge 777 --squash",
    open917,
    isAllow,
  );
  expectGuard(
    "(e) 引用符で囲んだリテラル番号は確定できる",
    ledger,
    'gh pr merge "777" --squash',
    open917,
    isAllow,
  );
  expectGuard(
    "(e) URL 形式は確定できる",
    ledger,
    "gh pr merge https://github.com/o/r/pull/777 --squash",
    open917,
    isAllow,
  );
  expectGuard(
    "(e) ブランチ名はそのブランチのPRに解決して判定する",
    ledger,
    "gh pr merge fix/x --squash",
    { ...open917, FAKE_GH_BRANCHES: "fix/x=918" },
    includes917,
  );
  expectGuard(
    "(e) 番号なし（現在のブランチ）は現在のブランチのPRで判定する",
    ledger,
    "gh pr merge --squash",
    { ...open917, FAKE_GH_CURRENT: "918" },
    includes917,
  );
  expectGuard(
    "(e) ブランチ名がPRに解決できなければ止める",
    ledger,
    "gh pr merge fix/none --squash",
    open917,
    isUnresolvedDeny,
  );
  expectGuard(
    "(e) 番号なしで現在のブランチのPRが引けなければ止める",
    ledger,
    "gh pr merge --squash",
    open917,
    isUnresolvedDeny,
  );
  // worktree のセッションでは、現在のブランチはコマンドが走るディレクトリ（payload の cwd）のもの
  // （/code-review の指摘で追加。フックの置き場所で引くと別のブランチのPRを見る）
  const onlyInOther = {
    ...open917,
    FAKE_GH_CURRENT: "918",
    FAKE_GH_CURRENT_DIR: otherRepo,
  };
  expectGuard(
    "(e) 番号なしは payload の cwd で現在のブランチのPRを引く",
    ledger,
    "gh pr merge --squash",
    onlyInOther,
    includes917,
    { payload: { cwd: otherRepo } },
  );
  // 逆向き: フックのプロセス自身はPRのあるリポジトリで起動し、payload の cwd は別のリポジトリ。
  // payload の cwd ではなく process.cwd() で引く版に戻ると、ここでPRを引いてしまい落ちる
  expectGuard(
    "(e) フック自身の起動ディレクトリではなく payload の cwd で引く",
    ledger,
    "gh pr merge --squash",
    onlyInOther,
    isUnresolvedDeny,
    { payload: { cwd: repo }, spawnCwd: otherRepo },
  );
  expectGuard(
    "(e) cd の後の番号なしは確定できないので止める",
    ledger,
    "cd ../wt && gh pr merge --squash",
    { ...open917, FAKE_GH_CURRENT: "918" },
    isUnresolvedDeny,
  );
  expectGuard(
    '(e) 空の引用符の値（-b ""）の後のリテラル番号で判定する',
    ledger,
    'gh pr merge -b "" 918 --squash',
    { ...open917, FAKE_GH_CURRENT: "777" },
    includes917,
  );
}
// 台帳が空（または順序の制約が1つも無い）なら従来どおり素通し
for (const [label, command] of [
  ["for ループ", "for n in 917 918; do gh pr merge $n --squash; done"],
  ['"$PR"', 'gh pr merge "$PR" --squash'],
  ["xargs", "echo 917 918 | xargs -n1 gh pr merge --squash"],
]) {
  expectGuard(
    `(e) 台帳が無ければ ${label} も素通し`,
    null,
    command,
    { FAKE_GH_STATES: "917=OPEN" },
    isAllow,
  );
}
expectGuard(
  "(e) 順序の制約が無い台帳なら展開も素通し",
  [{ pr: 905, after: [] }],
  'gh pr merge "$PR"',
  { FAKE_GH_STATES: "917=OPEN" },
  isAllow,
);

// ---------------------------------------------------------------------------
// (c) 純関数
// ---------------------------------------------------------------------------
check(
  "(c) 状態が1つでも取れなければ判断しない",
  judgeMergeOrder(1, [2, 3], { 2: "OPEN" }) === null,
);
check(
  "(c) 全て MERGED なら null",
  judgeMergeOrder(1, [2], { 2: "MERGED" }) === null,
);
check(
  "(c) 台帳に無いPRの先行は空",
  prerequisitesOf({ rules: [{ pr: 1, after: [2] }] }, 9).length === 0,
);
check(
  "(c) 文字列のPR番号でも引ける（フックはコマンド文字列から番号を取る）",
  prerequisitesOf({ rules: [{ pr: 1, after: [2] }] }, "1")[0] === 2,
);
for (const [label, text] of [
  ["rules が無い", "{}"],
  ["pr が文字列", '{"rules":[{"pr":"901","after":[]}]}'],
  ["after が無い", '{"rules":[{"pr":901}]}'],
  ["after に0", '{"rules":[{"pr":901,"after":[0]}]}'],
]) {
  let threw = false;
  try {
    parseLedger(text);
  } catch {
    threw = true;
  }
  check(`(c) 形式検査: ${label} は拒否`, threw);
}
check(
  "(c) addRule は既存の after と合わせ、同じPRの規則を1つに保つ",
  JSON.stringify(addRule({ rules: [{ pr: 1, after: [2] }] }, 1, [3, 2])) ===
    JSON.stringify({ rules: [{ pr: 1, after: [2, 3] }] }),
);
check(
  "(c) removeRule",
  removeRule(
    {
      rules: [
        { pr: 1, after: [] },
        { pr: 2, after: [] },
      ],
    },
    1,
  ).rules.length === 1,
);

// ---------------------------------------------------------------------------
// (d) CLI（1つの台帳を順に書き換えるので、この中は直列。上のフックの起動とは並列に走る）
// ---------------------------------------------------------------------------
async function verifyCli() {
  const ledgerFile = ledgerFor(null);
  const cli = (...args) =>
    runNode(CLI, args, { env: { MERGE_ORDER_LEDGER: ledgerFile } });
  const guard = (command, env) => runGuard(command, { ledgerFile, env });

  check("(d) 台帳が無くても list は成功", (await cli("list")).status === 0);
  check(
    "(d) add 901 --after 902",
    (await cli("add", "901", "--after", "902")).status === 0,
  );
  check(
    "(d) add 901 --after #903（# 付きも可）",
    (await cli("add", "901", "--after", "#903")).status === 0,
  );
  check("(d) add 905（制約なし）", (await cli("add", "905")).status === 0);
  const written = readFileSync(ledgerFile, "utf8");
  check(
    "(d) 台帳の中身",
    JSON.stringify(JSON.parse(written)) ===
      JSON.stringify({
        rules: [
          { pr: 901, after: [902, 903] },
          { pr: 905, after: [] },
        ],
      }),
    written,
  );
  check(
    "(d) list に表示される",
    /#901 ← #902, #903 の後/.test((await cli("list")).stdout),
  );
  const denied = await guard("gh pr merge 901", {
    FAKE_GH_STATES: "902=MERGED,903=OPEN",
  });
  check(
    "(d) CLIで書いた台帳で、フックが止める",
    isDeny(denied),
    String(denied),
  );
  check("(d) remove 901", (await cli("remove", "901")).status === 0);
  const allowed = await guard("gh pr merge 901", {
    FAKE_GH_STATES: "902=OPEN,903=OPEN",
  });
  check("(d) remove 後はフックが素通し", isAllow(allowed), String(allowed));
  check("(d) 不正: PR番号でない", (await cli("add", "abc")).status === 1);
  check(
    "(d) 不正: --after の後が空",
    (await cli("add", "901", "--after")).status === 1,
  );
  check(
    "(d) 不正: --after より前の余分な引数を黙って捨てない",
    (await cli("add", "901", "902", "--after", "903")).status === 1,
  );
  check(
    "(d) 不正: 自分自身の後",
    (await cli("add", "901", "--after", "901")).status === 1,
  );
  check(
    "(d) 不正: 台帳に無いPRの remove",
    (await cli("remove", "999")).status === 1,
  );
  check("(d) 不正: 不明なサブコマンド", (await cli("wipe")).status === 1);
  writeFileSync(ledgerFile, "{ 壊れたJSON");
  check(
    "(d) 台帳が壊れていれば CLI は失敗して知らせる",
    (await cli("list")).status === 1,
  );
}
pending.push(verifyCli());

await Promise.all(pending);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log(`✅ マージ順ガードの検証 ${passed}件に合格しました`);
