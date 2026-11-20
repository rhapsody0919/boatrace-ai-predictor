/**
 * verify-sns-deadline-queue.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-deadline-queue.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import { deadlineSchedule, fillFullUrl } from "../../../api/_lib/snsDeadlineQueue.js";
import { preflight } from "./sns-deadline-queue-scenes-1.js";

let db, first, store, queue, job, enable, run;

function scene1() {
  test("期限切れsweepと再承認後の版破損は外部呼出しゼロ", async () => {
    await enable();
    const expired = await job({
      q: { ...queue(), expires_at: new Date(Date.now() - 1).toISOString() },
    });
    await db.exec("SELECT sweep_sns_deadline_queue()");
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [expired.id]))
        .state,
      "held",
    );
    const j = await job(),
      x = createMockXAdapter();
    const corrupt = {
      async transition(id, action, result) {
        const value = await store.transition(id, action, result);
        return action === "claim" ? { ...value, snapshot_text: "{}" } : value;
      },
    };
    await assert.rejects(run(j, x, { store: corrupt }), /hash/);
    assert.equal(x.calls.length, 0);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・queue・job・enable・run） */
export function runSnsDeadlineQueueScenes4(env) {
  ({ db, first, store, queue, job, enable, run } = env);
  scene1();
}

function scene2() {
  test("begin_postでも当日の基準・上限を再検査し、日付またぎは保留", async () => {
    await enable();
    const a = await job();
    await store.transition(a.id, "claim");
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=daily_baseline_date-1",
    );
    await assert.rejects(store.transition(a.id, "begin_post"), /日次/);
    await enable(1);
    await db.exec("UPDATE sns_x_send_control SET daily_external_count=1");
    await assert.rejects(store.transition(a.id, "begin_post"), /日次/);
    await db.exec(
      "UPDATE test_clock SET value=date_trunc('day',now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo' + interval '23 hours 59 minutes'",
    );
    try {
      await enable();
      const t = (await first("SELECT test_now() t")).t;
      const deadline_at = new Date(Date.parse(t) + 7200000).toISOString();
      const b = await job({
        q: {
          ...queue(),
          deadline_at,
          ...deadlineSchedule(deadline_at),
          source_observed_at: new Date(t).toISOString(),
        },
      });
      await db.query(
        "UPDATE sns_x_send_jobs SET scheduled_at=test_now() WHERE id=$1",
        [b.id],
      );
      await store.transition(b.id, "claim");
      await db.exec("UPDATE test_clock SET value=value+interval '2 minutes'");
      await assert.rejects(store.transition(b.id, "begin_post"), /日次/);
      await db.exec(
        "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
      );
      assert.equal(
        (await store.transition(b.id, "begin_post")).error_code,
        "daily_claim_date_changed",
      );
    } finally {
      await db.exec("UPDATE test_clock SET value=NULL");
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・queue・job・enable・run） */
export function runSnsDeadlineQueueScenes5(env) {
  ({ db, first, store, queue, job, enable, run } = env);
  scene2();
}

function scene3() {
  test("全貌の Shorts: 親の無い {full_url} は送る前の検査で止める。置き換えは置き場所1つ・11字の ID だけ", async () => {
    await enable();
    const j = await job({
      platform: "youtube",
      q: { ...queue(), youtube_mode: "immediate" },
      text: "続きは {full_url} で",
    });
    await assert.rejects(preflight(j)(j), /unresolved_placeholder/);
    assert.equal(
      fillFullUrl("a {full_url} b", "abcdefghijk"),
      "a https://youtu.be/abcdefghijk b",
    );
    assert.throws(
      () => fillFullUrl("a b", "abcdefghijk"),
      /unresolved_placeholder/,
    );
    assert.throws(
      () => fillFullUrl("{full_url}{full_url}", "abcdefghijk"),
      /unresolved_placeholder/,
    );
    assert.throws(
      () => fillFullUrl("a {full_url}", "short"),
      /parent_video_id_invalid/,
    );
    assert.throws(
      () => fillFullUrl("a {full_url}", null),
      /parent_video_id_invalid/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・queue・job・enable・run） */
export function runSnsDeadlineQueueScenes6(env) {
  ({ db, first, store, queue, job, enable, run } = env);
  scene3();
}
