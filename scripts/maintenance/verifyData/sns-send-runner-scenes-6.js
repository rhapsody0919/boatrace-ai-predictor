/**
 * verify-sns-send-runner.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { runSnsSend } from "../../lib/snsSendRunner.js";
import { processingRetainedJob } from "./sns-send-runner-scenes-5.js";

let db, store, ctx, job, deps;

function scene1() {
  test("BOA-1283 見直し（審査 P2-3）: 読み取りに失敗した job は10分は読み直さず、Slack も1回だけ", async () => {
    const y = await processingRetainedJob();
    const youtube = createMockYoutubeAdapter({ failAt: "processing" });
    const notices = [];
    const run = (state) =>
      runSnsSend(
        { ...ctx(), state },
        deps({
          adapters: { youtube: async () => youtube },
          notify: async (t) => notices.push(t),
        }),
      );
    const firstRun = await run(undefined);
    assert.equal(firstRun.body.jobs[0].outcome, "error");
    assert.deepEqual(
      firstRun.report.resume_retry.map((r) => r.id),
      [y.id],
    );
    // 読み取りの失敗では残した理由を変えない（期限の後は閉じる道に任せる）
    assert.equal((await job(y.id)).error_code, "youtube_retained_processing");
    const again = await run({ last_report: firstRun.report });
    assert.deepEqual(again.body.jobs, []);
    assert.equal(
      youtube.calls.filter((c) => c.method === "videos.list:processing").length,
      1,
    );
    assert.equal(
      notices.filter((t) => t.includes("公開に進められなかった")).length,
      1,
    );
  });
  test("BOA-1283 見直し（審査 P2-2）: 実行の始まりから120秒を過ぎた実行では始めない", async () => {
    const y = await processingRetainedJob();
    const youtube = createMockYoutubeAdapter({ processingStatus: "succeeded" });
    const start = Date.now();
    let calls = 0;
    const late = {
      ...ctx(),
      // 1回目（実行の始まり）だけ今、以降は121秒後
      now: () => new Date(calls++ === 0 ? start : start + 121000),
    };
    const result = await runSnsSend(
      late,
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal(
      result.body.jobs.some((r) => r.id === y.id),
      false,
    );
    assert.equal(youtube.calls.length, 0);
    assert.equal((await job(y.id)).youtube_stage, "private_retained");
  });
  test("BOA-1283 見直し（/code-review）: 公開の段の途中で実行が切れて ready のままリースも切れた job は、次の実行で読み直して公開する。youtube_resume はリースを付ける", async () => {
    const y = await processingRetainedJob();
    await store.transition(y.id, "youtube_lookup");
    const ready = await store.transition(y.id, "youtube_resume", {
      owned: true,
      privacyStatus: "private",
      id: "abcdefghijk",
      processingStatus: "succeeded",
    });
    assert.ok(Date.parse(ready.lease_until) > Date.now());
    // リース中は候補に出ない。切れたら（実行が落ちた）拾う
    assert.deepEqual(await store.resumableYoutubeJobs(new Date(), 5), []);
    await db.query(
      "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
      [y.id],
    );
    const youtube = createMockYoutubeAdapter({ processingStatus: "succeeded" });
    const result = await runSnsSend(
      ctx(),
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal(result.body.jobs[0].outcome, "posted");
    assert.equal((await job(y.id)).state, "posted");
  });
}

function scene2() {
  test("BOA-1283 見直し（/code-review）: 本人の非公開の動画と確かめられない job は期限まで読み直さない。トークンを取れなければ通知に残す", async () => {
    const y = await processingRetainedJob();
    const youtube = createMockYoutubeAdapter({ videoId: "zzzzzzzzzzz" });
    const firstRun = await runSnsSend(
      ctx(),
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal(firstRun.body.jobs[0].reason, "youtube_processing_unconfirmed");
    const retry = firstRun.report.resume_retry.find((r) => r.id === y.id);
    assert.equal(
      Date.parse(retry.until),
      Date.parse((await job(y.id)).expires_at),
    );
    assert.equal((await job(y.id)).error_code, "youtube_retained_processing");
    const noToken = await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () => {
            throw new Error("token_revoked");
          },
        },
      }),
    );
    assert.equal(noToken.body.jobs[0].outcome, "token_failed");
    assert.match(
      noToken.report.alerts.find((a) => a.key === "token:youtube").text,
      /見直していない: token_revoked/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・store・ctx・job・deps） */
export function runSnsSendRunnerScenes8(env) {
  ({ db, store, ctx, job, deps } = env);
  scene1();
  scene2();
}
