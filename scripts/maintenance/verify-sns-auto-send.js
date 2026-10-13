// SQL153・154（SNS の自動送信・取り込みジョブ）の再現テスト。PGlite、外部接続なし。
// 設計: docs/design/sns-pdca-loop/plan.md、ADR 0094。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
// JST 12:00・太平洋時間 10/12 20:00。60分＋αずらしても日付をまたがない
const T0 = Date.parse("2026-10-13T03:00:00Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const setClock = (minutes) =>
  db.query("UPDATE test_clock SET value=$1", [at(minutes)]);
const transition = async (id, action, result = {}) =>
  (
    await first("SELECT transition_sns_x_send($1,$2,$3) r", [
      id,
      action,
      result,
    ])
  ).r;
let me, autoApprover;
// 153 の前提（本番に適用済み）。153-runbook.md の md5 の照合でも、153 を入れる前の状態として使う
const PRE_153 = [
  "035_sns_marketing_hub_schema.sql",
  "042_content_drafts_columns.sql",
  "135_sns_preview_bundle_import.sql",
  "136_sns_metric_observations.sql",
  "137_sns_x_send.sql",
  "138_sns_external_operations.sql",
  "139_sns_deadline_queue.sql",
  "140_sns_mobile_approval.sql",
  "145_sns_edit_assist.sql",
  "146_sns_shorts_send.sql",
  "147_sns_draft_diff.sql",
  "148_sns_posted_approval_guard.sql",
];

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  // 075 は race_odds 等に依存するため、153 が行を入れる scrape_job_state だけを同じ形で用意する
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  for (const file of [
    ...PRE_153,
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
  ]) {
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  }
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
  autoApprover = (
    await first(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; DELETE FROM sns_metric_observations; DELETE FROM sns_channel_daily; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    DELETE FROM sns_mobile_reviews;
    UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_incidents;
    DELETE FROM sns_auto_send_items;
    -- 138 の外部操作の途中の下書きは sns_guard_external が削除を拒否するので、後片付けの間だけトリガーを止める
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM sns_bundle_imports;`);
  await setClock(0);
  await db.exec(`
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,schedule_minutes=60,expiry_minutes=30,
      daily_limit=1000,daily_limit_x=6,daily_limit_youtube=1,daily_external_count=0,
      daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date,max_source_age_seconds=14400,
      period_start='2026-10-01T00:00:00Z',period_end='2026-11-01T00:00:00Z',budget_microusd=10000000,
      attempt_ceiling_microusd=1000,ceiling_x_url_microusd=200000,ceiling_x_plain_microusd=15000,reserved_microusd=0;
    UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date,
      upload_limit=10,general_limit=10000,external_uploads=0,external_general=0;
    UPDATE sns_auto_send_control SET mode='auto',dry_run=false;`);
});
after(() => db.close());

const hash = () => randomBytes(32).toString("hex");
const manifest = [
  { name: "draft.mp4", storage_path: "b/draft.mp4" },
  { name: "scene-1.png", storage_path: "b/scene-1.png" },
];
async function importBundle({ version = 1, raceId = "R1", threads = 6 } = {}) {
  const schema = `ryujin-preview/${version}`;
  const bundle = {
    schema_version: schema,
    format: "race_full",
    title: "全貌",
    script: "台本",
    x_text: "v0の本文",
    race_id: raceId,
    screen_key: "race",
    template_variant_id: "tv1",
    x_thread: Array.from({ length: threads }, (_, index) => ({
      index,
      text: `スレッド${index}`,
      ...(index === 0 ? { media: "draft.mp4" } : {}),
    })),
  };
  return (
    await first(
      "SELECT import_sns_preview_bundle($1,$2,$3,'{}'::jsonb,$4,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb) r",
      [hash(), schema, bundle, manifest],
    )
  ).r;
}
const DEADLINE = 120; // 締切は T0+120分。止められる期限・送る時刻は T0+60分、失効は T0+90分
async function createItem(groupId, channel, state = "notified", raceId = "R1") {
  return first(
    `INSERT INTO sns_auto_send_items(bundle_import_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [
      groupId,
      channel,
      raceId,
      at(DEADLINE),
      at(DEADLINE - 180),
      at(DEADLINE - 60),
      state,
      state === "checking" || state === "held_manual" ? {} : { passed: true },
      ["notifying", "notified"].includes(state) ? hash() : null,
      state === "notified" ? at(0) : null,
    ],
  );
}
// auto-plan が承認の直前に行うこと: 公開保留を外し、deadline_queue を書く
async function prepare(draftId, parentJobId = null) {
  const queue = {
    deadline_at: at(DEADLINE),
    expires_at: at(DEADLINE - 30),
    source_revision: "r1",
    source_observed_at: at(0),
    ...(parentJobId ? { parent_job_id: parentJobId } : {}),
  };
  return first(
    `UPDATE sns_drafts SET publish_blocked=false,publication_hold_reasons='[]'::jsonb,
       source_data=source_data||jsonb_build_object('deadline_queue',$2::jsonb) WHERE id=$1 RETURNING *`,
    [draftId, queue],
  );
}
async function approve(draft, approverId = autoApprover, scheduledAt = null) {
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      approverId,
      await createXSnapshot(draft, loadMedia),
      scheduledAt,
    ])
  ).r;
}
const drafts = (groupId, platform) =>
  all(
    "SELECT * FROM sns_drafts WHERE bundle_import_id=$1 AND platform=$2 ORDER BY thread_index",
    [groupId, platform],
  );
