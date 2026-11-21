/**
 * verify-sns-auto-send.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-auto-send.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createXSnapshot } from "../../../api/_lib/snsXSend.js";

let db, first, all, loadMedia, at, setClock, transition, readMigration;

export let me, autoApprover;

// 153 の前提（本番に適用済み）。153-runbook.md の md5 の照合でも、153 を入れる前の状態として使う
export const PRE_153 = [
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

export const hash = () => randomBytes(32).toString("hex");

const manifest = [
  { name: "draft.mp4", storage_path: "b/draft.mp4" },
  { name: "scene-1.png", storage_path: "b/scene-1.png" },
];

export async function importBundle({ version = 1, raceId = "R1", threads = 6 } = {}) {
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

export const DEADLINE = 120;

 // 締切は T0+120分。止められる期限・送る時刻は T0+60分、失効は T0+90分
export async function createItem(groupId, channel, state = "notified", raceId = "R1") {
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
export async function prepare(draftId, parentJobId = null) {
  const queue = {
    deadline_at: at(DEADLINE),
    expires_at: at(DEADLINE - 30),
    source_revision: "r1",
    source_observed_at: at(0),
    ...(parentJobId ? { parent_job_id: parentJobId } : {}),
  };
  return first(
    `UPDATE sns_drafts SET publish_blocked=false,publication_hold_reasons='[]'::jsonb,
       source_data=coalesce(source_data,'{}'::jsonb)||jsonb_build_object('deadline_queue',$2::jsonb) WHERE id=$1 RETURNING *`,
    [draftId, queue],
  );
}

export async function approve(draft, approverId = autoApprover, scheduledAt = null) {
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      approverId,
      await createXSnapshot(draft, loadMedia),
      scheduledAt,
    ])
  ).r;
}

export const drafts = (groupId, platform) =>
  all(
    "SELECT * FROM sns_drafts WHERE bundle_import_id=$1 AND platform=$2 ORDER BY thread_index",
    [groupId, platform],
  );

export const job = (id) => first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [id]);

export const reserved = async () =>
  Number((await first("SELECT reserved_microusd r FROM sns_x_send_control")).r);

// X の1件を claim から posted まで進める
export async function postX(jobId, postId) {
  await transition(jobId, "claim");
  await transition(jobId, "check");
  await transition(jobId, "begin_post");
  return transition(jobId, "complete", { id: postId, posted_at: at(61) });
}

// スレッド全体を承認する（親から順、子は直前の投稿に返信、時刻は index 分ずつずらす）
export async function approveThread(groupId) {
  const thread = await drafts(groupId, "x");
  const jobs = [];
  for (const d of thread) {
    const prepared = await prepare(d.id, jobs.at(-1)?.id ?? null);
    jobs.push(await approve(prepared, autoApprover, at(60 + d.thread_index)));
  }
  return jobs;
}

/** test("v0 は今までどおり公開・承認できない", async () => { の中身を割った 1/1 */
async function sas1951() {
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
}

/** test("v1 は検査に合格した item があるときだけ公開保留を外せる", async () => { の中身を割った 1/1 */
async function sas2431() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・loadMedia・at・setClock・transition） */
export function runSnsAutoSendScenes1(env) {
  ({ db, first, all, loadMedia, at, setClock, transition } = env);

}

function sas1Scene1() {
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
      "158_sns_lanes_digest_period.sql",
      "163_drop_sns_mobile_approval.sql",
    ]) {
      await db.exec((await readMigration(file)).replaceAll("now()", "test_now()"));
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
    DELETE FROM sns_metric_jobs; DELETE FROM sns_metric_observations; DELETE FROM sns_post_tracking; DELETE FROM sns_channel_daily; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
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
  test("v0 は今までどおり公開・承認できない", async () => {
    await sas1951();
  });
  test("v1 は検査に合格した item があるときだけ公開保留を外せる", async () => {
    await sas2431();
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・loadMedia・at・setClock・transition・readMigration） */
export function runSnsAutoSendScenes2(env) {
  ({ db, first, all, loadMedia, at, setClock, transition, readMigration } = env);
  sas1Scene1();
}
