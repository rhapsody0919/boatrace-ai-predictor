/**
 * verify-sns-shorts-send.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-shorts-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { endOfDayIn } from "./sns-shorts-send-scenes-1.js";

let db, first, enable, job, run;

function scene1() {
  test("案B: JSTだけ跨いだuploadは当日baseline更新済みでも公開せず残置", async () => {
    await enable();
    await db.query("UPDATE test_clock SET value=$1", [
      await endOfDayIn("Asia/Tokyo"),
    ]);
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date; UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
    );
    const j = await job();
    const youtube = createMockYoutubeAdapter({
      afterUpload: async () =>
        db.exec(
          "UPDATE test_clock SET value=value+interval '2 seconds'; UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
        ),
    });
    await assert.rejects(run(j, youtube), /guard/);
    assert(!youtube.calls.some((c) => c.method === "videos.update"));
    const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      j.id,
    ]);
    assert.equal(saved.youtube_stage, "private_retained");
    assert.equal(
      (
        await first(
          "SELECT baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date same FROM sns_youtube_quota_control",
        )
      ).same,
      true,
    );
  });
  test("案B: 処理確認がpublic/未確認を返した場合は非公開と断定しない", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter();
    youtube.processing = async () => ({
      confirmed: true,
      id: "abcdefghijk",
      privacyStatus: "public",
      processingStatus: "succeeded",
    });
    await assert.rejects(run(j, youtube), /processing_unconfirmed/);
    const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      j.id,
    ]);
    assert.equal(saved.state, "reconcile");
    assert.equal(saved.youtube_stage, "uploaded");
    assert(!youtube.calls.some((c) => c.method === "videos.update"));
  });
  test("案B: 動画処理失敗は公開せず非公開残置を記録する", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({ processingStatus: "failed" });
    await assert.rejects(run(j, youtube), /processing_failed/);
    assert(!youtube.calls.some((c) => c.method === "videos.update"));
    assert.equal(
      (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
      "private_retained",
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・enable・job・run） */
export function runSnsShortsSendScenes2(env) {
  ({ db, first, enable, job, run } = env);
  scene1();
}
