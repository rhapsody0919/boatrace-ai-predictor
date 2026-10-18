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
  extractMergeTargets,
  findWorktreePath,
  hasOrderConstraints,
  judgeChecks,
  judgeUnresolved,
  judgeWorktree,
  REQUIRED_CHECK_NAMES,
  rulesetEnforcesChecks,
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

// --- マージ対象の抽出 ---
const num = (pr) => ({ kind: "number", pr });
const branch = (name) => ({ kind: "branch", name });
const CURRENT = { kind: "current" };
const UNRESOLVED = { kind: "unresolved" };
const first = (command) => extractMergeTargets(command)[0] ?? null;

check("番号を明示", first("gh pr merge 123 --merge"), num("123"));
check("番号なしは現在のブランチ", first("gh pr merge --merge"), CURRENT);
// ghは位置引数の位置を問わない。先頭だけ見ると番号を取り逃がし、カレントブランチの
// 別のPRのチェック結果で判定してしまう。
check("オプションが先", first("gh pr merge --merge 123"), num("123"));
check(
  "値を取るオプションの値を位置引数と読まない",
  first('gh pr merge -b "fix 42" 123 --merge'),
  num("123"),
);
check("値をイコールで渡す形", first("gh pr merge --body=text 123"), num("123"));
check(
  "値を取らないオプションは飛ばすだけ",
  first("gh pr merge --admin --squash 77"),
  num("77"),
);
check(
  "--repo の値を位置引数と読まない",
  first("gh pr merge -R o/r 55"),
  num("55"),
);
check("別コマンド", extractMergeTargets("gh pr view 123"), []);
check("前に別コマンド", first("cd /tmp && gh pr merge 99 -m"), num("99"));
check(
  "番号の直後にハイフンはブランチ名",
  first("gh pr merge 45-x"),
  branch("45-x"),
);
check(
  "URL指定",
  first(
    "gh pr merge https://github.com/rhapsody0919/boatrace-ai-predictor/pull/777 --merge",
  ),
  num("777"),
);
check(
  "URL指定(末尾スラッシュ)",
  first("gh pr merge https://github.com/o/r/pull/12/ --merge"),
  num("12"),
);
check(
  "ブランチ名指定",
  first("gh pr merge feature/x --merge"),
  branch("feature/x"),
);
check("引用符で囲んだ番号", first('gh pr merge "918" --squash'), num("918"));

// 番号がシェルの展開で決まる書き方（2026-09-29、for ループで #918 が #917 より先にマージされた）
check("変数", first("gh pr merge $n --squash"), UNRESOLVED);
check("変数(${})", first("gh pr merge ${n}"), UNRESOLVED);
check("二重引用符の変数", first('gh pr merge "$PR" --squash'), UNRESOLVED);
check(
  "空白を含む二重引用符のコマンド置換",
  first('gh pr merge "$(cat pr.txt | head -1)"'),
  UNRESOLVED,
);
check("コマンド置換", first("gh pr merge $(cat pr.txt) --squash"), UNRESOLVED);
check("バッククォート", first("gh pr merge `cat pr.txt`"), UNRESOLVED);
check(
  "xargs で位置引数を後から足す",
  first("echo 917 | xargs -n1 gh pr merge --squash"),
  UNRESOLVED,
);
check(
  "xargs -I{}",
  first("cat prs | xargs -I{} gh pr merge {} --squash"),
  UNRESOLVED,
);
check(
  "find -exec",
  first("find . -name x -exec gh pr merge {} \\;"),
  UNRESOLVED,
);
check(
  "ループ本体の番号なしは確定できない",
  first("for b in a c; do git switch $b && gh pr merge --squash; done"),
  UNRESOLVED,
);
check(
  "ループ本体でもリテラル番号は確定できる",
  first("for i in 1 2; do gh pr merge 918; done"),
  num("918"),
);
check(
  "単一引用符の値の $ は展開されない（オプションの値として飛ばす）",
  first("gh pr merge -b 'cost $5' 12"),
  num("12"),
);
check(
  "複数の gh pr merge を全部読む",
  extractMergeTargets(
    "gh pr merge 917 --squash\ngh pr merge 918 --squash && gh pr merge $n",
  ),
  [num("917"), num("918"), UNRESOLVED],
);

