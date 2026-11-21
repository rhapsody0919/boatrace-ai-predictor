// SNS の 48h・7d の取り込み（sns-pdca-loop tasks 21、cron sns_metrics）の再現テスト。
// SQL154 までを PGlite に入れ、送信はモックの adapter（runSnsSend）で posted にする。X・YouTube の読み取りは fetch のモック。外部接続なし。
import { test, before, beforeEach, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createMockXAdapter,
  createXSnapshot,
} from "../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../api/_lib/snsDeadlineQueue.js";
import { pickDueJobs, runSnsSend } from "../lib/snsSendRunner.js";
import { dailySendMicrousd, joinDueJobs, runSnsMetrics } from "../lib/snsMetricsRunner.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";
import { runSnsMetricsRunnerScenes1 } from "./verifyData/sns-metrics-runner-scenes-1.js";
import { runSnsMetricsRunnerScenes2 } from "./verifyData/sns-metrics-runner-scenes-2.js";

// PT の日付境界の外に固定する。Date だけを止め、PGlite の now()・承認・期限も同じ時計で動かす。
const TEST_NOW = Date.parse("2026-10-27T03:00:00Z");
mock.timers.enable({ apis: ["Date"], now: TEST_NOW });
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const bytes = new Uint8Array([1, 2, 3]);
const loadMedia = async () => bytes;
let me;

// 送信の store（verify-sns-send-runner.js と同じ形を SQL で）
const sendStore = {
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
        await all("SELECT channel, mode, dry_run FROM sns_auto_send_control")
      ).map((r) => [r.channel, r]),
    ),
  // runner の store の形（走査位置つきの dueJobs と、要照合の job の読み取り）に合わせる。
  // このテストは送った後の取り込みを見るので、走査位置は使わない
  dueJobs: async (now, limit) => ({
    jobs: pickDueJobs(
      await all(
        "SELECT * FROM sns_x_send_jobs WHERE state='queued' AND scheduled_at<=$1 ORDER BY scheduled_at, id",
        [now.toISOString()],
      ),
      await all("SELECT id, state, external_post_id FROM sns_x_send_jobs"),
      limit,
    ),
    nextCursor: null,
  }),
  reconcileJobs: async () =>
    all(
      "SELECT id, channel, error_code, youtube_stage FROM sns_x_send_jobs WHERE state='reconcile'",
    ),
};

// 取り込みの store を SQL で（PostgREST の形は下の別のテストで確かめる）。つなぎ方・数え方は本番と同じ関数を使う
const metricsStore = {
  async dueJobs(now, limit) {
    const jobs = await all(
      `SELECT id, draft_id, "window", source, due_at, attempts, last_error FROM sns_metric_jobs
       WHERE state='pending' AND due_at<=$1 ORDER BY due_at, id LIMIT $2`,
      [now.toISOString(), limit],
    );
    const ids = jobs.map((j) => j.draft_id);
    return joinDueJobs(
      jobs,
      (
        await all(
          "SELECT id, status, posted_at, platform FROM sns_drafts WHERE id = ANY($1)",
          [ids],
        )
      ).map((d) => ({ ...d, posted_at: d.posted_at?.toISOString() ?? null })),
      await all(
        "SELECT draft_id, channel, external_post_id FROM sns_x_send_jobs WHERE draft_id = ANY($1) AND state='posted'",
        [ids],
      ),
    );
  },
  append: (draftId, observation) =>
    db.query("SELECT append_sns_metric_observation($1,$2)", [
      draftId,
      observation,
    ]),
  async finish(id, state, lastError) {
    const r = await db.query(
      "UPDATE sns_metric_jobs SET state=$2, done_at=now(), last_error=$3 WHERE id=$1 AND state='pending'",
      [id, state, lastError],
    );
    if (r.affectedRows !== 1) throw new Error("not pending");
  },
  retry: (id, attempts, lastError) =>
    db.query(
      "UPDATE sns_metric_jobs SET attempts=$2, last_error=$3 WHERE id=$1 AND state='pending'",
      [id, attempts, lastError],
    ),
  async reserveXRead(microusd) {
    const control = await first("SELECT * FROM sns_x_send_control");
    return (
      await first("SELECT reserve_sns_x_read($1,$2) r", [
        microusd,
        dailySendMicrousd(control),
      ])
    ).r;
  },
  hasValues: async (draftId, window, source) =>
    Boolean(
      await first(
        `SELECT 1 FROM sns_metric_observations WHERE draft_id=$1 AND "window"=$2 AND source=$3 AND metric_value IS NOT NULL`,
        [draftId, window, source],
      ),
    ),
  recentOutcomes: async () =>
    first(
      "SELECT count(*) FILTER (WHERE state='done')::int done, count(*) FILTER (WHERE state='missing')::int missing, count(*) FILTER (WHERE state='failed')::int failed FROM sns_metric_jobs",
    ),
};

