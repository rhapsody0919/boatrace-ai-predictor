/**
 * verify-merge-order-guard.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-merge-order-guard.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let pending, expectGuard, isDeny, isAllow;

function scene1() {
  // ---------------------------------------------------------------------------
  // (f) --auto（2026-10-18、ruleset「master-checks」の導入に合わせて追加）
  // ---------------------------------------------------------------------------
  {
    const red = JSON.stringify([
      { name: "verify", state: "SUCCESS" },
      { name: "ml-tests", state: "FAILURE" },
      { name: "e2e", state: "IN_PROGRESS" },
    ]);
    const statusRule = (contexts) =>
      JSON.stringify([
        { type: "deletion" },
        {
          type: "required_status_checks",
          parameters: {
            required_status_checks: contexts.map((context) => ({ context })),
          },
        },
      ]);
    const enforced = statusRule(["verify", "e2e", "ml-tests"]);
    expectGuard(
      "(f) ruleset が必須チェックを持てば、--auto はチェックが赤でも通す",
      null,
      "gh pr merge 1621 --auto --squash",
      { FAKE_GH_CHECKS: red, FAKE_GH_RULES: enforced },
      isAllow,
    );
    expectGuard(
      "(f) --auto の無いマージは、ruleset があってもチェックで止める",
      null,
      "gh pr merge 1621 --squash",
      { FAKE_GH_CHECKS: red, FAKE_GH_RULES: enforced },
      (r) => isDeny(r) && r.includes("ml-tests"),
    );
    expectGuard(
      "(f) ruleset に必須チェックが無ければ、--auto でもチェックで止める（導入前の運用）",
      null,
      "gh pr merge 1621 --auto --squash",
      {
        FAKE_GH_CHECKS: red,
        FAKE_GH_RULES: JSON.stringify([{ type: "deletion" }]),
      },
      isDeny,
    );
    expectGuard(
      "(f) ruleset に ml-tests が欠けていれば、--auto でもチェックで止める",
      null,
      "gh pr merge 1621 --auto",
      { FAKE_GH_CHECKS: red, FAKE_GH_RULES: statusRule(["verify", "e2e"]) },
      isDeny,
    );
    expectGuard(
      "(f) ruleset を読めなければ、--auto でもチェックで止める",
      null,
      "gh pr merge 1621 --auto",
      { FAKE_GH_CHECKS: red },
      isDeny,
    );
    expectGuard(
      "(f) 同じPRを --auto なしでもマージするコマンドならチェックで止める",
      null,
      "gh pr merge 1621 --auto; gh pr merge 1621 --squash",
      { FAKE_GH_CHECKS: red, FAKE_GH_RULES: enforced },
      isDeny,
    );
    expectGuard(
      "(f) --auto でも、台帳で先行のPRが未マージなら止める",
      [{ pr: 901, after: [902] }],
      "gh pr merge 901 --auto",
      { FAKE_GH_STATES: "902=OPEN", FAKE_GH_RULES: enforced },
      (r) => isDeny(r) && r.includes("#902"),
    );
    expectGuard(
      "(f) --auto でも、台帳に制約があれば変数の番号は止める",
      [{ pr: 901, after: [902] }],
      "gh pr merge $n --auto",
      { FAKE_GH_STATES: "902=MERGED", FAKE_GH_RULES: enforced },
      (r) => isDeny(r) && r.includes("リテラル"),
    );
    // 以前は e2e が無い PR を素通りさせていた
    expectGuard(
      "(f) e2e の集約が無いPRは確認を挟む",
      null,
      "gh pr merge 1621 --squash",
      {
        FAKE_GH_CHECKS: JSON.stringify([
          { name: "verify", state: "SUCCESS" },
          { name: "ml-tests", state: "SUCCESS" },
        ]),
      },
      (r) => typeof r === "string" && r.startsWith("ask:") && r.includes("e2e"),
    );
  }
}

async function scene2() {
  await Promise.all(pending);
}

/** verify から呼ぶ入口。env は verify 側の束縛（pending・expectGuard・isDeny・isAllow） */
export async function runMergeOrderGuardScenes3(env) {
  ({ pending, expectGuard, isDeny, isAllow } = env);
  scene1();
  await scene2();
}
