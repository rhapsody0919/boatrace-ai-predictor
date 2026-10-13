// SNS の送信の runner（sns-pdca-loop tasks 19）・鍵の健全性 API・死活の稼働時間の再現テスト。
// SQL153 までを PGlite に入れ、X・YouTube はモックの adapter。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createMockXAdapter,
  createXSnapshot,
} from "../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../api/_lib/snsDeadlineQueue.js";
import {
  createSnsSendStore,
  pickDueJobs,
  runSnsSend,
} from "../lib/snsSendRunner.js";
import { checkTokenHealth } from "../../api/_lib/snsTokenHealth.js";
import { handleTokenHealth } from "../../api/admin/sns-hub/token-health.js";
import { livenessCheckable } from "../lib/scrapeJobs/monitor.js";
import { SCRAPE_JOBS, activeMinutesOf } from "../lib/scrapeJobs/registry.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const bytes = new Uint8Array([1, 2, 3]);
const loadMedia = async () => bytes;
let me;

// runner が使う store と同じ形を SQL で作る（PostgREST の読み取りの部分は下の別のテストで確かめる）
const store = {
  transition: async (id, action, result = {}) =>
    (
      await first("SELECT transition_sns_x_send($1,$2,$3) r", [
        id,
        action,
        result,
      ])
    ).r,
  parent: async (id) =>
    first(
      "SELECT external_post_id FROM sns_x_send_jobs WHERE id=$1 AND state='posted'",
      [id],
    ),
  sweep: () => db.query("SELECT sweep_sns_deadline_queue()"),
  controls: async () =>
    Object.fromEntries(
      (
        await db.query(
          "SELECT channel, mode, dry_run FROM sns_auto_send_control",
        )
      ).rows.map((r) => [r.channel, r]),
    ),
  dueJobs: async (now, limit) => {
    const queued = (
      await db.query(
        "SELECT * FROM sns_x_send_jobs WHERE state='queued' AND scheduled_at<=$1 ORDER BY scheduled_at, id",
        [now.toISOString()],
      )
    ).rows;
    const parents = (
      await db.query("SELECT id, state, external_post_id FROM sns_x_send_jobs")
    ).rows;
    return pickDueJobs(queued, parents, limit);
  },
};

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
  );
  for (const file of [
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
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + file, import.meta.url),
        "utf8",
      ),
    );
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_drafts;",
  );
  await db.exec(`
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,schedule_minutes=60,expiry_minutes=30,daily_limit=1000,
      daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=14400,
      period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1000,reserved_microusd=0;
    UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=10,general_limit=10000,external_uploads=0,external_general=0;
    UPDATE sns_auto_send_control SET dry_run=false;`);
});
after(() => db.close());

async function approvedJob(
  platform = "x",
  { parentJobId = null, scheduledOffsetMin = -1 } = {},
) {
  const deadline = new Date(Date.now() + 2 * 3600000).toISOString();
  const queue = {
    deadline_at: deadline,
    expires_at: new Date(Date.parse(deadline) - 30 * 60000).toISOString(),
    source_revision: "r1",
    source_observed_at: new Date().toISOString(),
    youtube_mode: "immediate",
    ...(parentJobId ? { parent_job_id: parentJobId } : {}),
  };
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data) VALUES(gen_random_uuid(),'short',$1,'ja','全貌','本文','v.mp4',$2) RETURNING *",
    [platform, { deadline_queue: queue }],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      me,
      await createXSnapshot(draft, loadMedia),
      new Date(Date.now() + scheduledOffsetMin * 60000).toISOString(),
    ])
  ).r;
}
const ctx = (mode = "live") => ({
  mode,
  now: () => new Date(),
  shouldStop: () => false,
});
const passing = async () => {};
const failingPreflight = async () => {
  throw new Error("source_check_unconfigured");
};
const job = (id) => first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [id]);
const reserved = async () =>
  Number((await first("SELECT reserved_microusd r FROM sns_x_send_control")).r);
const deps = (extra = {}) => ({
  store,
  adapters: {
    x: async () => createMockXAdapter(),
    youtube: async () => createMockYoutubeAdapter(),
  },
  preflight: passing,
  loadMedia,
  wait: async () => {},
  ...extra,
});