// /code-review の指摘で追加（PR #929）
check(
  "空の引用符の値を消さない（-b が番号を値として食わない）",
  first('gh pr merge -b "" 918 --squash'),
  num("918"),
);
check(
  "終わったループの後の番号なしは現在のブランチ",
  first("for f in a; do echo $f; done; gh pr merge --squash"),
  CURRENT,
);
check(
  "cd の後の番号なしは確定できない（フックの作業ディレクトリと違う）",
  first("cd ../wt && gh pr merge --squash"),
  UNRESOLVED,
);
check(
  "ブランチを切り替えた後の番号なしは確定できない",
  first("git switch fix/x && gh pr merge --squash"),
  UNRESOLVED,
);
check(
  "cd の後でもリテラル番号は確定できる",
  first("cd ../wt && gh pr merge 918"),
  num("918"),
);

// --- --auto（自動マージの予約。2026-10-18、ruleset「master-checks」の導入に合わせて追加） ---
check("--auto を読む", first("gh pr merge 1621 --auto --squash"), {
  ...num("1621"),
  auto: true,
});
check("--auto が番号より前", first("gh pr merge --auto 1621"), {
  ...num("1621"),
  auto: true,
});
check(
  "--disable-auto もその場ではマージしない",
  first("gh pr merge 1621 --disable-auto"),
  { ...num("1621"), auto: true },
);
check(
  "--auto の付かない形には auto を付けない",
  first("gh pr merge 1621 --squash"),
  num("1621"),
);
check(
  "引用符の本文に書いた --auto は読まない",
  first('gh pr merge 1621 -b "use --auto later" --squash'),
  num("1621"),
);
check(
  "-b の値としての --auto は読まない",
  first("gh pr merge 1621 -b --auto"),
  num("1621"),
);
check(
  "--auto でも変数の番号は確定できない（変数の禁止は --auto でも効く）",
  first("gh pr merge $n --auto"),
  { ...UNRESOLVED, auto: true },
);
check(
  "1つ目だけ --auto",
  extractMergeTargets("gh pr merge 1 --auto && gh pr merge 2 --squash"),
  [{ ...num("1"), auto: true }, num("2")],
);

// --auto でチェックを GitHub に任せてよいのは、ruleset が必須チェックを全部持っているときだけ
const statusRule = (...contexts) => ({
  type: "required_status_checks",
  parameters: {
    required_status_checks: contexts.map((context) => ({
      context,
      integration_id: 15368,
    })),
    strict_required_status_checks_policy: false,
  },
});
check(
  "必須チェックの集合は ruleset と同じ3つ",
  REQUIRED_CHECK_NAMES,
  ["verify", "ml-tests", "e2e"],
);
check(
  "ruleset が3つとも持てば GitHub に任せる",
  rulesetEnforcesChecks([
    { type: "deletion" },
    statusRule("verify", "e2e", "ml-tests"),
  ]),
  true,
);
check(
  "2つの ruleset に分かれていても合わせて見る",
  rulesetEnforcesChecks([statusRule("verify"), statusRule("e2e", "ml-tests")]),
  true,
);
// 2026-10-18 時点の master の実物（必須チェックの無い ruleset）。--auto でもローカルで検査する
check(
  "必須チェックの無い ruleset なら任せない（導入前の運用を壊さない）",
  rulesetEnforcesChecks([
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: { required_approving_review_count: 1 } },
  ]),
  false,
);
check(
  "ml-tests が欠けた ruleset なら任せない",
  rulesetEnforcesChecks([statusRule("verify", "e2e")]),
  false,
);
check("ruleset を読めなければ任せない", rulesetEnforcesChecks(null), false);
check("壊れた要素があっても落ちない", rulesetEnforcesChecks([null, {}]), false);

