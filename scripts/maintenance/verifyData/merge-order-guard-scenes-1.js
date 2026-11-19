/**
 * verify-merge-order-guard.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-merge-order-guard.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  judgeMergeOrder,
  prerequisitesOf,
  parseLedger,
  addRule,
  removeRule,
} from "../../lib/mergeOrder.js";

let check, repo, otherRepo, pending, expectGuard, isDeny, isAllow, verifyCli;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
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
  return { ledger, open917, isUnresolvedDeny, includes917 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ ledger, open917, isUnresolvedDeny, includes917 }) {
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

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・repo・otherRepo・pending・expectGuard・isDeny・isAllow・verifyCli） */
export function runMergeOrderGuardScenes1(env) {
  ({ check, repo, otherRepo, pending, expectGuard, isDeny, isAllow, verifyCli } = env);
  scene3();
}

function scene4() {
  pending.push(verifyCli());
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・repo・otherRepo・pending・expectGuard・isDeny・isAllow・verifyCli） */
export function runMergeOrderGuardScenes2(env) {
  ({ check, repo, otherRepo, pending, expectGuard, isDeny, isAllow, verifyCli } = env);
  scene4();
}
