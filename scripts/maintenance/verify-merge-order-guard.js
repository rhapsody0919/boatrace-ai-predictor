#!/usr/bin/env node
/**
 * verify-merge-order-guard.js - マージ順ガード（guard-pr-merge.js の3つ目の検査、scripts/lib/mergeOrder.js、
 * merge-order.js）の検証。本物の gh・GitHub には接続しない。
 *
 * 確認すること:
 *   (a) 実際にフックとして起動した guard-pr-merge.js が、台帳で先行とされたPRが未マージなら deny し、
 *       マージ済みなら素通しする（偽の gh を PATH の先頭に置き、台帳は MERGE_ORDER_LEDGER で差し替える）。
 *       マージ順の検査が無かった版では deny しない（= このテストが修正前に落ちる）
 *   (b) 素通しする場合: 台帳が無い・PRが台帳に無い・台帳が壊れている・gh が失敗する
 *   (c) 判定の純関数と台帳の形式検査
 *   (d) CLI: add（既存の after に足す）・list・remove と、不正な入力の拒否
 *   (e) 台帳に制約があるのに、PR番号がシェルの展開で決まる書き方（for ループの $n・"$PR"・$(...)・xargs 等）
 *       ならフックが止める。番号を確定できる書き方と、台帳が空の場合は従来どおり
 *       （番号不明を素通ししていた版では、止める側の13件が落ちることを確認済み）
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

let failures = 0;
let passed = 0;
function check(label, pass, detail = "") {
  if (pass) passed++;
  else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

const work = mkdtempSync(path.join(tmpdir(), "merge-order-guard-"));
process.on("exit", () => rmSync(work, { recursive: true, force: true }));

// 偽の gh: pr checks は品質ゲート緑、pr view --json state は FAKE_GH_STATES（"902=OPEN,903=MERGED"）から返す
const bin = path.join(work, "bin");
mkdirSync(bin);
writeFileSync(
  path.join(bin, "gh"),
  `#!/usr/bin/env bash
if [ "$1 $2" = "pr checks" ]; then
  echo '[{"name":"verify","state":"SUCCESS"},{"name":"e2e","state":"SUCCESS"}]'
  exit 0
fi
if [ "$1 $2 $3" = "pr view --json" ] && [ "$4" = "number" ]; then
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

const ledgerFile = path.join(work, "merge-order.json");
const writeRaw = (text) => writeFileSync(ledgerFile, text);
const writeRules = (rules) => writeRaw(JSON.stringify({ rules }));

/** フックとして起動する。deny なら理由、素通しなら null */
function runGuard(command, env = {}) {
  const r = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      MERGE_ORDER_LEDGER: ledgerFile,
      FAKE_GH_STATES: "",
      FAKE_GH_FAIL: "",
      FAKE_GH_CURRENT: "",
      FAKE_GH_BRANCHES: "",
      ...env,
    },
    timeout: 60_000,
  });
  if (r.status !== 0) return `起動失敗: ${r.status} ${r.stderr}`;
  if (!r.stdout.trim()) return null;
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  return `${out.permissionDecision}: ${out.permissionDecisionReason}`;
}

// ---------------------------------------------------------------------------
// (a) 止まる・通る
// ---------------------------------------------------------------------------
writeRules([{ pr: 901, after: [902] }]);
{
  const r = runGuard("gh pr merge 901 --squash", {
    FAKE_GH_STATES: "902=OPEN",
  });
  check(
    "(a) 先行の #902 が OPEN なら #901 のマージを止める",
    r?.startsWith("deny:") &&
      r.includes("#902") &&
      r.includes("オーケストレーション"),
    String(r),
  );
  check(
    "(a) 先行が CLOSED（マージされずに閉じた）でも止める",
    runGuard("gh pr merge 901", { FAKE_GH_STATES: "902=CLOSED" })?.startsWith(
      "deny:",
    ),
  );
  check(
    "(a) 先行の #902 が MERGED なら素通し",
    runGuard("gh pr merge 901 --squash", { FAKE_GH_STATES: "902=MERGED" }) ===
      null,
  );
}
writeRules([{ pr: 901, after: [902, 903] }]);
{
  const r = runGuard("gh pr merge 901", {
    FAKE_GH_STATES: "902=MERGED,903=OPEN",
  });
  check(
    "(a) 先行が複数: 未マージのものだけを理由に挙げる",
    r?.startsWith("deny:") && r.includes("#903") && !r.includes("#902"),
    String(r),
  );
}

// ---------------------------------------------------------------------------
// (b) 素通し
// ---------------------------------------------------------------------------
rmSync(ledgerFile, { force: true });
check(
  "(b) 台帳が無ければ素通し",
  runGuard("gh pr merge 901", { FAKE_GH_STATES: "902=OPEN" }) === null,
);
writeRules([{ pr: 901, after: [902] }]);
check(
  "(b) 台帳に無いPRは素通し",
  runGuard("gh pr merge 777", { FAKE_GH_STATES: "902=OPEN" }) === null,
);
check(
  "(b) 制約なし（after が空）は素通し",
  (writeRules([{ pr: 905, after: [] }]), runGuard("gh pr merge 905") === null),
);
writeRules([{ pr: 901, after: [902] }]);
check(
  "(b) gh が失敗したら素通し",
  runGuard("gh pr merge 901", { FAKE_GH_FAIL: "1" }) === null,
);
writeRaw("{ 壊れたJSON");
check(
  "(b) 台帳が壊れていたら素通し",
  runGuard("gh pr merge 901", { FAKE_GH_STATES: "902=OPEN" }) === null,
);

