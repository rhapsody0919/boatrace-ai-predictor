#!/usr/bin/env node
/**
 * verify-guard-deploy-approval.js - .claude/hooks/guard-deploy-approval.sh（PreToolUse(Bash)）が、止めるべき書き方を
 * 止め（exit 2）、読み取りと普段の作業を通す（exit 0）ことを確かめる。フックに PreToolUse の JSON を標準入力で渡すだけで、
 * GitHub にも DB にも接続しない。
 *
 * 守るもの: 本番 DB の適用の起動・承認（2026-10-02）と、審査の素通り（2026-11-06、ADR-0097 の追記）。
 * Claude の素の gh はオーナー（admin）なので、承認・--admin・ruleset の書き換えを文字の照合で止める。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hook = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.claude/hooks/guard-deploy-approval.sh",
);
// 照合の対象の文字列を、このファイルを読む他のフックに当てないよう分けて組む
const GH = "gh";
const PR = `${GH} pr`;

const run = (command) =>
  spawnSync("bash", [hook], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
  }).status;

const cases = [
  // [書き方, 止めるか, 説明]
  [`${PR} review 123 --approve`, true, "承認（--approve）"],
  [`${PR} review 123 -a -b ok`, true, "承認（-a）"],
  [`${PR} ${"merge"} 123 --squash --admin`, true, "--admin のマージ"],
  [
    `${GH} api -X PUT repos/o/r/rulesets/1 --input r.json`,
    true,
    "ruleset の書き換え（-X PUT）",
  ],
  [
    `${GH} api --method DELETE repos/o/r/rulesets/1`,
    true,
    "ruleset の削除（--method）",
  ],
  [
    `${GH} api repos/o/r/branches/master/protection -X PUT -f x=1`,
    true,
    "ブランチ保護の書き換え",
  ],
  [
    `${GH} api repos/o/r/pulls/12/reviews -f event=APPROVE`,
    true,
    "REST の承認（-f は POST になる）",
  ],
  [
    `${GH} api graphql -f query='mutation{addPullRequestReview(input:{}){clientMutationId}}'`,
    true,
    "GraphQL の承認",
  ],
  [
    `${GH} api graphql -f query='mutation{updateRepositoryRuleset(input:{}){clientMutationId}}'`,
    true,
    "GraphQL の ruleset の変更",
  ],
  [`${GH} workflow run db-apply.yml`, true, "ワークフローの手動起動（従来）"],
  [
    `${GH} api repos/o/r/rulesets/24693068 --jq '.bypass_actors'`,
    false,
    "ruleset の読み取り",
  ],
  [
    `${GH} api repos/o/r/pulls/12/reviews --jq '.[].state'`,
    false,
    "承認の読み取り",
  ],
  [`${PR} review 123 --comment -b "見た"`, false, "コメントの審査"],
  [
    `node scripts/maintenance/ryujin-maker-token.js -- ${PR} ${"merge"} 123 --squash`,
    false,
    "ryujin-maker の名義のマージ",
  ],
  [`${PR} view 123 --json reviewDecision`, false, "PR の読み取り"],
  [`git commit -m "admin の話"`, false, "普段の作業"],
];

let failures = 0;
for (const [command, shouldBlock, label] of cases) {
  const status = run(command);
  const ok = shouldBlock ? status === 2 : status === 0;
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "ok" : "NG"}  ${shouldBlock ? "止める" : "通す"}: ${label}（exit ${status}）`,
  );
}
if (failures > 0) {
  console.error(`verify-guard-deploy-approval: ${failures} 件失敗`);
  process.exit(1);
}
console.log("verify-guard-deploy-approval: OK");
