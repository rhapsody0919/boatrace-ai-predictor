/**
 * verify-sns-auto-send.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { importBundle, drafts, createItem, approveThread, postX, job, approve, prepare, autoApprover, reserved } from "./sns-auto-send-scenes-1.js";

let db, first, at, setClock, transition;

/** test("予約額: YouTube は X の月の台帳を消費せず、URL つきの親と子で額が違う", async () => { の中身を割った 1/1 */
async function sas3411() {
  const r = await importBundle({ threads: 2 });
  await createItem(r.content_group_id, "x");
  await createItem(r.content_group_id, "youtube");
  const [parent, child] = await approveThread(r.content_group_id);
  const [yt] = await drafts(r.content_group_id, "youtube");
  const ytJob = await approve(await prepare(yt.id), autoApprover, at(60));
  await setClock(61);
  await transition(ytJob.id, "claim");
  assert.equal(await reserved(), 0);
  assert.equal(Number((await job(ytJob.id)).reserved_microusd), 0);
  await postX(parent.id, "2001");
  assert.equal(await reserved(), 200000);
  await setClock(62);
  await postX(child.id, "2002");
  assert.equal(await reserved(), 215000);
  // 親の claim は、子の分まで月の残りに入るときだけ通る
  const r2 = await importBundle({ raceId: "R2", threads: 3 });
  await createItem(r2.content_group_id, "x", "notified", "R2");
  await setClock(0);
  const jobs2 = await approveThread(r2.content_group_id);
  await db.exec(
    "UPDATE sns_x_send_control SET reserved_microusd=10000000-220000",
  );
  await setClock(70);
  await assert.rejects(transition(jobs2[0].id, "claim"), /月額上限/);
}

/** test("自動送信の承認者は mode=auto かつ notified でだけ通り、notifying では通らない", async ( の中身を割った 1/1 */
async function sas3821() {
  const r = await importBundle({ threads: 1 });
  const item = await createItem(r.content_group_id, "x", "notifying");
  const [x] = await drafts(r.content_group_id, "x");
  const prepared = await prepare(x.id);
  await assert.rejects(approve(prepared), /自動送信の条件/);
  await db.query(
    "UPDATE sns_auto_send_items SET state='notified',notified_at=test_now() WHERE id=$1",
    [item.id],
  );
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
  );
  await assert.rejects(approve(prepared), /自動送信の条件/);
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
  );
  const j = await approve(prepared);
  assert.equal(j.auto_item_id, item.id);
  assert.equal(j.approver_id, autoApprover);
  // 147 の sns_diff_approval: 自動承認でも承認時の版と媒体の hash が残る
  const d = await first("SELECT diff_approved FROM sns_drafts WHERE id=$1", [
    x.id,
  ]);
  assert.equal(d.diff_approved.approved_at !== undefined, true);
  assert.match(d.diff_approved.media.video.sha256, /^[a-f0-9]{64}$/);
  // 承認者マスタの選択肢に出さない
  assert.equal(
    (
      await first("SELECT active FROM sns_approvers WHERE id=$1", [
        autoApprover,
      ])
    ).active,
    false,
  );
}

