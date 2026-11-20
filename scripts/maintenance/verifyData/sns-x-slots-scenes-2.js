/**
 * verify-sns-x-slots.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-x-slots.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { hqReserveRows, reserveDiff } from "../../sns/x-slots-check.js";

function scene1() {
  // ---- hq の config/x-slots.json との照合（scripts/sns/x-slots-check.js） ----
  test("x-slots-check: hq の取り置きを表の行に直し、違いと越えを出す", () => {
    const config = {
      daily_limit_x: 9,
      reserve: {
        full_picture: 4,
        today: 1,
        finals: 3,
        research_rank: { count: 1, weekdays: ["mon", "wed", "fri"] },
      },
    };
    const { rows, unknown } = hqReserveRows(config);
    assert.deepEqual(unknown, []);
    assert.deepEqual(rows, [
      { kind: "full_picture", daily_count: 4, weekdays: null },
      { kind: "digest", daily_count: 1, weekdays: null },
      { kind: "finals_image", daily_count: 3, weekdays: null },
      { kind: "research_image", daily_count: 1, weekdays: [1, 3, 5] },
    ]);
    assert.deepEqual(
      hqReserveRows({ reserve: { other_type: 1 } }).unknown,
      ["other_type"],
    );
    const diff = reserveDiff(
      rows,
      [
        { kind: "full_picture", daily_count: 4, weekdays: null },
        { kind: "digest", daily_count: 1, weekdays: null },
        { kind: "finals_image", daily_count: 3, weekdays: null },
      ],
      { hqLimit: 9, dbLimit: 8 },
    );
    assert.equal(diff.ok, false);
    assert.ok(diff.lines.some((l) => /research_image/.test(l)));
    assert.ok(diff.lines.some((l) => /daily_limit_x/.test(l)));
    assert.ok(
      diff.sql.some((s) => /INSERT INTO public\.sns_x_kind_reserves/.test(s)),
    );
    // 曜日の並びの違いは違いとしない。hq の上限が無い・不正なら投げる（undefined の SQL を出さない）
    assert.equal(
      reserveDiff(
        [{ kind: "r", daily_count: 1, weekdays: [1, 3, 5] }],
        [{ kind: "r", daily_count: 1, weekdays: [5, 1, 3] }],
        { hqLimit: 9, dbLimit: 9 },
      ).ok,
      true,
    );
    assert.throws(
      () => reserveDiff(rows, rows, { hqLimit: undefined, dbLimit: 9 }),
      /daily_limit_x が不正/,
    );
    // /today の返信の型が有効なのに digest の取り置きが2未満なら違いとして出す（hq 2026-10-27）
    const one = [{ kind: "digest", daily_count: 1, weekdays: null }];
    const two = [{ kind: "digest", daily_count: 2, weekdays: null }];
    assert.equal(
      reserveDiff(one, one, { hqLimit: 9, dbLimit: 9 }).ok,
      true,
    );
    const replyOn = reserveDiff(one, one, {
      hqLimit: 9,
      dbLimit: 9,
      todayReplyEnabled: true,
    });
    assert.equal(replyOn.ok, false);
    assert.equal(
      replyOn.lines.filter((l) => /reply_enabled=true.*digest の取り置きが 1/.test(l))
        .length,
      2,
    );
    assert.equal(
      reserveDiff(two, two, { hqLimit: 9, dbLimit: 9, todayReplyEnabled: true })
        .ok,
      true,
    );
    // 曜日ごとの取り置きの合計が上限を越えると知らせる
    const over = reserveDiff(rows, rows, { hqLimit: 8, dbLimit: 8 });
    assert.ok(over.lines.some((l) => /越える/.test(l)));
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runSnsXSlotsScenes3() {
  scene1();
}
