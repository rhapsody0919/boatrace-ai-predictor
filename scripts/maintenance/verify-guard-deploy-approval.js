#!/usr/bin/env node
/**
 * verify-guard-deploy-approval.js - .claude/hooks/guard-deploy-approval.sh（PreToolUse(Bash)）が、止めるべき書き方を
 * 止め（exit 2）、読み取りと普段の作業を通す（exit 0）ことを確かめる。フックに PreToolUse の JSON を標準入力で渡すだけで、
 * GitHub にも DB にも接続しない。
 *
 * 守るもの: 本番 DB の適用の起動・承認（2026-10-02）と、審査の素通り（2026-11-06、ADR-0097 の追記）。
 * Claude の素の gh はオーナー（admin）なので、承認・ruleset の書き換えを文字の照合で止める。
 * --admin のマージは、作成の App の鍵（RYUJIN_MAKER_KEY_FILE）が置かれた後だけ止める。
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const hook = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.claude/hooks/guard-deploy-approval.sh",
);
// 照合の対象の文字列を、この verify を動かすときのフックに当てないよう分けて組む
const GH = "gh";
const PR = `${GH} pr`;
const MERGE = `${PR} ${"merge"}`;
const REVIEW = `${PR} ${"review"}`;

const dir = mkdtempSync(path.join(os.tmpdir(), "verify-guard-deploy-"));
const keyPresent = path.join(dir, "key.pem");
writeFileSync(keyPresent, "dummy", { mode: 0o600 });
const keyAbsent = path.join(dir, "none.pem");

const run = (command, keyFile) =>
  spawnSync("bash", [hook], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command } }),
    encoding: "utf8",
    env: { ...process.env, RYUJIN_MAKER_KEY_FILE: keyFile },
  }).status;

const cases = [
  // [書き方, 止めるか, 説明, 鍵のファイル（省略時は「置いた後」）]
  [`${REVIEW} 123 --approve`, true, "承認（--approve）"],
  [`${REVIEW} 123 -a -b ok`, true, "承認（-a）"],
  [`sh -c '${REVIEW} 12 --approve'`, true, "承認（引用符の直前）"],
  [`${REVIEW} 12 -b "lgtm; ok" --approve`, true, "承認（本文に ; があっても）"],
  [
    `bash -c "${MERGE} 12 --squash --admin"`,
    true,
    "--admin（二重引用符の直前）",
  ],
  [
    `${MERGE} 12 --squash \\\n  --admin\necho ok`,
    true,
    "--admin（行の継続と改行）",
  ],
  [`${MERGE} 12 --subject "a|b" --admin`, true, "--admin（題に | があっても）"],
  [
    `${MERGE} 123 --squash --admin`,
    false,
    "鍵が置かれる前の --admin は今までどおり通す",
    keyAbsent,
  ],
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
    `${GH} api -X "DELETE" repos/o/r/rulesets/24693068`,
    true,
    "ruleset の削除（引用符つきの method）",
  ],
  [
    `${GH} api repos/o/r/branches/master/protection -X 'DELETE'`,
    true,
    "ブランチ保護の削除（単引用符の method）",
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
    `${GH} api repos/o/r/pulls/12/reviews -fevent=APPROVE`,
    true,
    "REST の承認（-f と値をつなげても）",
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
    `${GH} api --paginate repos/o/r/pulls/12/reviews --jq '.[].state'`,
    false,
    "承認の読み取り",
  ],
  [`${REVIEW} 123 --comment -b "見た"`, false, "コメントの審査"],
  [
    `node scripts/maintenance/ryujin-maker-token.js -- ${MERGE} 123 --squash`,
    false,
    "ryujin-maker の名義のマージ",
  ],
  [`${PR} view 123 --json reviewDecision`, false, "PR の読み取り"],
  [`git commit -m "admin の話"`, false, "普段の作業"],
];

let failures = 0;
try {
  for (const [command, shouldBlock, label, keyFile = keyPresent] of cases) {
    const status = run(command, keyFile);
    const ok = shouldBlock ? status === 2 : status === 0;
    if (!ok) failures += 1;
    console.log(
      `  ${ok ? "ok" : "NG"}  ${shouldBlock ? "止める" : "通す"}: ${label}（exit ${status}）`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
if (failures > 0) {
  console.error(`verify-guard-deploy-approval: ${failures} 件失敗`);
  process.exit(1);
}
console.log("verify-guard-deploy-approval: OK");