/** test("止めた後: queued の job は取り消され、claim・check・begin_post は held、YouTube  の中身を割った 1/1 */
async function sas4191() {
  const r = await importBundle({ threads: 3 });
  const xItem = await createItem(r.content_group_id, "x");
  const ytItem = await createItem(r.content_group_id, "youtube");
  const [parent, child1, child2] = await approveThread(r.content_group_id);
  const [yt] = await drafts(r.content_group_id, "youtube");
  const ytJob = await approve(await prepare(yt.id), autoApprover, at(60));
  await setClock(61);
  await postX(parent.id, "3001");
  await setClock(62);
  await transition(child1.id, "claim");
  // YouTube は非公開アップロードと処理の確認まで進んだところで止める
  await transition(ytJob.id, "claim");
  await transition(ytJob.id, "begin_post");
  await transition(ytJob.id, "youtube_call", { method: "videos.insert" });
  await transition(ytJob.id, "youtube_uploaded", { id: "abcdefghijk" });
  await transition(ytJob.id, "youtube_poll");
  await transition(ytJob.id, "youtube_ready");

  const stopped = await first("SELECT stop_sns_auto_item($1,'link') r", [
    xItem.id,
  ]);
  assert.deepEqual(stopped.r, { state: "stopped", already_started: 2 });
  // sending の子1は止めた後の check で held、queued の子2は下書きを戻して取り消し
  assert.equal(
    (await transition(child1.id, "check")).error_code,
    "auto_stopped",
  );
  // 止めた時点で sending だった子1の下書きも公開保留に戻る
  const d1 = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child1.draft_id,
  ]);
  assert.equal(d1.status, "pending_review");
  assert.equal(d1.publish_blocked, true);
  assert.equal((await job(child1.id)).state, "cancelled");
  assert.equal((await job(child2.id)).state, "cancelled");
  const d2 = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    child2.draft_id,
  ]);
  assert.equal(d2.status, "pending_review");
  assert.equal(d2.publish_blocked, true);
  assert.deepEqual(d2.publication_hold_reasons, ["auto_stopped"]);
  // 投稿済みの親には触らない
  const d0 = await first("SELECT status FROM sns_drafts WHERE id=$1", [
    parent.draft_id,
  ]);
  assert.equal(d0.status, "posted");
  // 止めた後に再承認はできない
  await assert.rejects(prepare(child2.draft_id), /止めた後/);

  await first("SELECT stop_sns_auto_item($1,'admin') r", [ytItem.id]);
  await assert.rejects(
    transition(ytJob.id, "youtube_publish_begin"),
    /auto_stopped/,
  );
  assert.equal(
    (await transition(ytJob.id, "youtube_retain")).youtube_stage,
    "private_retained",
  );
}

/** test("dry_run=true は claim を拒否し、予約・日次の枠・クォータを消費しない", async () => { の中身を割った 1/1 */
async function sas5151() {
  await db.exec("UPDATE sns_auto_send_control SET dry_run=true");
  const r = await importBundle({ threads: 1 });
  await createItem(r.content_group_id, "x");
  await createItem(r.content_group_id, "youtube");
  const [xJob] = await approveThread(r.content_group_id);
  const [yt] = await drafts(r.content_group_id, "youtube");
  const ytJob = await approve(await prepare(yt.id), autoApprover, at(60));
  await setClock(61);
  await assert.rejects(transition(xJob.id, "claim"), /dry_run/);
  await assert.rejects(transition(ytJob.id, "claim"), /dry_run/);
  assert.equal((await job(xJob.id)).state, "queued");
  assert.equal(await reserved(), 0);
  assert.equal(
    Number(
      (await first("SELECT count(*) n FROM sns_youtube_quota_attempts")).n,
    ),
    0,
  );
}