// --- 番号を確定できなかったときの判定 ---
const constrained = { rules: [{ pr: 918, after: [917] }] };
check("順序の制約あり", hasOrderConstraints(constrained), true);
check(
  "制約の無い規則だけなら制約なし",
  hasOrderConstraints({ rules: [{ pr: 905, after: [] }] }),
  false,
);
check(
  "制約ありで1つでも不明なら止める",
  judgeUnresolved(["917", null], constrained)?.decision,
  "deny",
);
check(
  "止める理由でリテラルでの再実行を案内する",
  judgeUnresolved([null], constrained).reason.includes("リテラルで1件ずつ"),
  true,
);
check(
  "全部確定できれば止めない",
  judgeUnresolved(["917", "918"], constrained),
  null,
);
check("台帳が空なら止めない", judgeUnresolved([null], { rules: [] }), null);

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
  { name: "ml-tests", state: "SUCCESS" },
  { name: "e2e", state: "SUCCESS" },
];
/** green のうち name だけを差し替える（state が null なら取り除く） */
const greenWith = (name, state) =>
  green
    .filter((c) => c.name !== name || state !== null)
    .map((c) => (c.name === name ? { name, state } : c));
check("全部緑なら止めない", judgeChecks("1", green), null);
// 以前は e2e が無い PR を素通りさせていた（集約ジョブが作られないまま終わっても気づけない）
check(
  "e2e の集約が無ければ待たせる",
  judgeChecks("1", greenWith("e2e", null))?.decision,
  "ask",
);
check(
  "e2e の集約が無い理由に check 名が入る",
  judgeChecks("1", greenWith("e2e", null)).reason.includes("（e2e）"),
  true,
);
check(
  "e2e-shard だけあって集約が無ければ待たせる",
  judgeChecks("1", [
    ...greenWith("e2e", null),
    { name: "e2e-shard (1/3)", state: "SUCCESS" },
  ])?.decision,
  "ask",
);
// 以前は ml-tests を見ていなかった
check(
  "ml-tests が無ければ待たせる",
  judgeChecks("1", greenWith("ml-tests", null))?.decision,
  "ask",
);
check(
  "ml-tests が落ちていれば止める",
  judgeChecks("1", greenWith("ml-tests", "FAILURE"))?.decision,
  "deny",
);
check(
  "ml-tests が実行中なら待たせる",
  judgeChecks("1", greenWith("ml-tests", "IN_PROGRESS"))?.decision,
  "ask",
);
check(
  "deny は先に見た ask より優先する（e2e 待ちでも ml-tests の失敗で止める）",
  judgeChecks("1", [
    { name: "verify", state: "SUCCESS" },
    { name: "ml-tests", state: "FAILURE" },
  ])?.decision,
  "deny",
);
check(
  "e2e が CANCELLED なら確認を挟む",
  judgeChecks("1", greenWith("e2e", "CANCELLED"))?.decision,
  "ask",
);
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
  judgeChecks("1", greenWith("e2e", "FAILURE"))?.decision,
  "ask",
);
check(
  "e2eだけ赤の理由に e2e が入る（ml-tests の欠けと取り違えない）",
  judgeChecks("1", greenWith("e2e", "FAILURE")).reason.includes("e2e が FAILURE"),
  true,
);
// 実際のPR #843 が e2e=IN_PROGRESS で、当時はPENDINGしか除外していなかったため
// 「e2eが赤い」扱いで確認を求めてしまった（2026-09-25、実データで発覚）。
// その修正では「RUNNING_STATESは何もしない（素通し）」にしたが、BOA-769 D（2026-10-12〜）で
// 「待たせる（ask）」に変える。実行中に素通しすると、手元の全件実行をやめた運用では
// 走り終わる前にマージできてしまうため（verifyのRUNNING判定と揃える）
check(
  "e2eが実行中なら待たせる(PENDING)",
  judgeChecks("1", greenWith("e2e", "PENDING"))?.decision,
  "ask",
);
check(
  "e2eが実行中なら待たせる(IN_PROGRESS)",
  judgeChecks("1", greenWith("e2e", "IN_PROGRESS"))?.decision,
  "ask",
);
check(
  "e2eが実行中なら待たせる(QUEUED)",
  judgeChecks("1", greenWith("e2e", "QUEUED"))?.decision,
  "ask",
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