const job = (id) => first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [id]);
const reserved = async () =>
  Number((await first("SELECT reserved_microusd r FROM sns_x_send_control")).r);
// X の1件を claim から posted まで進める
async function postX(jobId, postId) {
  await transition(jobId, "claim");
  await transition(jobId, "check");
  await transition(jobId, "begin_post");
  return transition(jobId, "complete", { id: postId, posted_at: at(61) });
}
// スレッド全体を承認する（親から順、子は直前の投稿に返信、時刻は index 分ずつずらす）
async function approveThread(groupId) {
  const thread = await drafts(groupId, "x");
  const jobs = [];
  for (const d of thread) {
    const prepared = await prepare(d.id, jobs.at(-1)?.id ?? null);
    jobs.push(await approve(prepared, autoApprover, at(60 + d.thread_index)));
  }
  return jobs;
}

test("v0 は今までどおり公開・承認できない", async () => {
  const r = await importBundle({ version: 0 });
  assert.equal(r.drafts.length, 2);
  const [x] = await drafts(r.content_group_id, "x");
  await assert.rejects(
    db.query("UPDATE sns_drafts SET publish_blocked=false WHERE id=$1", [x.id]),
    /v0素材は公開不可/,
  );
  await assert.rejects(approve(x, me), /承認できません/);
  // 153 の import の v0 分岐: 重複・同時の取り込み、共通の group、型は NULL、公開情報は NULL
  const imported = await first("SELECT * FROM sns_bundle_imports WHERE id=$1", [
    r.content_group_id,
  ]);
  assert.equal(imported.release_evidence.release_status, null);
  assert.ok(imported.release_evidence.missing_reason.startsWith("v0"));
  const again = () =>
    first(
      "SELECT import_sns_preview_bundle(b.version_hash,b.schema_version,b.bundle,b.qa,b.source_manifest,b.missing_files,b.hold_reasons,'{}'::jsonb) r FROM sns_bundle_imports b WHERE id=$1",
      [r.content_group_id],
    );
  const results = await Promise.all([again(), again()]);
  assert.ok(
    results.every((x) => x.r.drafts.every((d) => d.result === "duplicate")),
  );
  const rows = await all(
    "SELECT * FROM sns_drafts WHERE bundle_import_id=$1 ORDER BY platform",
    [r.content_group_id],
  );
  assert.deepEqual(
    rows.map((d) => [
      d.platform,
      d.caption_text,
      d.video_storage_path,
      d.cover_image_path,
    ]),
    [
      ["x", "v0の本文", "b/draft.mp4", "b/scene-1.png"],
      ["youtube", "台本", "b/draft.mp4", "b/scene-1.png"],
    ],
  );
  for (const d of rows) {
    assert.equal(d.content_group_id, r.content_group_id);
    assert.equal(d.template_variant_id, null);
    assert.equal(d.publish_blocked, true);
    assert.equal(d.status, "pending_review");
  }
});