test("送る前の検査に落ちたら claim しない（予約も日次の枠も消費しない）、理由を通知に出す", async () => {
  const j = await approvedJob("x");
  const result = await runSnsSend(ctx(), deps({ preflight: failingPreflight }));
  assert.deepEqual(result.body.jobs, [
    {
      id: j.id,
      channel: "x",
      outcome: "precheck_failed",
      reason: "source_check_unconfigured",
    },
  ]);
  assert.equal((await job(j.id)).state, "queued");
  assert.equal((await job(j.id)).attempts, 0);
  assert.equal(await reserved(), 0);
  assert.match(result.report.alerts[0].key, /^precheck:/);
});

test("shadow と dry_run は送る前の検査までで止め、claim しない", async () => {
  const j = await approvedJob("x");
  const shadow = await runSnsSend(ctx("shadow"), deps());
  assert.equal(shadow.body.jobs[0].outcome, "shadow");
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
  );
  const dry = await runSnsSend(ctx(), deps());
  assert.equal(dry.body.jobs[0].outcome, "dry_run");
  assert.equal((await job(j.id)).state, "queued");
  assert.equal(await reserved(), 0);
});

test("トークンを取れなければ claim しない", async () => {
  const j = await approvedJob("x");
  const result = await runSnsSend(
    ctx(),
    deps({
      adapters: {
        x: async () => {
          throw new Error("X と連携していません");
        },
      },
    }),
  );
  assert.equal(result.body.jobs[0].outcome, "token_failed");
  assert.equal((await job(j.id)).state, "queued");
  assert.match(result.report.alerts[0].text, /連携していません/);
});

test("live・dry_run=false: X と YouTube を送って posted、最大件数を守る", async () => {
  const x1 = await approvedJob("x", { scheduledOffsetMin: -3 });
  const y1 = await approvedJob("youtube", { scheduledOffsetMin: -2 });
  const x2 = await approvedJob("x", { scheduledOffsetMin: -1 });
  const xAdapter = createMockXAdapter();
  const result = await runSnsSend(
    ctx(),
    deps({
      maxJobs: 2,
      adapters: {
        x: async () => xAdapter,
        youtube: async () => createMockYoutubeAdapter(),
      },
    }),
  );
  assert.deepEqual(
    result.body.jobs.map((r) => [r.id, r.outcome]),
    [
      [x1.id, "posted"],
      [y1.id, "posted"],
    ],
  );
  assert.equal(result.rowsWritten, 2);
  assert.equal((await job(x2.id)).state, "queued");
  assert.equal(
    xAdapter.calls.filter((c) => c.method === "createPost").length,
    1,
  );
});

test("YouTube の処理が3回の確認で終わらなければ、公開せず非公開のまま残す", async () => {
  const y = await approvedJob("youtube");
  const youtube = createMockYoutubeAdapter({ processingStatus: "processing" });
  const result = await runSnsSend(
    ctx(),
    deps({ adapters: { youtube: async () => youtube } }),
  );
  const row = await job(y.id);
  assert.equal(row.state, "reconcile");
  assert.equal(row.youtube_stage, "private_retained");
  assert.equal(
    youtube.calls.filter((c) => c.method === "videos.list:processing").length,
    3,
  );
  assert.equal(
    youtube.calls.some((c) => c.method === "videos.update"),
    false,
  );
  assert.match(result.report.alerts[0].key, /^reconcile:/);
});

test("スレッドの子は親が posted になってから選ぶ", async () => {
  const parent = await approvedJob("x", { scheduledOffsetMin: -2 });
  const child = await approvedJob("x", {
    parentJobId: parent.id,
    scheduledOffsetMin: -1,
  });
  assert.deepEqual(
    (await store.dueJobs(new Date(), 5)).map((j) => j.id),
    [parent.id],
  );
  await runSnsSend(ctx(), deps({ maxJobs: 1 }));
  assert.equal((await job(parent.id)).state, "posted");
  assert.deepEqual(
    (await store.dueJobs(new Date(), 5)).map((j) => j.id),
    [child.id],
  );
});

