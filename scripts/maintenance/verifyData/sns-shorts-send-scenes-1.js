/**
 * verify-sns-shorts-send.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-shorts-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMockYoutubeAdapter,
  reconcileSendJob,
  runYoutubePublishJob,
} from "../../../api/_lib/snsDeadlineQueue.js";

let db, first, store, enable, job, run;

// base を含む tz の日付の終わり（翌日0時の1秒前）。PT の0時は夏時間で UTC 07:00、
// 冬時間で UTC 08:00 と動くため、UTC の時刻を決め打ちせず tz の暦で求める。
// base の既定は「今から1日後」。試験の時計を実時間より先に置き、job() の
// 承認（実時間の now() を予定時刻に渡す）が未来の予定にならないようにする。
export const endOfDayIn = async (tz, base = null) =>
  (
    await first(
      "SELECT ((date_trunc('day',coalesce($2::timestamptz,now()+interval '1 day') AT TIME ZONE $1)+interval '1 day') AT TIME ZONE $1)-interval '1 second' t",
      [tz, base],
    )
  ).t;

function scene1() {
  test("Shorts: service_roleの公開RPCだけ利用可、旧内部RPCでクォータを迂回できない", async () => {
    await enable();
    const j = await job();
    await db.exec("SET ROLE service_role");
    try {
      await assert.rejects(
        first("SELECT transition_sns_send_139($1,$2,$3)", [j.id, "claim", {}]),
        /permission denied/,
      );
      assert.equal((await run(j)).state, "posted");
    } finally {
      await db.exec("RESET ROLE");
    }
  });
  test("Shorts: カバー送信は50 units、同じAPI呼出しの再試行は拒否", async () => {
    await enable();
    const j = await job("cover.png");
    await run(j);
    const a = await first(
      "SELECT * FROM sns_youtube_quota_attempts WHERE job_id=$1",
      [j.id],
    );
    assert.deepEqual(a.calls, [
      "videos.insert",
      "thumbnails.set",
      "videos.update",
      "videos.list",
    ]);
    assert.equal(a.general_units_started, 102);
    const other = await job();
    await store.transition(other.id, "claim");
    await store.transition(other.id, "begin_post");
    await store.transition(other.id, "youtube_call", { method: "videos.insert" });
    await assert.rejects(
      store.transition(other.id, "youtube_call", { method: "videos.insert" }),
      /not_planned/,
    );
  });
  test("F01: 汎用YouTube照合も台帳で停止しlookupを呼ばない", async () => {
    await enable();
    const j = await job();
    await assert.rejects(run(j, createMockYoutubeAdapter({ failAt: "upload" })));
    const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      j.id,
    ]);
    let calls = 0;
    const lookup = async () => {
      calls++;
      return { confirmed: false };
    };
    await db.exec("UPDATE sns_youtube_quota_control SET verified=false");
    await assert.rejects(reconcileSendJob(uncertain, { store, lookup }), /quota/);
    assert.equal(calls, 0);
    await enable(100, 104);
    await assert.rejects(
      reconcileSendJob(uncertain, { store, lookup }),
      /quota_limit/,
    );
    assert.equal(calls, 0);
    await enable();
    await reconcileSendJob(uncertain, { store, lookup });
    assert.equal(calls, 1);
    assert.equal(
      (await first("SELECT count(*) n FROM sns_youtube_quota_reads")).n,
      1,
    );
  });
  test("案B: private insert→処理確認→別lease→public update→実公開確認", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter();
    await run(j, youtube);
    assert.deepEqual(
      youtube.calls.map((c) => c.method),
      ["videos.insert", "videos.list:processing", "videos.update", "videos.list"],
    );
    assert.equal(youtube.calls[0].payload.privacyStatus, "private");
    assert.equal(
      (await first("SELECT general_reserved FROM sns_youtube_quota_attempts"))
        .general_reserved,
      104,
    );
  });
}

function scene2() {
  test("案B: upload lease失効後も公開段階で新しいlease、期限失効なら非公開残置", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({
      afterUpload: async () =>
        db.exec(
          "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 second' WHERE state='reconcile'",
        ),
    });
    assert.equal((await run(j, youtube)).state, "posted");
    await enable();
    const expired = await job();
    const adapter = createMockYoutubeAdapter({
      videoId: "expired0001",
      afterUpload: async () =>
        db.exec(
          "UPDATE sns_x_send_jobs SET expires_at=now() WHERE state='reconcile'",
        ),
    });
    await assert.rejects(run(expired, adapter));
    const saved = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      expired.id,
    ]);
    assert.equal(saved.youtube_stage, "private_retained");
    assert.equal(saved.external_post_id, "expired0001");
    assert(!adapter.calls.some((c) => c.method === "videos.update"));
    assert.equal(saved.state, "reconcile");
  });
  test("案B: 処理pollは最大3回、公開前の最新検査不合格で非公開残置", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({ processingStatus: "processing" });
    let pending = await run(j, youtube);
    assert.equal(pending.state, "reconcile");
    for (let n = 0; n < 2; n++)
      pending = await runYoutubePublishJob(pending, {
        store,
        youtube,
        preflight: async () => {},
      });
    await assert.rejects(
      runYoutubePublishJob(pending, {
        store,
        youtube,
        preflight: async () => {},
      }),
      /poll_limit/,
    );
    assert.equal(
      youtube.calls.filter((c) => c.method === "videos.list:processing").length,
      3,
    );
    assert.equal(
      (
        await first(
          "SELECT general_units_started FROM sns_youtube_quota_attempts",
        )
      ).general_units_started,
      3,
    );
    assert.equal(
      (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
      "private_retained",
    );
    await enable();
    const other = await job();
    const adapter = createMockYoutubeAdapter({ videoId: "blocked0001" });
    let inspected = 0;
    await assert.rejects(
      run(other, adapter, {
        preflight: async () => {
          if (++inspected === 3) throw new Error("public_component_missing");
        },
      }),
      /public_component_missing/,
    );
    assert(!adapter.calls.some((c) => c.method === "videos.update"));
    assert.equal(
      (
        await first("SELECT youtube_stage FROM sns_x_send_jobs WHERE id=$1", [
          other.id,
        ])
      ).youtube_stage,
      "private_retained",
    );
  });
}

function scene3() {
  test("案B: update応答喪失後は非公開と断定せず、再公開更新を拒否", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({ failAt: "update" });
    await assert.rejects(run(j, youtube));
    const pending = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      j.id,
    ]);
    assert.equal(pending.youtube_stage, "update_started");
    await assert.rejects(store.transition(j.id, "youtube_publish_begin"));
    await assert.rejects(store.transition(j.id, "youtube_retain"));
    assert.equal(
      (
        await reconcileSendJob(pending, {
          store,
          lookup: async () => ({
            confirmed: true,
            id: "abcdefghijk",
            privacyStatus: "public",
            posted_at: new Date().toISOString(),
          }),
        })
      ).state,
      "posted",
    );
  });
  test("案B: upload後の承認失効はpublic updateなしで非公開残置", async () => {
    await enable();
    const j = await job();
    const youtube = createMockYoutubeAdapter({
      afterUpload: async () =>
        db.query("UPDATE sns_drafts SET x_approved_hash=NULL WHERE id=$1", [
          j.draft_id,
        ]),
    });
    await assert.rejects(run(j, youtube), /guard/);
    assert(!youtube.calls.some((c) => c.method === "videos.update"));
    assert.equal(
      (await first("SELECT youtube_stage FROM sns_x_send_jobs")).youtube_stage,
      "private_retained",
    );
  });
  test("日付の終わりは夏時間・冬時間・切り替えの日でもその暦の23:59:59", async () => {
    for (const [tz, base, expected] of [
      ["America/Los_Angeles", "2026-07-15T00:00:00Z", "2026-07-15T06:59:59.000Z"],
      ["America/Los_Angeles", "2026-11-02T00:00:00Z", "2026-11-02T07:59:59.000Z"],
      // 冬時間へ戻る日（25時間）の始まり直後
      ["America/Los_Angeles", "2026-11-01T07:30:00Z", "2026-11-02T07:59:59.000Z"],
      // 夏時間へ進む日（23時間）の前夜と当日
      ["America/Los_Angeles", "2026-03-08T07:30:00Z", "2026-03-08T07:59:59.000Z"],
      ["America/Los_Angeles", "2026-03-08T12:00:00Z", "2026-03-09T06:59:59.000Z"],
      ["Asia/Tokyo", "2026-11-02T00:00:00Z", "2026-11-02T14:59:59.000Z"],
    ])
      assert.equal(
        new Date(await endOfDayIn(tz, base)).toISOString(),
        expected,
        `${tz} ${base}`,
      );
  });
  test("案B: PTだけ跨ぐ試行は処理poll前に停止（JST・期限・leaseは有効）", async () => {
    await enable();
    await db.query("UPDATE test_clock SET value=$1", [
      await endOfDayIn("America/Los_Angeles"),
    ]);
    await db.exec(
      "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date; UPDATE sns_youtube_quota_control SET baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date",
    );
    const j = await job();
    const youtube = createMockYoutubeAdapter({
      afterUpload: async () =>
        db.exec("UPDATE test_clock SET value=value+interval '2 seconds'"),
    });
    await assert.rejects(run(j, youtube), /quota_unconfirmed/);
    assert(!youtube.calls.some((c) => c.method === "videos.list:processing"));
    const saved = await first(
      "SELECT lease_until>test_now() lease_valid, expires_at>test_now() deadline_valid,(locked_at AT TIME ZONE 'Asia/Tokyo')::date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date jst_valid FROM sns_x_send_jobs WHERE id=$1",
      [j.id],
    );
    assert.deepEqual(saved, {
      lease_valid: true,
      deadline_valid: true,
      jst_valid: true,
    });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・enable・job・run） */
export function runSnsShortsSendScenes1(env) {
  ({ db, first, store, enable, job, run } = env);
  scene1();
  scene2();
  scene3();
}
