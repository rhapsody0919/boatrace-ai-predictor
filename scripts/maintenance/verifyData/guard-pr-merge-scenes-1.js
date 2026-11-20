/**
 * verify-guard-pr-merge.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-guard-pr-merge.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  findWorktreePath,
  judgeChecks,
  judgeWorktree,
  judgeE2eScope,
} from "../guard-pr-merge.js";

let check, shardsSkipped;
let porcelain, shardsGreen;

// --- チェック結果の判定（止まる側も必ず確かめる） ---
export const green = [
  { name: "verify", state: "SUCCESS" },
  { name: "ml-tests", state: "SUCCESS" },
  { name: "e2e", state: "SUCCESS" },
];

/** green のうち name だけを差し替える（state が null なら取り除く） */
export const greenWith = (name, state) =>
  green
    .filter((c) => c.name !== name || state !== null)
    .map((c) => (c.name === name ? { name, state } : c));

function scene1() {
  // --- worktree の探索 ---
  porcelain = [
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
}

function scene2() {
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
    judgeChecks("1", greenWith("e2e", "FAILURE")).reason.includes(
      "e2e が FAILURE",
    ),
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runGuardPrMergeScenes1(env) {
  ({ check } = env);
  scene1();
  scene2();
}

function scene3() {
  shardsGreen = [
    ...green,
    { name: "e2e-shard (1/3)", state: "SUCCESS" },
    { name: "e2e-shard (2/3)", state: "SUCCESS" },
    { name: "e2e-shard (3/3)", state: "SUCCESS" },
    { name: "e2e-light", state: "SKIPPED" },
  ];
  check(
    "全部流すべき PR で shard が skip なら止める",
    judgeE2eScope("1", "full", shardsSkipped)?.decision,
    "deny",
  );
  check(
    "全部流すべき PR で shard が1つも無ければ止める",
    judgeE2eScope("1", "full", green)?.decision,
    "deny",
  );
  check(
    "全部流すべき PR で shard が全部成功なら止めない",
    judgeE2eScope("1", "full", shardsGreen),
    null,
  );
  check(
    "軽い組の PR は shard が skip でも止めない",
    judgeE2eScope("1", "light", shardsSkipped),
    null,
  );
  check("docs だけの PR は止めない", judgeE2eScope("1", "none", green), null);
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・shardsSkipped） */
export function runGuardPrMergeScenes2(env) {
  ({ check, shardsSkipped } = env);
  scene3();
}
