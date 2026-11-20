/**
 * verify-guard-pr-merge.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-guard-pr-merge.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { judgeE2eScope, judgeAutoWorkflowChange } from "../guard-pr-merge.js";
import { greenWith } from "./guard-pr-merge-scenes-1.js";

let check;

function scene1() {
  check(
    "e2e の集約が緑でなければここでは判定しない（judgeChecks が扱う）",
    judgeE2eScope("1", "full", greenWith("e2e", "FAILURE")),
    null,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runGuardPrMergeScenes3(env) {
  ({ check } = env);
  scene1();
}

function scene2() {
  check(
    "--auto でワークフローを変える PR は手のマージに回す",
    judgeAutoWorkflowChange("1", [".github/workflows/e2e-smoke-test.yml"])
      ?.decision,
    "ask",
  );
  check(
    "--auto でワークフローを変えない PR は止めない",
    judgeAutoWorkflowChange("1", ["public/blog/a.md"]),
    null,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runGuardPrMergeScenes4(env) {
  ({ check } = env);
  scene2();
}