test("v1 は検査に合格した item があるときだけ公開保留を外せる", async () => {
  const r = await importBundle();
  const [x] = await drafts(r.content_group_id, "x");
  assert.equal(x.publish_blocked, true);
  await assert.rejects(prepare(x.id), /検査の合格前/);
  const item = await createItem(r.content_group_id, "x", "checking");
  await assert.rejects(prepare(x.id), /検査の合格前/);
  // 検査を通っていない item を manual にはできない（CHECK）
  await assert.rejects(
    db.query("UPDATE sns_auto_send_items SET state='manual' WHERE id=$1", [
      item.id,
    ]),
    /check/i,
  );
  await db.query(
    "UPDATE sns_auto_send_items SET state='manual',checks='{\"passed\":true}' WHERE id=$1",
    [item.id],
  );
  const prepared = await prepare(x.id);
  assert.equal(prepared.publish_blocked, false);
  // manual の item は本人が承認できる。自動送信の承認者は通らない
  await assert.rejects(approve(prepared), /自動送信の条件/);
  const j = await approve(prepared, me, at(60));
  assert.equal(j.state, "queued");
  assert.equal(j.auto_item_id, item.id);
});

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
});

test("止めた後: queued の job は取り消され、claim・check・begin_post は held、YouTube の公開開始は拒否", async () => {
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
});

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
});

test("veto_until（締切60分前）より前は X も YouTube も claim しない", async () => {
  const r = await importBundle({ threads: 1 });
  await createItem(r.content_group_id, "x");
  await createItem(r.content_group_id, "youtube");
  const [xJob] = await approveThread(r.content_group_id);
  const [yt] = await drafts(r.content_group_id, "youtube");
  // 送る時刻を前にずらしても、止められる期限より前は claim しない
  const ytJob = await approve(await prepare(yt.id), autoApprover, at(10));
  await db.query("UPDATE sns_x_send_jobs SET scheduled_at=$1", [at(10)]);
  await setClock(30);
  await assert.rejects(transition(xJob.id, "claim"), /veto_window_open/);
  await assert.rejects(transition(ytJob.id, "claim"), /veto_window_open/);
  await setClock(60);
  assert.equal((await transition(xJob.id, "claim")).state, "sending");
  assert.equal((await transition(ytJob.id, "claim")).state, "sending");
});

test("子は親が posted になるまで claim しない", async () => {
  const r = await importBundle({ threads: 2 });
  await createItem(r.content_group_id, "x");
  const [, child] = await approveThread(r.content_group_id);
  await setClock(62);
  const held = await transition(child.id, "claim");
  assert.equal(held.state, "held");
  assert.equal(held.error_code, "parent_not_posted");
});

test("個別承認の経路（bundle 由来でない本人の承認）は dry_run=false で今までどおり送れる", async () => {
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text) VALUES(gen_random_uuid(),'short','x','ja','手動の投稿') RETURNING *",
  );
  const prepared = await first(
    "UPDATE sns_drafts SET source_data=jsonb_build_object('deadline_queue',$2::jsonb) WHERE id=$1 RETURNING *",
    [
      d.id,
      {
        deadline_at: at(DEADLINE),
        expires_at: at(DEADLINE - 30),
        source_observed_at: at(0),
      },
    ],
  );
  const j = await approve(prepared, me, at(0));
  assert.equal(j.auto_item_id, null);
  // veto_until は自動送信の承認者の job だけに効く
  const posted = await postX(j.id, "5001");
  assert.equal(posted.state, "posted");
  assert.equal(await reserved(), 200000);
});

