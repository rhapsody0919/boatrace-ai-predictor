// SNS の送信の runner（sns-pdca-loop tasks 19）・鍵の健全性 API・死活の稼働時間の再現テスト。
// SQL153 と 186（BOA-1164 の閉じる遷移・残した理由）・191（送らなかった理由、BOA-1201）・196（見直して公開する遷移、BOA-1283）を PGlite に入れ、X・YouTube はモックの adapter。外部接続なし。
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










import { runSnsSendRunnerScenesB1 } from "./verifyData/sns-send-runner-scenes-b-1.js";
import {
  runSnsSendRunnerScenesB2,
  runSnsSendRunnerScenesB3,
  runSnsSendRunnerScenesB4,
} from "./verifyData/sns-send-runner-scenes-b-2.js";

// PT の日付境界の外に固定する。Date だけを止め、PGlite の now()・承認・期限も同じ時計で動かす。
const TEST_NOW = Date.parse("2026-10-27T03:00:00Z");
mock.timers.enable({ apis: ["Date"], now: TEST_NOW });
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
  // 本番の PostgREST の読み取りと同じく、走査位置（cursor）の後から limit 件だけ読む
  dueJobs: async (now, limit, cursor = null) => {
    const queued = (
      await db.query(
        `SELECT * FROM sns_x_send_jobs WHERE state='queued' AND scheduled_at<=$1
           AND ($2::timestamptz IS NULL OR scheduled_at>$2 OR (scheduled_at=$2 AND id>$3::uuid))
         ORDER BY scheduled_at, id LIMIT $4`,
        [
          now.toISOString(),
          cursor?.scheduled_at ?? null,
          cursor?.id ?? null,
          limit,
        ],
      )
    ).rows;
    const parents = (
      await db.query("SELECT id, state, external_post_id FROM sns_x_send_jobs")
    ).rows;
    return {
      jobs: pickDueJobs(queued, parents),
      nextCursor:
        queued.length === limit
          ? { scheduled_at: queued.at(-1).scheduled_at, id: queued.at(-1).id }
          : null,
    };
  },
  waitingChildren: async (now, minutes) =>
    (
      await db.query(
        `SELECT c.id, c.channel, c.parent_job_id, c.expires_at FROM sns_x_send_jobs c
           JOIN sns_x_send_jobs p ON p.id = c.parent_job_id
         WHERE c.state='queued' AND c.expires_at <= $1::timestamptz + make_interval(mins => $2)
           AND NOT (p.state='posted' AND p.external_post_id IS NOT NULL) ORDER BY c.id`,
        [now.toISOString(), minutes],
      )
    ).rows,
  reconcileJobs: async () =>
    (
      await db.query(
        "SELECT id, channel, error_code, youtube_stage FROM sns_x_send_jobs WHERE state='reconcile' ORDER BY id",
      )
    ).rows,
  // 本番の PostgREST の書き込み（createPostgrestEventWriter、on_conflict と resolution=ignore-duplicates）と同じ意味
  recordEvent: async (e) => {
    await db.query(
      "INSERT INTO sns_send_events(job_id,stage,reason,detail) VALUES($1,$2,$3,$4) ON CONFLICT (job_id,stage,reason) DO NOTHING",
      [e.job_id, e.stage, e.reason, e.detail],
    );
  },
  // 本番の PostgREST の読み取り（createSnsSendStore の retainedYoutubeJobs）と同じ条件
  retainedYoutubeJobs: async (now, limit) =>
    (
      await db.query(
        `SELECT id, channel, state, youtube_stage, error_code, external_post_id, attempts, expires_at, snapshot FROM sns_x_send_jobs
         WHERE state='reconcile' AND channel='youtube' AND youtube_stage='private_retained' AND expires_at<=$1
           AND (lease_until IS NULL OR lease_until<=$1) ORDER BY id LIMIT $2`,
        [now.toISOString(), limit],
      )
    ).rows,
  // 本番の PostgREST の読み取り（createSnsSendStore の resumableYoutubeJobs）と同じ条件（BOA-1283）
  resumableYoutubeJobs: async (now, limit) =>
    (
      await db.query(
        `SELECT id, channel, state, youtube_stage, error_code, external_post_id, attempts, expires_at, snapshot FROM sns_x_send_jobs
         WHERE state='reconcile' AND channel='youtube'
           AND ((youtube_stage='private_retained' AND error_code IN ('youtube_retained_processing','youtube_retained_budget'))
             OR (youtube_stage='ready' AND error_code IS NULL)) AND expires_at>$1
           AND (lease_until IS NULL OR lease_until<=$1) ORDER BY expires_at, id LIMIT $2`,
        [now.toISOString(), limit],
      )
    ).rows,
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
    "186_sns_youtube_close_private.sql",
    "191_sns_send_events.sql",
    "196_sns_youtube_resume_processed.sql",
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
  mock.timers.setTime(TEST_NOW);
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
after(async () => {
  try {
    await db.close();
  } finally {
    mock.timers.reset();
  }
});

