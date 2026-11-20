/**
 * verify-setsu-exhibition.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-setsu-exhibition.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { readSetsuExhibition } from "../../sns/setsu-exhibition.js";
import { calls, date } from "./setsu-exhibition-scenes-1.js";

async function scene1() {
  assert.deepEqual(calls.find((c) => c.table === "motor_pretest_stats").filters, [
    ["eq", "venue_code", 1],
    ["eq", "race_date", "2026-10-30"],
  ]);
  assert.deepEqual(
    calls.filter((c) => c.table === "races")[1].filters,
    [
      ["eq", "venue_code", 1],
      ["gte", "race_date", "2026-10-30"],
      ["lte", "race_date", "2026-11-03"],
    ],
    "翌日の優勝戦の出走表まで読む",
  );
  assert.ok(
    calls
      .find((c) => c.table === "race_entries")
      .select.split(",")
      .includes("grade"),
  );
  assert.ok(
    calls
      .find((c) => c.table === "races")
      .select.split(",")
      .includes("start_time"),
  );
  assert.deepEqual(await readSetsuExhibition(date, async () => []), {
    date,
    meets: [],
  });
  await assert.rejects(
    readSetsuExhibition(date, async () => {
      throw new Error("read failed");
    }),
    /read failed/,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export async function runSetsuExhibitionScenes4() {
  await scene1();
}