function sas2Scene1() {
  test("スレッド6件と YouTube 1件を1つの素材で作れ、入れ直しは重複にならない", async () => {
    const r = await importBundle({ threads: 6 });
    assert.deepEqual(
      r.drafts.map((d) => [d.platform, d.thread_index, d.result]),
      [0, 1, 2, 3, 4, 5]
        .map((i) => ["x", i, "created"])
        .concat([["youtube", 0, "created"]]),
    );
    const thread = await drafts(r.content_group_id, "x");
    assert.deepEqual(
      thread.map((d) => [d.thread_index, d.caption_text, d.video_storage_path]),
      [
        [0, "スレッド0", "b/draft.mp4"],
        [1, "スレッド1", null],
        [2, "スレッド2", null],
        [3, "スレッド3", null],
        [4, "スレッド4", null],
        [5, "スレッド5", null],
      ],
    );
    const again = await first(
      "SELECT import_sns_preview_bundle(b.version_hash,b.schema_version,b.bundle,b.qa,b.source_manifest,b.missing_files,b.hold_reasons,'{}'::jsonb) r FROM sns_bundle_imports b WHERE id=$1",
      [r.content_group_id],
    );
    assert.ok(again.r.drafts.every((d) => d.result === "duplicate"));
    await assert.rejects(importBundle({ threads: 7 }), /x_thread・race_idが不正/);
  });
  test("6件のスレッドは日次上限6で途中で切れず、枠が足りなければ親の claim で止まる", async () => {
    const r = await importBundle();
    await createItem(r.content_group_id, "x");
    const jobs = await approveThread(r.content_group_id);
    assert.equal(jobs.length, 6);
    await setClock(61);
    for (const [i, j] of jobs.entries()) {
      await setClock(61 + i);
      const posted = await postX(j.id, String(1000 + i));
      assert.equal(posted.state, "posted", `index ${i}`);
    }
    assert.equal(
      (
        await first(
          "SELECT state FROM sns_auto_send_items WHERE bundle_import_id=$1",
          [r.content_group_id],
        )
      ).state,
      "sent",
    );
    // 送り終えた item を止めても何も変えず、送った本数を返す
    const item = await first(
      "SELECT id FROM sns_auto_send_items WHERE bundle_import_id=$1",
      [r.content_group_id],
    );
    assert.deepEqual(
      (await first("SELECT stop_sns_auto_item($1,'link') r", [item.id])).r,
      { state: "sent", already_started: 6 },
    );

    const r2 = await importBundle({ raceId: "R2" });
    await createItem(r2.content_group_id, "x", "notified", "R2");
    await setClock(0);
    await db.exec(
      "UPDATE sns_x_send_control SET daily_limit_x=12, daily_external_count=1",
    );
    const jobs2 = await approveThread(r2.content_group_id);
    await setClock(70);
    // 今日は 6+1 本出ていて、残り5では6件のスレッドが入らない
    await assert.rejects(transition(jobs2[0].id, "claim"), /日次全体上限/);
    assert.equal((await job(jobs2[0].id)).state, "queued");
  });
  test("予約額: YouTube は X の月の台帳を消費せず、URL つきの親と子で額が違う", async () => {
    await sas3411();
  });
  test("同じレース・同じチャネルの item は1つ。止めた後なら作り直せる", async () => {
    const a = await importBundle();
    const b = await importBundle();
    const item = await createItem(a.content_group_id, "x", "checking");
    await assert.rejects(
      createItem(b.content_group_id, "x", "checking"),
      /unique|duplicate/i,
    );
    await first("SELECT stop_sns_auto_item($1,'superseded') r", [item.id]);
    const again = await createItem(b.content_group_id, "x", "checking");
    assert.equal(again.state, "checking");
  });
  test("自動送信の承認者は mode=auto かつ notified でだけ通り、notifying では通らない", async () => {
    await sas3821();
  });
  test("止めた後: queued の job は取り消され、claim・check・begin_post は held、YouTube の公開開始は拒否", async () => {
    await sas4191();
  });
}

function sas2Scene2() {
  test("止めた時点で送信中だった投稿は照合を完了でき、item は stopped のまま", async () => {
    const r = await importBundle({ threads: 1 });
    const item = await createItem(r.content_group_id, "x");
    const [only] = await approveThread(r.content_group_id);
    await setClock(61);
    await transition(only.id, "claim");
    await transition(only.id, "check");
    await transition(only.id, "begin_post");
    await first("SELECT stop_sns_auto_item($1,'link') r", [item.id]);
    const done = await transition(only.id, "complete", {
      id: "4001",
      posted_at: at(61),
    });
    assert.equal(done.state, "posted");
    assert.equal(
      (
        await first("SELECT state FROM sns_auto_send_items WHERE id=$1", [
          item.id,
        ])
      ).state,
      "stopped",
    );
  });
  test("自動を切ると、notified の item の claim は held になる", async () => {
    const r = await importBundle({ threads: 1 });
    await createItem(r.content_group_id, "x");
    const [only] = await approveThread(r.content_group_id);
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
    );
    await setClock(61);
    assert.equal((await transition(only.id, "claim")).error_code, "auto_stopped");
  });
  test("dry_run=true は claim を拒否し、予約・日次の枠・クォータを消費しない", async () => {
    await sas5151();
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・at・setClock・transition） */
export function runSnsAutoSendScenes3(env) {
  ({ db, first, at, setClock, transition } = env);
  sas2Scene1();
  sas2Scene2();
}
