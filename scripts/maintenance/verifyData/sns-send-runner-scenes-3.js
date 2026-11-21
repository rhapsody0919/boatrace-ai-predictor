/**
 * verify-sns-send-runner.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { runSnsSend, createSnsSendStore } from "../../lib/snsSendRunner.js";

let db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2;

// 非公開のまま残した job を作り、期限とリースを過去にする
async function retainedJob({ withChild = false } = {}) {
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
  const child = withChild
    ? await approvedJob("youtube", { parentJobId: y.id })
    : null;
  await db.query(
    "UPDATE sns_x_send_jobs SET expires_at=now()-interval '1 minute', lease_until=now()-interval '1 minute' WHERE id=$1",
    [y.id],
  );
  return { y, child };
}

const lookupAdapter = (result) => {
  const adapter = {
    calls: 0,
    async lookup(j) {
      adapter.calls += 1;
      return {
        confirmed: false,
        owned: true,
        id: j.external_post_id,
        privacyStatus: "private",
        posted_at: null,
        ...result,
      };
    },
  };
  return adapter;
};

// ---- BOA-1201: 送らなかった理由を sns_send_events（191）に (job, 段, 理由) ごとに初出だけ残す ----

export const events = async () =>
  (
    await db.query(
      "SELECT job_id, stage, reason, detail FROM sns_send_events ORDER BY at, reason",
    )
  ).rows;

function scene1() {
  test("BOA-1164 閉じる: 期限とリースの後、自分の非公開の動画と確かめたら公開しないで閉じ、子の Shorts は held（parent_closed）。要照合の通知は止まる", async () => {
    const { y, child } = await retainedJob({ withChild: true });
    const youtube = lookupAdapter({});
    const notices = [];
    const result = await runSnsSend(
      ctx(),
      deps({
        adapters: { youtube: async () => youtube },
        notify: async (t) => notices.push(t),
      }),
    );
    const row = await job(y.id);
    assert.equal(row.state, "cancelled");
    assert.equal(row.error_code, "youtube_closed_private");
    assert.equal(row.youtube_stage, "private_retained");
    assert.equal(row.external_post_id, "abcdefghijk");
    assert.equal((await job(child.id)).state, "held");
    assert.equal((await job(child.id)).error_code, "parent_closed");
    assert.equal(youtube.calls, 1);
    assert.equal(
      Number(
        (
          await first(
            "SELECT count(*) n FROM sns_youtube_quota_reads WHERE job_id=$1",
            [y.id],
          )
        ).n,
      ),
      1,
    );
    assert.equal(
      result.report.alerts.some((a) => a.key === `reconcile:${y.id}`),
      false,
    );
    assert.equal(
      notices.filter((t) => t.includes("公開しないで閉じた")).length,
      1,
    );
  });
  test("BOA-1164 閉じない: 公開になっていたら要照合のまま理由を出し、30分は読み直さない。shadow では閉じない", async () => {
    const { y } = await retainedJob();
    const youtube = lookupAdapter({ privacyStatus: "public" });
    const shadow = await runSnsSend(
      ctx("shadow"),
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal(youtube.calls, 0);
    assert.equal(
      shadow.report.alerts.some((a) => a.key === `reconcile:${y.id}`),
      true,
    );
    const firstRun = await runSnsSend(
      ctx(),
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal((await job(y.id)).state, "reconcile");
    assert.match(
      firstRun.report.alerts.find((a) => a.key === `reconcile:${y.id}`).text,
      /閉じられない: youtube_close_not_private/,
    );
    const again = await runSnsSend(
      { ...ctx(), state: { last_report: firstRun.report } },
      deps({ adapters: { youtube: async () => youtube } }),
    );
    assert.equal(youtube.calls, 1);
    assert.deepEqual(
      again.report.close_retry.map((r) => r.id),
      [y.id],
    );
  });
}

function scene2() {
  test("BOA-1164 閉じる遷移の DB の条件: 読み取りなし・古い読み取り・非公開でない・他人の動画・ID 違い・期限の前・リース中・update_started は拒否する", async () => {
    const { y } = await retainedJob();
    const close = (r = {}) =>
      store.transition(y.id, "youtube_close_private", {
        owned: true,
        privacyStatus: "private",
        id: "abcdefghijk",
        ...r,
      });
    await assert.rejects(close(), /youtube_close_lookup_missing/);
    await store.transition(y.id, "youtube_lookup");
    await db.query(
      "UPDATE sns_youtube_quota_reads SET created_at=now()-interval '11 minutes' WHERE job_id=$1",
      [y.id],
    );
    await assert.rejects(close(), /youtube_close_lookup_missing/);
    await store.transition(y.id, "youtube_lookup");
    await assert.rejects(
      close({ privacyStatus: "unlisted" }),
      /youtube_close_not_private/,
    );
    await assert.rejects(close({ owned: false }), /youtube_close_not_private/);
    await assert.rejects(
      close({ id: "zzzzzzzzzzz" }),
      /youtube_close_not_private/,
    );
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=now()+interval '5 minutes' WHERE id=$1",
      [y.id],
    );
    await assert.rejects(close(), /youtube_close_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=now()-interval '1 minute', lease_until=now()+interval '1 minute' WHERE id=$1",
      [y.id],
    );
    await assert.rejects(close(), /youtube_close_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET lease_until=NULL, youtube_stage='update_started' WHERE id=$1",
      [y.id],
    );
    await assert.rejects(close(), /youtube_close_not_allowed/);
    await db.query(
      "UPDATE sns_x_send_jobs SET youtube_stage='private_retained' WHERE id=$1",
      [y.id],
    );
    assert.equal((await close()).state, "cancelled");
    // 閉じた後は要照合でないので、もう一度は閉じない
    await assert.rejects(close(), /youtube_close_not_allowed/);
  });
  test("BOA-1164 PostgREST の読み取り: 閉じる候補は要照合・YouTube・private_retained・期限とリースの後だけを引く", async () => {
    const calls = [];
    const pg = createSnsSendStore({
      db: async (path) => {
        calls.push(decodeURIComponent(path));
        return [];
      },
      xSendStore: {},
    });
    await pg.retainedYoutubeJobs(new Date("2026-10-27T03:00:00Z"), 4);
    assert.equal(
      calls[0],
      "sns_x_send_jobs?state=eq.reconcile&channel=eq.youtube&youtube_stage=eq.private_retained&expires_at=lte.2026-10-27T03:00:00.000Z&or=(lease_until.is.null,lease_until.lte.2026-10-27T03:00:00.000Z)&order=id.asc&limit=4&select=id,channel,state,youtube_stage,error_code,external_post_id,attempts,expires_at,snapshot",
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenes3(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  scene1();
  scene2();
}

function scene3() {
  test("BOA-1164 閉じる: YouTube で削除済み（videos.list の items が空）なら youtube_closed_deleted で閉じる。DB も found=false を受ける", async () => {
    const { y } = await retainedJob();
    const youtube = lookupAdapter({
      found: false,
      owned: false,
      id: null,
      privacyStatus: null,
    });
    const notices = [];
    await runSnsSend(
      ctx(),
      deps({
        adapters: { youtube: async () => youtube },
        notify: async (t) => notices.push(t),
      }),
    );
    const row = await job(y.id);
    assert.equal(row.state, "cancelled");
    assert.equal(row.error_code, "youtube_closed_deleted");
    assert.equal(row.external_post_id, "abcdefghijk");
    assert.equal(
      notices.filter((t) => t.includes("公開しないで閉じた")).length,
      1,
    );
    // found が false 以外（未指定・true）なら、非公開の確認が要る
    const { y: other } = await retainedJob2();
    await store.transition(other.id, "youtube_lookup");
    await assert.rejects(
      store.transition(other.id, "youtube_close_private", {}),
      /youtube_close_not_private/,
    );
    await assert.rejects(
      store.transition(other.id, "youtube_close_private", { found: true }),
      /youtube_close_not_private/,
    );
    assert.equal(
      (
        await store.transition(other.id, "youtube_close_private", {
          found: false,
        })
      ).error_code,
      "youtube_closed_deleted",
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenes4(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  scene3();
}

function scene4() {
  test("BOA-1201 理由の記録: 送る前の検査に落ちると stage=precheck の1行が入る", async () => {
    const j = await approvedJob("x");
    await runSnsSend(ctx(), deps({ preflight: failingPreflight }));
    assert.deepEqual(await events(), [
      {
        job_id: j.id,
        stage: "precheck",
        reason: "source_check_unconfigured",
        detail: "source_check_unconfigured",
      },
    ]);
  });
  test("BOA-1201 理由の記録: 同じ理由で3回回しても1行のまま。理由が変わると2行になる", async () => {
    const j = await approvedJob("x");
    for (let i = 0; i < 3; i++)
      await runSnsSend(ctx(), deps({ preflight: failingPreflight }));
    assert.equal((await events()).length, 1);
    // created_at 順の検査なので、別の理由を記録する前に固定時計を進める。
    mock.timers.tick(1);
    await runSnsSend(
      ctx(),
      deps({
        preflight: async () => {
          throw new Error("source_changed");
        },
      }),
    );
    assert.deepEqual(
      (await events()).map((e) => [e.job_id, e.stage, e.reason]),
      [
        [j.id, "precheck", "source_check_unconfigured"],
        [j.id, "precheck", "source_changed"],
      ],
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenes5(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  scene4();
}
