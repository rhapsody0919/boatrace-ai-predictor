/**
 * verify-sns-send-runner.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { runSnsSend, createSnsSendStore } from "../../lib/snsSendRunner.js";
import { events } from "./sns-send-runner-scenes-3.js";

let db, first, store, approvedJob, ctx, job, deps;

// ---- BOA-1283: 処理待ちで非公開のまま残した YouTube を、期限の前に読み直して公開する（196 の youtube_resume） ----

/** 1回目の実行で処理が終わらず残した job（期限の前、リースは切れた後）。2026-11-03 の Shorts 926ef626 と同じ形 */
export async function processingRetainedJob() {
  const y = await approvedJob("youtube");
  await runSnsSend(
    ctx(),
    deps({
      adapters: {
        youtube: async () =>
          createMockYoutubeAdapter({ processingStatus: "processing" }),
      },
    }),
  );
  const row = await job(y.id);
  assert.equal(row.youtube_stage, "private_retained");
  assert.equal(row.error_code, "youtube_retained_processing");
  // claim のリース（5分）が切れるまでは見直さない（同じ実行の続きと重ねない）。リース中は候補に出ないことも確かめる
  assert.deepEqual(await store.resumableYoutubeJobs(new Date(), 5), []);
  await db.query(
    "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [y.id],
  );
  return y;
}

const quotaReads = async (id) =>
  Number(
    (
      await first(
        "SELECT count(*) n FROM sns_youtube_quota_reads WHERE job_id=$1",
        [id],
      )
    ).n,
  );

function scene1() {
  for (const [label, channel, adapters] of [
    [
      "X の投稿",
      "x",
      { x: async () => createMockXAdapter({ failAt: "createPost" }) },
    ],
    [
      "YouTube のアップロード",
      "youtube",
      { youtube: async () => createMockYoutubeAdapter({ failAt: "upload" }) },
    ],
    [
      "YouTube の公開",
      "youtube",
      { youtube: async () => createMockYoutubeAdapter({ failAt: "update" }) },
    ],
  ])
    test(`BOA-1201 begin_post の後の失敗は stage=after_post（${label}、要照合）`, async () => {
      const j = await approvedJob(channel);
      const result = await runSnsSend(
        ctx(),
        deps({ adapters: { ...deps().adapters, ...adapters } }),
      );
      assert.equal(result.body.jobs[0].outcome, "error");
      assert.equal((await job(j.id)).state, "reconcile");
      assert.deepEqual(
        (await events()).map((e) => [e.job_id, e.stage, e.reason]),
        [[j.id, "after_post", "mock_failure"]],
      );
    });
  test("BOA-1283 見直し: 処理待ちで残した job は、次の実行で読み直して処理が済んでいれば公開する（処理の確認の3回の上限は使わない）", async () => {
    const y = await processingRetainedJob();
    const youtube = createMockYoutubeAdapter({ processingStatus: "succeeded" });
    const checks = [];
    const result = await runSnsSend(
      ctx(),
      deps({
        adapters: { youtube: async () => youtube },
        preflight: async (j) => checks.push(j.id),
      }),
    );
    const row = await job(y.id);
    assert.equal(row.state, "posted");
    assert.equal(row.error_code, null);
    assert.equal(row.external_post_id, "abcdefghijk");
    assert.deepEqual(
      youtube.calls.map((c) => c.method),
      ["videos.list:processing", "videos.update", "videos.list"],
    );
    // 公開の前の検査は2回（youtube_publish_begin の前・videos.update の前）
    assert.equal(checks.length, 2);
    assert.equal(await quotaReads(y.id), 1);
    const attempt = await first(
      "SELECT processing_polls, calls FROM sns_youtube_quota_attempts WHERE job_id=$1",
      [y.id],
    );
    assert.equal(attempt.processing_polls, 3);
    assert.deepEqual(attempt.calls, [
      "videos.insert",
      "videos.update",
      "videos.list",
    ]);
    assert.deepEqual(result.body.jobs, [
      {
        id: y.id,
        channel: "youtube",
        resumed: true,
        outcome: "posted",
        error_code: null,
      },
    ]);
    assert.equal(result.rowsWritten, 1);
  });
}

function scene2() {
  test("BOA-1283 見直し: まだ処理中なら何も変えずに残し、次の実行でまた読む。処理の失敗は見直しの対象から外す", async () => {
    const y = await processingRetainedJob();
    const still = createMockYoutubeAdapter({ processingStatus: "processing" });
    const first1 = await runSnsSend(
      ctx(),
      deps({ adapters: { youtube: async () => still } }),
    );
    assert.equal(first1.body.jobs[0].outcome, "youtube_still_processing");
    let row = await job(y.id);
    assert.equal(row.state, "reconcile");
    assert.equal(row.youtube_stage, "private_retained");
    assert.equal(row.error_code, "youtube_retained_processing");
    assert.equal(
      still.calls.some((c) => c.method === "videos.update"),
      false,
    );
    const failed = createMockYoutubeAdapter({ processingStatus: "failed" });
    const notices = [];
    await runSnsSend(
      ctx(),
      deps({
        adapters: { youtube: async () => failed },
        notify: async (t) => notices.push(t),
      }),
    );
    row = await job(y.id);
    assert.equal(row.youtube_stage, "private_retained");
    assert.equal(row.error_code, "youtube_retained_error");
    assert.equal(
      notices.filter((t) => t.includes("公開に進められなかった")).length,
      1,
    );
    const after = createMockYoutubeAdapter({ processingStatus: "succeeded" });
    const third = await runSnsSend(
      ctx(),
      deps({ adapters: { youtube: async () => after } }),
    );
    assert.deepEqual(third.body.jobs, []);
    assert.equal(after.calls.length, 0);
    assert.equal(await quotaReads(y.id), 2);
  });
  test("BOA-1283 見直し: 期限の後・試運転・shadow・検査の枠が足りない実行では読み直さない", async () => {
    const y = await processingRetainedJob();
    const youtube = createMockYoutubeAdapter({ processingStatus: "succeeded" });
    await runSnsSend(
      ctx("shadow"),
      deps({ adapters: { youtube: async () => youtube } }),
    );
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='youtube'",
    );
    await runSnsSend(ctx(), deps({ adapters: { youtube: async () => youtube } }));
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='youtube'",
    );
    // 先に X が検査を3回使った実行では、公開に要る2回が枠（4）に入らないので次の実行に回す
    await approvedJob("x");
    const x = await runSnsSend(
      ctx(),
      deps({
        adapters: {
          x: async () => createMockXAdapter(),
          youtube: async () => youtube,
        },
        headlessBudget: 4,
      }),
    );
    assert.equal(
      x.body.jobs.some((r) => r.id === y.id),
      false,
    );
    assert.equal(youtube.calls.length, 0);
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=now()-interval '1 minute' WHERE id=$1",
      [y.id],
    );
    assert.deepEqual(await store.resumableYoutubeJobs(new Date(), 5), []);
  });
}