before(async () => {
  assert.equal((await first("SELECT now() AS at")).at.getTime(), TEST_NOW);
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
    "154_sns_tokens_metric_jobs.sql",
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
    "DELETE FROM sns_metric_observations; DELETE FROM sns_metric_jobs; DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_drafts;",
  );
  await db.exec(`
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,schedule_minutes=60,expiry_minutes=30,daily_limit=1000,
      daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=14400,
      period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1000,
      reserved_microusd=0,budget_microusd=10000000,daily_limit_x=6,ceiling_x_url_microusd=NULL,ceiling_x_plain_microusd=NULL;
    UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=10,general_limit=10000,external_uploads=0,external_general=0;
    UPDATE sns_auto_send_control SET dry_run=false;`);
});
after(async () => {
  try {
    await db.close();
  } finally {
    mock.timers.reset();
  }
});

// 承認して、モックの adapter で posted まで送る。posted になると 154 のトリガーが取り込みの job を2件作る
async function postedDraft(platform, postId) {
  const deadline = new Date(Date.now() + 2 * 3600000).toISOString();
  const queue = {
    deadline_at: deadline,
    expires_at: new Date(Date.parse(deadline) - 30 * 60000).toISOString(),
    source_revision: "r1",
    source_observed_at: new Date().toISOString(),
    youtube_mode: "immediate",
  };
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data) VALUES(gen_random_uuid(),'short',$1,'ja','全貌','本文','v.mp4',$2) RETURNING *",
    [platform, { deadline_queue: queue }],
  );
  await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
    draft.id,
    me,
    await createXSnapshot(draft, loadMedia),
    new Date(Date.now() - 60000).toISOString(),
  ]);
  await runSnsSend(
    { mode: "live", now: () => new Date(), shouldStop: () => false },
    {
      store: sendStore,
      adapters: {
        x: async () => createMockXAdapter(),
        youtube: async () => createMockYoutubeAdapter(),
      },
      preflight: async () => {},
      loadMedia,
      wait: async () => {},
    },
  );
  const job = await first("SELECT * FROM sns_x_send_jobs WHERE draft_id=$1", [
    draft.id,
  ]);
  assert.equal(job.state, "posted");
  if (postId)
    await db.query(
      "UPDATE sns_x_send_jobs SET external_post_id=$2 WHERE id=$1",
      [job.id, postId],
    );
  const posted = await first("SELECT * FROM sns_drafts WHERE id=$1", [
    draft.id,
  ]);
  return { draft: posted, postId: postId ?? job.external_post_id };
}
const windowEnd = (draft, hours, minutes = 0) =>
  new Date(Date.parse(draft.posted_at) + hours * 3600000 + minutes * 60000);
const ctx = (now, mode = "live") => ({
  mode,
  now: () => now,
  shouldStop: () => false,
});
const metricJobs = (draftId) =>
  all(
    `SELECT "window" w, state, attempts, last_error FROM sns_metric_jobs WHERE draft_id=$1 ORDER BY due_at`,
    [draftId],
  );
const observations = (draftId) =>
  all(
    "SELECT metric_name, metric_value::float v, missing_reason, observed_at, data_through, source FROM sns_metric_observations WHERE draft_id=$1 ORDER BY metric_name",
    [draftId],
  );
const reserved = async () =>
  Number((await first("SELECT reserved_microusd r FROM sns_x_send_control")).r);

// 読み取りのモック。応答の時刻は at（ctx の now からの分）
const xReader = (metrics, { at, calls = [] } = {}) => ({
  read: async (ids) => {
    calls.push(ids);
    return new Map(
      ids
        .filter((id) => metrics[id])
        .map((id) => [
          id,
          { observedAt: at.toISOString(), values: metrics[id] },
        ]),
    );
  },
});

test("cron の登録: sns_metrics は終日の continuous", () => {
  assert.equal(SCRAPE_JOBS.sns_metrics.kind, "continuous");
  assert.equal(SCRAPE_JOBS.sns_metrics.maxDurationSec, 120);
  assert.equal(SCRAPE_JOBS.sns_metrics.activeHoursJst, undefined);
});

