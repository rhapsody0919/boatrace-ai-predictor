/**
 * verify-sns-daily-runner.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-sns-daily-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnsDailyRunnerScenes3 } from "./sns-daily-runner-scenes-2.js";
import { runSnsDailyRunnerScenes4 } from "./sns-daily-runner-scenes-3.js";
import { runSnsDailyRunnerScenes5 } from "./sns-daily-runner-scenes-4.js";

let db,
  first,
  all,
  NOW,
  ctx,
  store,
  sdrState,
  mockYoutube,
  mockGa4,
  rows,
  sdrT1;

/** test("節の機力の Shorts（setsu_kiryoku_short）: 説明欄のリンクの utm_* と landingPage  の中身を割った 2/2 */
async function sdrT2({ a, b, c, qs }) {
  for (const q of qs)
    assert.deepEqual(
      q.dimensions.map((d) => d.name),
      ["date"],
    );
  assert.match(
    JSON.stringify(qs[0].dimensionFilter),
    /"matchType":"FULL_REGEXP","value":"\^\/venue\/0\?13\/\?\$"/,
  );
  const got = (
    await all(
      "SELECT day::text, channel, draft_id, utm_content, metric_name, metric_value::float v FROM sns_channel_daily WHERE definition LIKE '%setsu_kiryoku_short%'",
    )
  ).map((r) => [
    r.day,
    r.channel,
    { [a]: "a", [b]: "b", [c]: "c" }[r.draft_id] ?? r.draft_id,
    r.utm_content,
    r.metric_name,
    r.v,
  ]);
  assert.deepEqual(
    got.sort((p, q2) => JSON.stringify(p).localeCompare(JSON.stringify(q2))),
    [
      ["2026-10-13", "youtube", "a", "final_gap", "sessions", 3],
      ["2026-10-13", "youtube", "a", "final_gap", "users", 2],
      ["2026-10-14", "youtube", "b", "final_gap", "sessions", 2],
      ["2026-10-14", "youtube", "b", "final_gap", "users", 1],
      ["2026-10-14", "youtube", "c", "motor_up", "sessions", 1],
      ["2026-10-14", "youtube", "c", "motor_up", "users", 1],
      ["2026-10-15", "youtube", "b", "final_gap", "sessions", 1],
      ["2026-10-15", "youtube", "b", "final_gap", "users", 1],
    ],
  );
}

function sdrb1Scene1() {
  test("節の機力の Shorts（setsu_kiryoku_short）: 説明欄のリンクの utm_* と landingPage で下書きに結びつけ、投稿日と翌日だけ残す（BOA-1209）", async () => {
    const { a, b, c, qs } = await sdrT1();
    await sdrT2({ a, b, c, qs });
  });
  // ---- 後半の場面（verifyData/sns-daily-runner-scenes-2.js・sns-daily-runner-scenes-3.js・sns-daily-runner-scenes-4.js） ----
  runSnsDailyRunnerScenes3({
    first,
    all,
    ctx,
    store,
    sdrState,
    mockYoutube,
    mockGa4,
  });
  runSnsDailyRunnerScenes4({
    db,
    first,
    all,
    NOW,
    ctx,
    store,
    sdrState,
    mockYoutube,
    mockGa4,
    rows,
  });
  runSnsDailyRunnerScenes5({
    first,
    all,
    ctx,
    store,
    sdrState,
    mockYoutube,
    mockGa4,
    rows,
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・NOW・ctx・store・sdrState・mockYoutube・mockGa4・rows・sdrT1） */
export function runSnsDailyRunnerScenesB1(env) {
  ({
    db,
    first,
    all,
    NOW,
    ctx,
    store,
    sdrState,
    mockYoutube,
    mockGa4,
    rows,
    sdrT1,
  } = env);
  sdrb1Scene1();
}