test("基準日は日付が変わったときだけ当日にし、未設定・未確認なら触らない", async () => {
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date='2026-10-12',daily_external_count=2; UPDATE sns_youtube_quota_control SET baseline_day='2026-10-11',external_uploads=1,external_general=50",
  );
  const rolled = (await first("SELECT roll_sns_send_baselines() r")).r;
  assert.equal(rolled.x_rolled, true);
  assert.equal(rolled.youtube_rolled, true);
  const c = await first(
    "SELECT daily_baseline_date::text d,daily_external_count n FROM sns_x_send_control",
  );
  assert.deepEqual(c, { d: "2026-10-13", n: 0 });
  const q = await first(
    "SELECT baseline_day::text d,external_uploads u,external_general g FROM sns_youtube_quota_control",
  );
  assert.deepEqual(q, { d: "2026-10-12", u: 0, g: 0 });
  assert.equal(
    (await first("SELECT roll_sns_send_baselines() r")).r.x_rolled,
    false,
  );
  await db.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=NULL; UPDATE sns_youtube_quota_control SET verified=false,baseline_day='2026-10-11'",
  );
  const none = (await first("SELECT roll_sns_send_baselines() r")).r;
  assert.equal(none.x_rolled, false);
  assert.equal(none.youtube_rolled, false);
});

test("月の切り替えは今の期間が終わってからだけ、予約額を0に戻す", async () => {
  await db.exec("UPDATE sns_x_send_control SET reserved_microusd=5000");
  await assert.rejects(
    db.query(
      "SELECT renew_sns_x_send_period('2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')",
    ),
    /period_overlaps_current/,
  );
  await db.query("UPDATE test_clock SET value='2026-11-01T00:00:01Z'");
  await db.query(
    "SELECT renew_sns_x_send_period('2026-11-01T00:00:00Z','2026-12-01T00:00:00Z')",
  );
  const c = await first(
    "SELECT reserved_microusd r, period_end FROM sns_x_send_control",
  );
  assert.equal(Number(c.r), 0);
  assert.equal(
    new Date(c.period_end).toISOString(),
    "2026-12-01T00:00:00.000Z",
  );
});

test("reserve_sns_x_read は月の残りの送信分を割るときは false", async () => {
  // 10/13 12:00 JST から 11/1 まで残り約19日。1日 30万 microusd を残すと 570万
  await db.exec("UPDATE sns_x_send_control SET reserved_microusd=4000000");
  assert.equal(
    (await first("SELECT reserve_sns_x_read(1000, 300000) r")).r,
    true,
  );
  assert.equal(
    (await first("SELECT reserve_sns_x_read(1000, 320000) r")).r,
    false,
  );
  assert.equal(await reserved(), 4001000);
});

test("posted になると 48h・7d の取り込みジョブが2件でき、累積値は15分以内だけ保存できる", async () => {
  const r = await importBundle({ threads: 1 });
  await createItem(r.content_group_id, "x");
  const [only] = await approveThread(r.content_group_id);
  await setClock(61);
  const posted = await postX(only.id, "6001");
  const jobs = await all(
    `SELECT "window" w, source, due_at FROM sns_metric_jobs WHERE draft_id=$1 ORDER BY due_at`,
    [only.draft_id],
  );
  assert.deepEqual(
    jobs.map((j) => [j.w, j.source, new Date(j.due_at).toISOString()]),
    [
      [
        "48h",
        "x-api",
        new Date(Date.parse(posted.posted_at) + 48 * 3600000).toISOString(),
      ],
      [
        "7d",
        "x-api",
        new Date(Date.parse(posted.posted_at) + 168 * 3600000).toISOString(),
      ],
    ],
  );
  const end = new Date(Date.parse(posted.posted_at) + 48 * 3600000);
  const observe = (minutes) => {
    const observed = new Date(end.getTime() + minutes * 60000).toISOString();
    return db.query("SELECT append_sns_metric_observation($1,$2)", [
      only.draft_id,
      {
        window: "48h",
        observed_at: observed,
        period_start: posted.posted_at,
        period_end: end.toISOString(),
        data_through: observed,
        source: "x-api",
        metric_name: "impressions",
        metric_value: 10,
        definition: "累積",
        measurement_kind: "snapshot",
      },
    ]);
  };
  await observe(14);
  await assert.rejects(observe(16), /tolerance|check/i);
});