test("X: 48h の窓の終わりから15分以内に読めた累積値を保存し、data_through は取得時刻、予約は1件分", async () => {
  const { draft, postId } = await postedDraft("x", "1840000000000000001");
  const now = windowEnd(draft, 48, 5);
  const at = new Date(now.getTime() + 2000);
  const calls = [];
  const result = await runSnsMetrics(ctx(now), {
    store: metricsStore,
    readers: {
      x: async () =>
        xReader(
          {
            [postId]: {
              impressions: 120,
              url_link_clicks: 4,
              likes: 3,
              shares: 1,
              saves: 0,
              replies: 2,
              quotes: 0,
            },
          },
          { at, calls },
        ),
    },
  });
  assert.deepEqual(calls, [[postId]]);
  assert.deepEqual(
    (await metricJobs(draft.id)).map((j) => [j.w, j.state]),
    [
      ["48h", "done"],
      ["7d", "pending"],
    ],
  );
  const rows = await observations(draft.id);
  assert.deepEqual(
    rows.map((r) => [r.metric_name, r.v]),
    [
      ["impressions", 120],
      ["likes", 3],
      // 返信・引用（2026-10-27、/today の比べの副の数）
      ["quotes", 0],
      ["replies", 2],
      ["saves", 0],
      ["shares", 1],
      ["url_link_clicks", 4],
    ],
  );
  for (const r of rows) {
    assert.equal(r.observed_at.toISOString(), at.toISOString());
    assert.equal(r.data_through.toISOString(), at.toISOString());
    assert.equal(r.source, "x-api");
  }
  assert.equal(result.rowsWritten, 7);
  assert.equal(await reserved(), 1000 + 1000); // 送信の1回分＋読み取り1回分
});

test("窓の終わりから15分を過ぎてから処理する job は、外部を読まずに「取得が遅れた」の欠測で閉じる", async () => {
  const { draft } = await postedDraft("x", "1840000000000000002");
  const before = await reserved();
  const result = await runSnsMetrics(ctx(windowEnd(draft, 48, 16)), {
    store: metricsStore,
    readers: {
      x: async () => assert.fail("読まない"),
    },
  });
  assert.equal(result.body.jobs[0].outcome, "missing");
  assert.equal((await metricJobs(draft.id))[0].state, "missing");
  const rows = await observations(draft.id);
  assert.equal(rows.length, 7);
  for (const r of rows) {
    assert.equal(r.v, null);
    assert.match(r.missing_reason, /取得が遅れた/);
  }
  assert.equal(await reserved(), before);
});

test("応答を受けた時刻が15分を過ぎたら、値を捨てて欠測にする（遅い累積値を過去の窓に入れない）", async () => {
  const { draft, postId } = await postedDraft("x", "1840000000000000003");
  const now = windowEnd(draft, 48, 14);
  await runSnsMetrics(ctx(now), {
    store: metricsStore,
    readers: {
      x: async () =>
        xReader(
          { [postId]: { impressions: 5, likes: 1, shares: 0, saves: 0 } },
          { at: windowEnd(draft, 48, 15.5) },
        ),
    },
  });
  const rows = await observations(draft.id);
  assert.ok(
    rows.every((r) => r.v === null && /15分を過ぎた/.test(r.missing_reason)),
  );
});

test("API が返さない指標（リンクの無い投稿のクリック）は、その指標だけ欠測", async () => {
  const { draft, postId } = await postedDraft("x", "1840000000000000004");
  const now = windowEnd(draft, 48, 1);
  await runSnsMetrics(ctx(now), {
    store: metricsStore,
    readers: {
      x: async () =>
        xReader(
          {
            [postId]: {
              impressions: 9,
              url_link_clicks: null,
              likes: 0,
              shares: 0,
              saves: 0,
            },
          },
          { at: now },
        ),
    },
  });
  const byName = Object.fromEntries(
    (await observations(draft.id)).map((r) => [r.metric_name, r]),
  );
  assert.equal(byName.impressions.v, 9);
  assert.equal(byName.url_link_clicks.v, null);
  assert.equal(byName.url_link_clicks.missing_reason, "API が値を返さない");
});

// ---- 後半の場面（verifyData/sns-metrics-runner-scenes-1.js・sns-metrics-runner-scenes-2.js） ----
runSnsMetricsRunnerScenes1({ db, metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, reserved, xReader });
runSnsMetricsRunnerScenes2({ metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, xReader });