test("PostgREST の読み取り: 送る時刻を過ぎた queued を古い順に、親は id で引く", async () => {
  const calls = [];
  const fakeDb = async (path) => {
    calls.push(decodeURIComponent(path));
    if (path.startsWith("sns_auto_send_control"))
      return [{ channel: "x", mode: "manual", dry_run: true }];
    if (path.includes("state=eq.queued"))
      return [
        { id: "c", parent_job_id: "p" },
        { id: "a", parent_job_id: null },
      ];
    return [{ id: "p", state: "posted", external_post_id: "1" }];
  };
  const pg = createSnsSendStore({ db: fakeDb, xSendStore: {} });
  assert.deepEqual(await pg.controls(), {
    x: { channel: "x", mode: "manual", dry_run: true },
  });
  const due = await pg.dueJobs(new Date("2026-10-13T03:00:00Z"), 3);
  assert.deepEqual(
    due.map((j) => j.id),
    ["c", "a"],
  );
  assert.match(
    calls[1],
    /state=eq\.queued&scheduled_at=lte\.2026-10-13T03:00:00\.000Z&order=scheduled_at\.asc,id\.asc/,
  );
  assert.match(calls[2], /id=in\.\(p\)/);
});

test("鍵の健全性: refresh の可否と scope だけを返し、トークンの値は返さない", async () => {
  const fetchImpl = async (url) => {
    const u = String(url);
    if (u === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "ya29.secret-value" });
    if (u.startsWith("https://oauth2.googleapis.com/tokeninfo"))
      return Response.json({
        scope: u.includes("secret-value")
          ? "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube"
          : "",
      });
    if (u.startsWith("https://youtubeanalytics.googleapis.com"))
      return new Response("{}", { status: 200 });
    throw new Error(u);
  };
  const env = {
    YOUTUBE_CLIENT_ID: "a",
    YOUTUBE_CLIENT_SECRET: "b",
    YOUTUBE_REFRESH_TOKEN: "c",
    YOUTUBE_ANALYTICS_CLIENT_ID: "d",
    YOUTUBE_ANALYTICS_CLIENT_SECRET: "e",
    YOUTUBE_ANALYTICS_REFRESH_TOKEN: "f",
  };
  const health = await checkTokenHealth({ env, fetchImpl, xDb: {} });
  assert.deepEqual(health.x, { configured: false });
  assert.equal(health.youtube.refresh, true);
  assert.equal(health.youtube.canUpload, true);
  assert.equal(health.youtube.canPublish, true);
  assert.equal(health.analytics.reportsStatus, 200);
  assert.ok(!JSON.stringify(health).includes("secret-value"));

  // 今の投稿用トークン（youtube.upload だけ）は公開に切り替えられない
  const uploadOnly = await checkTokenHealth({
    env,
    xDb: {},
    fetchImpl: async (url) =>
      String(url).includes("tokeninfo")
        ? Response.json({
            scope: "https://www.googleapis.com/auth/youtube.upload",
          })
        : fetchImpl(url),
  });
  assert.equal(uploadOnly.youtube.canPublish, false);

  process.env.SNS_HUB_BASIC_AUTH_USER = "owner";
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "pw";
  const unauth = await handleTokenHealth(
    new Request("https://www.boat-ai.jp/api/admin/sns-hub/token-health"),
    { env, fetchImpl, xDb: {} },
  );
  assert.equal(unauth.status, 401);
  const res = await handleTokenHealth(
    new Request("https://www.boat-ai.jp/api/admin/sns-hub/token-health", {
      headers: {
        authorization: `Basic ${Buffer.from("owner:pw").toString("base64")}`,
      },
    }),
    { env, fetchImpl, xDb: {} },
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.ok(!(await res.text()).includes("secret-value"));
});

test("死活の監視: sns_send は JST 8:00〜21:00 の中だけを見る", () => {
  const active = activeMinutesOf(SCRAPE_JOBS.sns_send);
  assert.deepEqual(active, { start: 480, end: 1260 });
  const at = (hhmm) => new Date(`2026-10-13T${hhmm}:00+09:00`);
  assert.equal(livenessCheckable(at("07:50"), 25, active), false);
  assert.equal(livenessCheckable(at("08:30"), 25, active), true);
  assert.equal(livenessCheckable(at("21:10"), 25, active), false);
  // 稼働時間の無いジョブは、今までどおり 7:00〜24:00
  assert.equal(livenessCheckable(at("21:10"), 25, null), true);
});