function scene3() {
  test("BOA-1283 見直しの DB の条件: 読み取りなし・処理中・他人の動画・ID 違い・期限の後・リース中・理由が check_failed は拒否し、検査の枠で残した job は受ける", async () => {
    const y = await processingRetainedJob();
    const resume = (r = {}) =>
      store.transition(y.id, "youtube_resume", {
        owned: true,
        privacyStatus: "private",
        id: "abcdefghijk",
        processingStatus: "succeeded",
        ...r,
      });
    await assert.rejects(resume(), /youtube_resume_lookup_missing/);
    await store.transition(y.id, "youtube_lookup");
    await assert.rejects(
      resume({ processingStatus: "processing" }),
      /youtube_resume_not_processed/,
    );
    await assert.rejects(
      resume({ owned: false }),
      /youtube_resume_not_processed/,
    );
    await assert.rejects(
      resume({ id: "zzzzzzzzzzz" }),
      /youtube_resume_not_processed/,
    );
    await assert.rejects(
      resume({ privacyStatus: "public" }),
      /youtube_resume_not_processed/,
    );
    await db.query(
      "UPDATE sns_x_send_jobs SET lease_until=now()+interval '1 minute' WHERE id=$1",
      [y.id],
    );
    await assert.rejects(resume(), /youtube_resume_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET lease_until=NULL, expires_at=now() WHERE id=$1",
      [y.id],
    );
    await assert.rejects(resume(), /youtube_resume_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=now()+interval '20 minutes', error_code='youtube_retained_check_failed' WHERE id=$1",
      [y.id],
    );
    await assert.rejects(resume(), /youtube_resume_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET error_code='youtube_retained_budget' WHERE id=$1",
      [y.id],
    );
    const ready = await resume();
    assert.equal(ready.youtube_stage, "ready");
    assert.equal(ready.error_code, null);
    assert.equal(ready.state, "reconcile");
  });
  test("BOA-1283 PostgREST の読み取り: 見直す候補は要照合・YouTube・（private_retained で理由が処理待ちか検査の枠、または error_code なしの ready）・期限の前・リースの後だけを引く", async () => {
    const calls = [];
    const pg = createSnsSendStore({
      db: async (path) => {
        calls.push(decodeURIComponent(path));
        return [];
      },
      xSendStore: {},
    });
    await pg.resumableYoutubeJobs(new Date("2026-10-27T03:00:00Z"), 2);
    assert.equal(
      calls[0],
      "sns_x_send_jobs?state=eq.reconcile&channel=eq.youtube&expires_at=gt.2026-10-27T03:00:00.000Z&and=(or(and(youtube_stage.eq.private_retained,error_code.in.(youtube_retained_processing,youtube_retained_budget)),and(youtube_stage.eq.ready,error_code.is.null)),or(lease_until.is.null,lease_until.lte.2026-10-27T03:00:00.000Z))&order=expires_at.asc,id.asc&limit=2&select=id,channel,state,youtube_stage,error_code,external_post_id,attempts,expires_at,snapshot",
    );
  });
  test("BOA-1283 見直し（審査 P2-1）: カバーのある job は thumbnails.set を台帳に記録した後だけ ready に戻す", async () => {
    const y = await processingRetainedJob();
    await db.query(
      `UPDATE sns_x_send_jobs SET snapshot=jsonb_set(snapshot,'{media}',snapshot->'media' || '[{"type":"image/png","path":"c.png"}]'::jsonb) WHERE id=$1`,
      [y.id],
    );
    await store.transition(y.id, "youtube_lookup");
    const resume = () =>
      store.transition(y.id, "youtube_resume", {
        owned: true,
        privacyStatus: "private",
        id: "abcdefghijk",
        processingStatus: "succeeded",
      });
    await assert.rejects(resume(), /youtube_resume_not_allowed/);
    await db.query(
      "UPDATE sns_youtube_quota_attempts SET calls=array_append(calls,'thumbnails.set') WHERE job_id=$1",
      [y.id],
    );
    assert.equal((await resume()).youtube_stage, "ready");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・job・deps） */
export function runSnsSendRunnerScenes7(env) {
  ({ db, first, store, approvedJob, ctx, job, deps } = env);
  scene1();
  scene2();
  scene3();
}
