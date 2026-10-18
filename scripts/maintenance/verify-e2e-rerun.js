#!/usr/bin/env node
/**
 * e2e-rerun.js の判定（再実行は1回まで、2回目の失敗は上げる、止まったものは cancel してから再実行）を、
 * 固定の入力で検査する。gh・GitHub・実時刻には触らない。
 */

import { failedJobNames, judgeE2eRun, stuckJobNames } from "./e2e-rerun.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const NOW = Date.parse("2026-10-18T03:00:00Z");
const minutesAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const job = (name, status, conclusion, startedMinutesAgo = 10) => ({
  name,
  status,
  conclusion,
  startedAt: minutesAgo(startedMinutesAgo),
});
const action = (input) => judgeE2eRun({ now: NOW, ...input }).action;

// --- 成功・実行中 ---
check(
  "成功なら何もしない",
  action({ run: { status: "completed", conclusion: "success", attempt: 1 } }),
  "ok",
);
check(
  "2回目で成功なら何もしない",
  action({ run: { status: "completed", conclusion: "success", attempt: 2 } }),
  "ok",
);
check(
  "実行中で50分以内なら待つ",
  action({
    run: { status: "in_progress", attempt: 1 },
    jobs: [job("e2e-shard (3/3)", "in_progress", "", 36)],
  }),
  "wait",
);
check(
  "queued（runner 待ち）は止まったとみなさない",
  action({ run: { status: "queued", attempt: 1 }, jobs: [] }),
  "wait",
);
check("実行が無ければ none", action({ run: undefined }), "none");

// --- 1回目の失敗・止まり → 再実行 ---
check(
  "1回目の失敗は再実行",
  action({
    run: { status: "completed", conclusion: "failure", attempt: 1 },
    jobs: [
      job("e2e-shard (3/3)", "completed", "failure"),
      job("e2e", "completed", "failure"),
    ],
  }),
  "rerun",
);
check(
  "1回目の cancelled も再実行",
  action({ run: { status: "completed", conclusion: "cancelled", attempt: 1 } }),
  "rerun",
);
// 2026-10-18、#1621 の e2e が36分止まった。e2e-shard に timeout-minutes が無く、既定の6時間まで終わらない
check(
  "1回目で shard が50分を超えて実行中なら cancel して再実行",
  action({
    run: { status: "in_progress", attempt: 1 },
    jobs: [
      job("e2e-shard (1/3)", "completed", "success", 60),
      job("e2e-shard (3/3)", "in_progress", "", 51),
    ],
  }),
  "cancel-rerun",
);
check(
  "止まったとみなす分は変えられる",
  action({
    run: { status: "in_progress", attempt: 1 },
    jobs: [job("e2e-shard (3/3)", "in_progress", "", 36)],
    stuckMinutes: 30,
  }),
  "cancel-rerun",
);

// --- 2回目の失敗・止まり → 上げる（再実行は1回まで） ---
const second = judgeE2eRun({
  now: NOW,
  run: { status: "completed", conclusion: "failure", attempt: 2 },
  jobs: [
    job("e2e", "completed", "failure"),
    job("e2e-shard (3/3)", "completed", "failure"),
  ],
  previousFailed: ["e2e", "e2e-shard (3/3)"],
});
check("2回目の失敗は上げる", second.action, "escalate");
check(
  "同じジョブが落ちたことを書く",
  second.reason.includes("1回目と同じジョブ"),
  true,
);
const different = judgeE2eRun({
  now: NOW,
  run: { status: "completed", conclusion: "failure", attempt: 2 },
  jobs: [job("e2e-shard (1/3)", "completed", "failure")],
  previousFailed: ["e2e-shard (3/3)"],
});
check("2回目に別のジョブが落ちても上げる", different.action, "escalate");
check(
  "別のジョブなら1回目に落ちたジョブを書く",
  different.reason.includes("1回目に落ちたのは e2e-shard (3/3)"),
  true,
);
check(
  "2回目で止まったら上げる（cancel しない）",
  action({
    run: { status: "in_progress", attempt: 2 },
    jobs: [job("e2e-shard (3/3)", "in_progress", "", 55)],
  }),
  "escalate",
);
check(
  "3回目以降も上げる",
  action({ run: { status: "completed", conclusion: "failure", attempt: 3 } }),
  "escalate",
);

// --- 補助 ---
check(
  "落ちたジョブは failure・cancelled・timed_out を名前順で",
  failedJobNames([
    job("b", "completed", "timed_out"),
    job("a", "completed", "cancelled"),
    job("c", "completed", "success"),
    job("d", "completed", "skipped"),
  ]),
  ["a", "b"],
);
check(
  "開始時刻の無いジョブは止まったとみなさない",
  stuckJobNames(
    [{ name: "x", status: "in_progress", startedAt: null }],
    NOW,
    50,
  ),
  [],
);

if (failures.length > 0) {
  console.error("NG: e2e-rerun の判定の検査に失敗");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: e2e-rerun の判定${checked}件を検証`);