test("暦日の値は同じ日・対象・指標で1行（draft_id が NULL でも重複しない）", async () => {
  const row = [
    "2026-10-12",
    "youtube",
    null,
    null,
    "youtube-analytics",
    "views",
    5,
    "PT の暦日",
    at(0),
  ];
  const insert = `INSERT INTO sns_channel_daily(day,channel,draft_id,utm_content,source,metric_name,metric_value,definition,observed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
  await db.query(insert, row);
  await assert.rejects(db.query(insert, row), /duplicate|unique/i);
});

test("138 の外部操作の途中の下書きがあっても止める操作は失敗しない", async () => {
  const r = await importBundle({ threads: 2 });
  const item = await createItem(r.content_group_id, "x");
  const [, child] = await drafts(r.content_group_id, "x");
  await db.query(
    "UPDATE sns_drafts SET external_operation_state='reconcile', external_operation_token=gen_random_uuid() WHERE id=$1",
    [child.id],
  );
  const stopped = await first("SELECT stop_sns_auto_item($1,'link') r", [
    item.id,
  ]);
  assert.deepEqual(stopped.r, { state: "stopped", already_started: 1 });
  const [parent] = await drafts(r.content_group_id, "x");
  assert.equal(parent.publish_blocked, true);
});

test("153-runbook.md の手順1・手順3の md5 が、置き換え前（本番と一致した版）と 153・154 の定義に合う", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const blocks = [...runbook.matchAll(/```sql\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const md5Query = (block) => block.slice(0, block.indexOf(";"));
  const allOk = async (pg, block) =>
    (await pg.query(md5Query(block))).rows.map((row) => [row.proname, row.ok]);
  const before = new PGlite();
  try {
    // now() を置き換えない素の SQL で入れる（md5 は本番と同じ定義の文字列で比べる）
    await before.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
    );
    for (const file of PRE_153)
      await before.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const pre = await allOk(before, blocks[0]);
    assert.equal(pre.length, 5);
    assert.ok(
      pre.every(([, ok]) => ok),
      JSON.stringify(pre),
    );
    for (const file of [
      "153_sns_auto_send.sql",
      "154_sns_tokens_metric_jobs.sql",
    ])
      await before.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const post = await allOk(before, blocks[1]);
    assert.equal(post.length, 11);
    assert.ok(
      post.every(([, ok]) => ok),
      JSON.stringify(post),
    );
  } finally {
    await before.close();
  }
});

test("月の上限額は $200 まで設定でき、L3 の設定（1日16レース×6件）で送れる", async () => {
  await db.exec("UPDATE sns_x_send_control SET budget_microusd=200000000");
  await assert.rejects(
    db.query("UPDATE sns_x_send_control SET budget_microusd=200000001"),
    /check/i,
  );
  // 153-runbook.md の L3 の設定
  await db.exec(
    "UPDATE sns_x_send_control SET budget_microusd=120000000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000, daily_limit_x=96, daily_limit_youtube=16",
  );
  const r = await importBundle({ threads: 6 });
  await createItem(r.content_group_id, "x");
  const jobs = await approveThread(r.content_group_id);
  for (const [i, j] of jobs.entries()) {
    await setClock(61 + i);
    assert.equal((await postX(j.id, String(7000 + i))).state, "posted");
  }
  assert.equal(await reserved(), 250000 + 5 * 30000);
});