// ---------------------------------------------------------------------------
// (e) PR番号がシェルの展開で決まる書き方（fail-closed）
//     2026-09-29、`for n in 917 918; do gh pr merge $n ...; done` で番号を読めずに素通しし、
//     #918 が #917 より先にマージされた。台帳に順序の制約があるのに番号を確定できなければ止める。
// ---------------------------------------------------------------------------
writeRules([{ pr: 918, after: [917] }]);
{
  const open917 = { FAKE_GH_STATES: "917=OPEN" };
  const isUnresolvedDeny = (r) =>
    typeof r === "string" &&
    r.startsWith("deny:") &&
    r.includes("リテラルで1件ずつ");
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
    const r = runGuard(command, open917);
    check(`(e) ${label} は止める`, isUnresolvedDeny(r), String(r));
  }
  check(
    "(e) リテラル番号の複数行: 2件目（#918）の先行 #917 が未マージなら止める",
    runGuard(
      "gh pr merge 917 --squash\ngh pr merge 918 --squash",
      open917,
    )?.includes("#917（OPEN）"),
  );
  check(
    "(e) リテラル番号の複数行: 先行がマージ済みなら素通し",
    runGuard("gh pr merge 917 --squash\ngh pr merge 918 --squash", {
      FAKE_GH_STATES: "917=MERGED",
    }) === null,
  );
  // 番号を確定できる書き方の挙動は変えない
  check(
    "(e) リテラル番号（台帳に無いPR）は素通し",
    runGuard("gh pr merge 777 --squash", open917) === null,
  );
  check(
    "(e) 引用符で囲んだリテラル番号は確定できる",
    runGuard('gh pr merge "777" --squash', open917) === null,
  );
  check(
    "(e) URL 形式は確定できる",
    runGuard(
      "gh pr merge https://github.com/o/r/pull/777 --squash",
      open917,
    ) === null,
  );
  check(
    "(e) ブランチ名はそのブランチのPRに解決して判定する",
    runGuard("gh pr merge fix/x --squash", {
      ...open917,
      FAKE_GH_BRANCHES: "fix/x=918",
    })?.includes("#917（OPEN）"),
  );
  check(
    "(e) 番号なし（現在のブランチ）は現在のブランチのPRで判定する",
    runGuard("gh pr merge --squash", {
      ...open917,
      FAKE_GH_CURRENT: "918",
    })?.includes("#917（OPEN）"),
  );
  check(
    "(e) ブランチ名がPRに解決できなければ止める",
    isUnresolvedDeny(runGuard("gh pr merge fix/none --squash", open917)),
  );
  check(
    "(e) 番号なしで現在のブランチのPRが引けなければ止める",
    isUnresolvedDeny(runGuard("gh pr merge --squash", open917)),
  );
}
// 台帳が空（または順序の制約が1つも無い）なら従来どおり素通し
rmSync(ledgerFile, { force: true });
for (const [label, command] of [
  ["for ループ", "for n in 917 918; do gh pr merge $n --squash; done"],
  ['"$PR"', 'gh pr merge "$PR" --squash'],
  ["xargs", "echo 917 918 | xargs -n1 gh pr merge --squash"],
]) {
  check(
    `(e) 台帳が無ければ ${label} も素通し`,
    runGuard(command, { FAKE_GH_STATES: "917=OPEN" }) === null,
  );
}
writeRules([{ pr: 905, after: [] }]);
check(
  "(e) 順序の制約が無い台帳なら展開も素通し",
  runGuard('gh pr merge "$PR"', { FAKE_GH_STATES: "917=OPEN" }) === null,
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
// (d) CLI
// ---------------------------------------------------------------------------
const cli = (...args) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, MERGE_ORDER_LEDGER: ledgerFile },
  });
rmSync(ledgerFile, { force: true });
check("(d) 台帳が無くても list は成功", cli("list").status === 0);
check(
  "(d) add 901 --after 902",
  cli("add", "901", "--after", "902").status === 0,
);
check(
  "(d) add 901 --after #903（# 付きも可）",
  cli("add", "901", "--after", "#903").status === 0,
);
check("(d) add 905（制約なし）", cli("add", "905").status === 0);
check(
  "(d) 台帳の中身",
  JSON.stringify(JSON.parse(readFileSync(ledgerFile, "utf8"))) ===
    JSON.stringify({
      rules: [
        { pr: 901, after: [902, 903] },
        { pr: 905, after: [] },
      ],
    }),
  readFileSync(ledgerFile, "utf8"),
);
check(
  "(d) list に表示される",
  /#901 ← #902, #903 の後/.test(cli("list").stdout),
);
check(
  "(d) CLIで書いた台帳で、フックが止める",
  runGuard("gh pr merge 901", {
    FAKE_GH_STATES: "902=MERGED,903=OPEN",
  })?.startsWith("deny:"),
);
check("(d) remove 901", cli("remove", "901").status === 0);
check(
  "(d) remove 後はフックが素通し",
  runGuard("gh pr merge 901", { FAKE_GH_STATES: "902=OPEN,903=OPEN" }) === null,
);
check("(d) 不正: PR番号でない", cli("add", "abc").status === 1);
check("(d) 不正: --after の後が空", cli("add", "901", "--after").status === 1);
check(
  "(d) 不正: --after より前の余分な引数を黙って捨てない",
  cli("add", "901", "902", "--after", "903").status === 1,
);
check(
  "(d) 不正: 自分自身の後",
  cli("add", "901", "--after", "901").status === 1,
);
check("(d) 不正: 台帳に無いPRの remove", cli("remove", "999").status === 1);
check("(d) 不正: 不明なサブコマンド", cli("wipe").status === 1);
writeRaw("{ 壊れたJSON");
check(
  "(d) 台帳が壊れていれば CLI は失敗して知らせる",
  cli("list").status === 1,
);

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log(`✅ マージ順ガードの検証 ${passed}件に合格しました`);