async function approvedJob(
  platform = "x",
  { parentJobId = null, scheduledOffsetMin = -1, cover = null } = {},
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
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data,cover_image_path) VALUES(gen_random_uuid(),'short',$1,'ja','全貌','本文','v.mp4',$2,$3) RETURNING *",
    [platform, { deadline_queue: queue }, cover],
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
// モックの送る前の検査は Chromium を開かないので、検査の枠（BOA-1164）は既定で無制限にする。枠を見る試験は headlessBudget: 6 を渡す
const deps = (extra = {}) => ({
  headlessBudget: Infinity,
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

// 境界の検査では runner の時計だけを変える。SQL の now() と承認・失効は TEST_NOW のままにし、
// dueJobs の取得時刻だけ合わせる（SQL の日次ガードを別の日に偽装しない）。
for (const [at, paused] of [
  ["2026-10-27T06:49:59Z", false],
  ["2026-10-27T06:50:00Z", true],
  ["2026-10-27T06:55:00Z", true],
  ["2026-10-27T07:00:00Z", true],
  ["2026-10-27T07:01:00Z", true],
  ["2026-10-27T07:04:59Z", true],
  ["2026-10-27T07:05:00Z", false],
  ["2026-11-02T07:49:59Z", false],
  ["2026-11-02T07:50:00Z", true],
  ["2026-11-02T07:55:00Z", true],
  ["2026-11-02T08:01:00Z", true],
  ["2026-11-02T08:05:00Z", false],
]) {
  test(`YouTube の PT 日付境界: ${at} は${paused ? "待機" : "送信"}、X は送信`, async () => {
    const y = await approvedJob("youtube", { scheduledOffsetMin: -2 });
    const x = await approvedJob("x");
    const notices = [];
    const youtube = createMockYoutubeAdapter();
    const result = await runSnsSend(
      { ...ctx(), now: () => new Date(at) },
      deps({
        maxJobs: paused ? 1 : 2,
        store: {
          ...store,
          dueJobs: (_, ...args) => store.dueJobs(new Date(), ...args),
        },
        adapters: {
          x: async () => createMockXAdapter(),
          youtube: async () => youtube,
        },
        notify: async (text) => notices.push(text),
      }),
    );
    const row = await job(y.id);
    assert.equal(row.state, paused ? "queued" : "posted");
    assert.equal(row.attempts, paused ? 0 : 1);
    assert.equal(
      Number(
        (await first("SELECT count(*) n FROM sns_youtube_quota_attempts")).n,
      ),
      paused ? 0 : 1,
    );
    assert.equal(
      result.body.jobs.find((r) => r.id === y.id).outcome,
      paused ? "youtube_quota_day_wait" : "posted",
    );
    assert.equal((await job(x.id)).state, "posted");
    assert.deepEqual(
      result.report.alerts.map((a) => a.key),
      paused ? [`youtube_quota_day_wait:${y.id}`] : [],
    );
    assert.deepEqual(notices, []);
    if (paused) assert.deepEqual(youtube.calls, []);
  });
}

// ---- 後半の場面（verifyData/sns-send-runner-scenes-b-1.js・sns-send-runner-scenes-b-2.js） ----
runSnsSendRunnerScenesB1({ store, approvedJob, ctx, job, deps });
runSnsSendRunnerScenesB2({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });

test("BOA-1164 検査の枠: cron は Chromium の上限に runner と同じ値を渡す（本文の字でなく、cron の run が作る Chromium の引数で見る。作った所で止め、送信・DB に届かせない）", async () => {
  const stub = `export const createChromiumHeadless = (o) => { globalThis.snsSendHeadless = o; throw new Error("headless_stub"); };`;
  (await import("node:module")).register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { const r = await next(s, c); return r.url === ${JSON.stringify(new URL("../../api/_lib/snsHeadless.js", import.meta.url).href)} && c.parentURL === ${JSON.stringify(new URL("../../api/cron/sns-send.js", import.meta.url).href)} ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`)}, shortCircuit: true } : r; }`)}`);
  const { made } = await (await import("./verifyData/cronWiring.js")).cronWiring(() => import("../../api/cron/sns-send.js"));
  await assert.rejects(made[0].options.run({}), /headless_stub/);
  assert.equal(globalThis.snsSendHeadless?.maxInspections, (await import("../lib/snsSendRunner.js")).SNS_SEND_HEADLESS_BUDGET);
});

// ---- 後半の場面（verifyData/sns-send-runner-scenes-b-2.js） ----
runSnsSendRunnerScenesB3({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });

// 動画 ID が違う2件目の非公開の残置（external_post_id は一意）
async function retainedJob2() {
  const y = await approvedJob("youtube");
  await runSnsSend(
    ctx(),
    deps({
      adapters: {
        youtube: async () =>
          createMockYoutubeAdapter({
            processingStatus: "processing",
            videoId: "secondvid01",
          }),
      },
    }),
  );
  await db.query(
    "UPDATE sns_x_send_jobs SET expires_at=now()-interval '1 minute', lease_until=now()-interval '1 minute' WHERE id=$1",
    [y.id],
  );
  return { y };
}

// ---- 後半の場面（verifyData/sns-send-runner-scenes-b-2.js） ----
runSnsSendRunnerScenesB4({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });
