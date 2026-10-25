// 全貌の YouTube 完全版のチャンネルのコメント（commentThreads.insert、50単位）をクォータの台帳に載せる（マイグレーション 173、hq 契約 10/24 C3）の再現テスト。
// PGlite に 173 までを当て、record_sns_youtube_comment の止める条件と、記録した50単位が送信の claim の日の合計に入ることを確かめる。外部接続なし
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { deadlineSchedule } from "../../api/_lib/snsDeadlineQueue.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const loadMedia = async () => new Uint8Array([1, 2, 3]);
const MIGRATIONS = [
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
  "153_sns_auto_send.sql",
  "154_sns_tokens_metric_jobs.sql",
  "158_sns_lanes_digest_period.sql",
  "160_sns_x_multiple_images.sql",
  "161_sns_full_picture_items.sql",
  "172_sns_full_picture_shorts.sql",
];
const read = async (file) =>
  (
    await readFile(
      new URL("../../docs/db-migration/" + file, import.meta.url),
      "utf8",
    )
  ).replaceAll("now()", "test_now()");
let approver;

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  await db.exec(
    "CREATE TABLE races(race_id VARCHAR PRIMARY KEY, race_date DATE, start_time TIME, cancellation_status TEXT); CREATE TABLE race_conditions(race_id VARCHAR PRIMARY KEY, race_stage VARCHAR);",
  );
  for (const f of MIGRATIONS) await db.exec(await read(f));
  // 173 の前の行（videos.list）は、173 の後もそのまま入っていること
  approver = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  await db.exec(await read("173_sns_youtube_comment_quota.sql"));
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts;
    UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE test_clock SET value=NULL;
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,daily_limit=1000,daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=3600,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1,reserved_microusd=0;
    UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=100,general_limit=10000,external_uploads=0,external_general=0;`);
});
after(() => db.close());

/** 承認済みの YouTube の job を作り、公開済み（posted）にする */
async function postedJob({ parent = null } = {}) {
  const now = Date.parse((await first("SELECT test_now() t")).t);
  const deadline_at = new Date(now + 7200000).toISOString();
  const q = {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    youtube_mode: "immediate",
    source_revision: "v1",
    source_observed_at: new Date(now).toISOString(),
  };
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data) VALUES(gen_random_uuid(),'short','youtube','ja','完全版','説明','a.mp4',$1) RETURNING *",
    [{ deadline_queue: q }],
  );
  const j = (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) result", [
      d.id,
      approver,
      await createXSnapshot(d, loadMedia),
    ])
  ).result;
  await db.query("ALTER TABLE sns_x_send_jobs DISABLE TRIGGER USER");
  await db.query(
    "UPDATE sns_x_send_jobs SET state='posted', attempts=1, external_post_id='vid'||left(id::text,6), parent_job_id=$2 WHERE id=$1",
    [j.id, parent],
  );
  await db.query("ALTER TABLE sns_x_send_jobs ENABLE TRIGGER USER");
  return j.id;
}
const record = (id) => first("SELECT record_sns_youtube_comment($1) r", [id]);
const comments = async () =>
  (
    await db.query(
      "SELECT job_id, method, units FROM sns_youtube_quota_reads WHERE method='commentThreads.insert'",
    )
  ).rows;

test("173: 公開済みの完全版の job に、コメントの50単位を1件だけ台帳へ入れる。2回目は入れない", async () => {
  const id = await postedJob();
  const r = (await record(id)).r;
  assert.equal(r.units, 50);
  assert.deepEqual(
    (await comments()).map((c) => [c.job_id, c.units]),
    [[id, 50]],
  );
  await assert.rejects(
    record(id),
    /duplicate|一意|unique/i,
    "1動画1件（部分一意索引）",
  );
  assert.equal((await comments()).length, 1);
});

test("173: 全体の停止（paused）・公開前・Shorts（parent_job_id あり）・台帳の未確認では入れない", async () => {
  const id = await postedJob();
  await db.exec("UPDATE sns_x_send_control SET paused=true");
  await assert.rejects(record(id), /paused/);
  await db.exec("UPDATE sns_x_send_control SET paused=false");
  const shorts = await postedJob({ parent: id });
  await assert.rejects(record(shorts), /Shorts/);
  await db.query("ALTER TABLE sns_x_send_jobs DISABLE TRIGGER USER");
  await db.query("UPDATE sns_x_send_jobs SET state='reconcile' WHERE id=$1", [
    id,
  ]);
  await db.query("ALTER TABLE sns_x_send_jobs ENABLE TRIGGER USER");
  await assert.rejects(record(id), /公開済み/);
  await db.query("ALTER TABLE sns_x_send_jobs DISABLE TRIGGER USER");
  await db.query("UPDATE sns_x_send_jobs SET state='posted' WHERE id=$1", [id]);
  await db.query("ALTER TABLE sns_x_send_jobs ENABLE TRIGGER USER");
  await db.exec("UPDATE sns_youtube_quota_control SET verified=false");
  await assert.rejects(record(id), /youtube_quota_unconfirmed/);
  assert.equal((await comments()).length, 0);
});

test("173: 日の上限を越えるなら入れない。入れた50単位は送信の claim と同じ合計（予約＋reads の units）に入る", async () => {
  const id = await postedJob();
  await db.exec("UPDATE sns_youtube_quota_control SET general_limit=49");
  await assert.rejects(record(id), /youtube_quota_limit/);
  await db.exec("UPDATE sns_youtube_quota_control SET general_limit=10000");
  await record(id);
  // claim・lookup が使う合計の式（153 transition_sns_x_send）と同じ
  const total = await first(
    "SELECT (SELECT coalesce(sum(general_reserved),0) FROM sns_youtube_quota_attempts WHERE quota_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date) + (SELECT coalesce(sum(units),0) FROM sns_youtube_quota_reads WHERE quota_day=(test_now() AT TIME ZONE 'America/Los_Angeles')::date) t",
  );
  assert.equal(Number(total.t), 50);
});

test("173: CHECK は videos.list・1 と commentThreads.insert・50 だけ。lookup の省略形（DEFAULT）は今までどおり入る", async () => {
  const id = await postedJob();
  await db.query(
    "INSERT INTO sns_youtube_quota_reads(job_id,attempt,quota_day) VALUES($1,1,current_date)",
    [id],
  );
  await assert.rejects(
    db.query(
      "INSERT INTO sns_youtube_quota_reads(job_id,attempt,quota_day,method,units) VALUES($1,1,current_date,'commentThreads.insert',1)",
      [id],
    ),
    /check/i,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO sns_youtube_quota_reads(job_id,attempt,quota_day,method,units) VALUES($1,1,current_date,'videos.update',50)",
      [id],
    ),
    /check/i,
  );
  const checks = (
    await db.query(
      "SELECT conname FROM pg_constraint WHERE conrelid='sns_youtube_quota_reads'::regclass AND contype='c' ORDER BY 1",
    )
  ).rows.map((r) => r.conname);
  assert.ok(checks.includes("sns_youtube_quota_reads_method_units"));
  assert.equal(checks.length, 2, `attempt>0 と新しい1本（${checks}）`);
});

test("173: 匿名・ログイン利用者は関数を実行できない（service_role だけ）", async () => {
  for (const role of ["anon", "authenticated"])
    assert.equal(
      (
        await first(
          "SELECT has_function_privilege($1,'record_sns_youtube_comment(uuid)','EXECUTE') ok",
          [role],
        )
      ).ok,
      false,
      role,
    );
  assert.equal(
    (
      await first(
        "SELECT has_function_privilege('service_role','record_sns_youtube_comment(uuid)','EXECUTE') ok",
      )
    ).ok,
    true,
  );
});
