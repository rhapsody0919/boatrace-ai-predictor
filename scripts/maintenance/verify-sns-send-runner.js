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
import { createSnsSendStore, pickDueJobs, runSnsSend } from "../lib/snsSendRunner.js";
import { checkTokenHealth } from "../../api/_lib/snsTokenHealth.js";
import { handleTokenHealth } from "../../api/admin/sns-hub/token-health.js";
import { livenessCheckable } from "../lib/scrapeJobs/monitor.js";
import { SCRAPE_JOBS, activeMinutesOf } from "../lib/scrapeJobs/registry.js";
import { runSnsSendRunnerScenes1 } from "./verifyData/sns-send-runner-scenes-1.js";
import { runSnsSendRunnerScenes2 } from "./verifyData/sns-send-runner-scenes-2.js";
import {
  runSnsSendRunnerScenes3,
  runSnsSendRunnerScenes4,
  runSnsSendRunnerScenes5,
} from "./verifyData/sns-send-runner-scenes-3.js";
import { runSnsSendRunnerScenes6 } from "./verifyData/sns-send-runner-scenes-4.js";
import { runSnsSendRunnerScenes7 } from "./verifyData/sns-send-runner-scenes-5.js";
import { runSnsSendRunnerScenes8 } from "./verifyData/sns-send-runner-scenes-6.js";

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

test("検査・トークン取得中に PT の停止窓へ入ったら claim せず、窓の後に同じ job を送る", async () => {
  const y = await approvedJob("youtube");
  let at = "2026-10-27T06:49:59Z";
  const clock = { ...ctx(), now: () => new Date(at) };
  const runnerStore = {
    ...store,
    dueJobs: (_, ...args) => store.dueJobs(new Date(), ...args),
  };
  const options = deps({
    store: runnerStore,
    adapters: {
      youtube: async () => {
        at = "2026-10-27T06:50:00Z";
        return createMockYoutubeAdapter();
      },
    },
  });
  const waiting = await runSnsSend(clock, options);
  assert.equal(waiting.body.jobs[0].outcome, "youtube_quota_day_wait");
  assert.equal((await job(y.id)).attempts, 0);
  assert.equal((await job(y.id)).state, "queued");
  const carried = await runSnsSend(
    { ...clock, state: { last_report: waiting.report } },
    deps({
      store: {
        ...runnerStore,
        dueJobs: async () => ({ jobs: [], nextCursor: null }),
      },
    }),
  );
  assert.deepEqual(carried.report.alerts, waiting.report.alerts);
  at = "2026-10-27T07:05:00Z";
  const resumed = await runSnsSend(
    { ...clock, state: { last_report: waiting.report } },
    deps({ store: runnerStore }),
  );
  assert.equal((await job(y.id)).state, "posted");
  assert.equal((await job(y.id)).attempts, 1);
  assert.deepEqual(resumed.report.alerts, []);
});

test("YouTube の処理が3回の確認で終わらなければ、公開せず非公開のまま残す", async () => {
  const y = await approvedJob("youtube");
  const youtube = createMockYoutubeAdapter({ processingStatus: "processing" });
  const notices = [];
  const result = await runSnsSend(
    ctx(),
    deps({
      adapters: { youtube: async () => youtube },
      notify: async (t) => notices.push(t),
    }),
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
  // 要照合は DB の状態から毎回 report.alerts に作り、監視が Slack に流す（照合で解けるまで再通知の間隔ごと）。
  // その場の Slack は使わない（実行が保存の前に落ちても、次の実行で必ず拾えるように。点検 2026-10-13-28 の D2）
  assert.deepEqual(notices, []);
  assert.deepEqual(
    result.report.alerts.map((a) => a.key),
    [`reconcile:${y.id}`],
  );
  assert.match(result.report.alerts[0].text, /要照合.*private_retained/);
});

test("スレッドの子は親が posted になってから選ぶ", async () => {
  const parent = await approvedJob("x", { scheduledOffsetMin: -2 });
  const child = await approvedJob("x", {
    parentJobId: parent.id,
    scheduledOffsetMin: -1,
  });
  assert.deepEqual(
    (await store.dueJobs(new Date(), 5)).jobs.map((j) => j.id),
    [parent.id],
  );
  await runSnsSend(ctx(), deps({ maxJobs: 1 }));
  assert.equal((await job(parent.id)).state, "posted");
  assert.deepEqual(
    (await store.dueJobs(new Date(), 5)).jobs.map((j) => j.id),
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
  assert.equal(due.nextCursor, null); // 3件の上限に届かない（読み切った）
  assert.deepEqual(
    due.jobs.map((j) => j.id),
    ["c", "a"],
  );
  assert.match(
    calls[1],
    /state=eq\.queued&scheduled_at=lte\.2026-10-13T03:00:00\.000Z&order=scheduled_at\.asc,id\.asc/,
  );
  assert.match(calls[2], /id=in\.\(p\)/);
  // cursor の後から読む
  await pg.dueJobs(new Date("2026-10-13T03:00:00Z"), 3, {
    scheduled_at: "2026-10-13T02:00:00.000Z",
    id: "a",
  });
  assert.match(
    calls.at(-2),
    /&or=\(scheduled_at\.gt\.2026-10-13T02:00:00\.000Z,and\(scheduled_at\.eq\.2026-10-13T02:00:00\.000Z,id\.gt\.a\)\)&order=scheduled_at\.asc,id\.asc&limit=3/,
  ); // 要照合の job は状態だけで引く（時刻で絞らない）
  await pg.reconcileJobs();
  assert.equal(
    calls.at(-1),
    "sns_x_send_jobs?state=eq.reconcile&order=id.asc&select=id,channel,error_code,youtube_stage",
  );
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

test("鍵の健全性: x_read で refresh の後に保存できなかったら、Slack に連携のやり直しを知らせる（点検 2026-10-13-11）", async () => {
  const { encryptTokens } = await import("../../api/_lib/snsTokenStore.js");
  const key = Buffer.alloc(32, 9).toString("base64");
  const row = {
    ...(await encryptTokens(
      { access_token: "old-access", refresh_token: "old-refresh" },
      key,
    )),
    key_version: 1,
    account_id: "1234567890",
    // 期限の5分前を過ぎている（refresh に進む）
    access_expires_at: new Date(Date.now() + 60000).toISOString(),
  };
  const env = {
    X_OAUTH_CLIENT_ID: "i",
    X_OAUTH_CLIENT_SECRET: "s",
    SNS_TOKEN_ENC_KEY: key,
    SLACK_WEBHOOK_URL: "https://hooks.slack.test/token-health",
  };
  const slack = [];
  const fetchImpl = async (url, options = {}) => {
    if (String(url) === "https://api.x.com/2/oauth2/token")
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 7200,
      });
    if (String(url) === env.SLACK_WEBHOOK_URL) {
      slack.push(JSON.parse(options.body).text);
      return new Response("ok");
    }
    throw new Error("想定外: " + url);
  };
  const xDb = {
    read: async () => row,
    tryLock: async () => true,
    release: async () => true,
    saveLocked: async () => {
      throw new Error("DB が落ちている");
    },
  };
  process.env.SNS_HUB_BASIC_AUTH_USER = "owner";
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "pw";
  // 本番と同じ経路（handler は notify を渡さない＝既定の Slack 通知）で確かめる
  const res = await handleTokenHealth(
    new Request(
      "https://www.boat-ai.jp/api/admin/sns-hub/token-health?x_read=1",
      {
        headers: {
          authorization: `Basic ${Buffer.from("owner:pw").toString("base64")}`,
        },
      },
    ),
    { env, fetchImpl, xDb },
  );
  const { data } = await res.json();
  assert.equal(data.x.read.ok, false);
  assert.match(data.x.read.error, /保存できません/);
  assert.equal(slack.length, 1);
  assert.match(slack[0], /連携のやり直しが要る/);
  assert.ok(!slack[0].includes("new-refresh"));
});

test("死活の監視: sns_send は JST 7:00〜23:00 の中だけを見る（朝 7:15 の人気薄の1着から、ミッドナイトの優勝戦の送る時刻まで）", () => {
  const active = activeMinutesOf(SCRAPE_JOBS.sns_send);
  assert.deepEqual(active, { start: 420, end: 1380 });
  const at = (hhmm) => new Date(`2026-10-13T${hhmm}:00+09:00`);
  assert.equal(livenessCheckable(at("06:50"), 25, active), false);
  assert.equal(livenessCheckable(at("07:30"), 25, active), true);
  assert.equal(livenessCheckable(at("08:30"), 25, active), true);
  // 22:20 発走のミッドナイトの優勝戦は 21:20 に送る。その時間も見る
  assert.equal(livenessCheckable(at("21:30"), 25, active), true);
  assert.equal(livenessCheckable(at("23:10"), 25, active), false);
  // 稼働時間の無いジョブは、今までどおり 7:00〜24:00
  assert.equal(livenessCheckable(at("21:10"), 25, null), true);
});

test("検査に落ちた job は送信の件数に数えず、後ろの job を送る。トークンは1回の実行で1回だけ取る", async () => {
  const bad = [];
  for (let i = 0; i < 3; i++)
    bad.push(await approvedJob("x", { scheduledOffsetMin: -10 + i }));
  const good1 = await approvedJob("x", { scheduledOffsetMin: -2 });
  const good2 = await approvedJob("x", { scheduledOffsetMin: -1 });
  const badIds = new Set(bad.map((j) => j.id));
  let tokenCalls = 0;
  const result = await runSnsSend(
    ctx(),
    deps({
      maxJobs: 2,
      preflight: async (job) => {
        if (badIds.has(job.id))
          throw new Error("race_unconfirmed_or_withdrawn");
      },
      adapters: {
        x: async () => {
          tokenCalls++;
          // 1つの adapter で2件送るので、実際の X と同じく投稿ごとに別の ID を返す
          const adapter = createMockXAdapter();
          let n = 0;
          return {
            ...adapter,
            createPost: async (payload) => ({
              ...(await adapter.createPost(payload)),
              id: String(1900000000000000000n + BigInt(++n)),
            }),
          };
        },
      },
    }),
  );
  assert.deepEqual(
    result.body.jobs.map((r) => r.outcome),
    [
      "precheck_failed",
      "precheck_failed",
      "precheck_failed",
      "posted",
      "posted",
    ],
  );
  assert.equal((await job(good1.id)).state, "posted");
  assert.equal((await job(good2.id)).state, "posted");
  assert.equal(tokenCalls, 1);

  // トークンの失敗も1回だけ試し、同じ実行の残りの job では取り直さない
  await approvedJob("x", { scheduledOffsetMin: -1 });
  await approvedJob("x", { scheduledOffsetMin: -1 });
  let failingCalls = 0;
  const failed = await runSnsSend(
    ctx(),
    deps({
      preflight: async (job) => {
        if (badIds.has(job.id))
          throw new Error("race_unconfirmed_or_withdrawn");
      },
      adapters: {
        x: async () => {
          failingCalls++;
          throw new Error("X と連携していません");
        },
      },
    }),
  );
  assert.equal(failingCalls, 1);
  assert.equal(
    failed.body.jobs.filter((r) => r.outcome === "token_failed").length,
    2,
  );
});

test("鍵の健全性: X は保存値を読むだけで refresh しない", async () => {
  const { encryptTokens } = await import("../../api/_lib/snsTokenStore.js");
  const key = Buffer.alloc(32, 7).toString("base64");
  const row = {
    ...(await encryptTokens({ access_token: "a", refresh_token: "r" }, key)),
    account_id: "1",
    access_expires_at: "2026-10-13T03:02:00Z",
    refreshed_at: "2026-10-13T01:00:00Z",
  };
  const env = {
    X_OAUTH_CLIENT_ID: "i",
    X_OAUTH_CLIENT_SECRET: "s",
    SNS_TOKEN_ENC_KEY: key,
  };
  const health = await checkTokenHealth({
    env,
    xDb: { read: async () => row },
    fetchImpl: async () => assert.fail("X にも Google にも問い合わせない"),
    now: () => new Date("2026-10-13T03:00:00Z"),
  });
  assert.deepEqual(health.x, {
    configured: true,
    connected: true,
    decrypt: true,
    accountId: true,
    accessExpiresAt: "2026-10-13T03:02:00Z",
    refreshDue: true,
    lastRefreshedAt: "2026-10-13T01:00:00Z",
  });
  const wrongKey = await checkTokenHealth({
    env: { ...env, SNS_TOKEN_ENC_KEY: Buffer.alloc(32, 8).toString("base64") },
    xDb: { read: async () => row },
    fetchImpl: async () => assert.fail("呼ばない"),
  });
  assert.equal(wrongKey.x.connected, false);
  assert.match(wrongKey.x.error, /復号できません/);
  const refreshFails = await checkTokenHealth({
    env: {
      YOUTUBE_CLIENT_ID: "a",
      YOUTUBE_CLIENT_SECRET: "b",
      YOUTUBE_REFRESH_TOKEN: "c",
    },
    xDb: {},
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
  });
  assert.equal(refreshFails.youtube.refresh, false);
});

test("D1: 検査に落ち続ける job が上限を超えて並んでも、走査位置を進めて後ろの job を送る", async () => {
  // 落ち続ける6件（古い）と、送れる1件（新しい）。1回に読むのは3件
  const bad = new Set();
  for (let i = 0; i < 6; i++)
    bad.add((await approvedJob("x", { scheduledOffsetMin: -20 + i })).id);
  const good = await approvedJob("x", { scheduledOffsetMin: -1 });
  const run = (state) =>
    runSnsSend(
      { ...ctx(), state },
      deps({
        maxCandidates: 3,
        preflight: async (job) => {
          if (bad.has(job.id)) throw new Error("race_unconfirmed_or_withdrawn");
        },
      }),
    );
  const r1 = await run({});
  assert.deepEqual(
    r1.body.jobs.map((r) => r.outcome),
    ["precheck_failed", "precheck_failed", "precheck_failed"],
  );
  assert.ok(r1.cursor, "3件を読み切ったので位置を進める");
  const r2 = await run({ cursor: r1.cursor });
  const r3 = await run({ cursor: r2.cursor });
  assert.equal(r3.body.jobs.find((r) => r.id === good.id)?.outcome, "posted");
  // 読み切ったら次は先頭から
  assert.equal(r3.cursor, null);
});

// ---- 後半の場面（verifyData/sns-send-runner-scenes-1.js・sns-send-runner-scenes-2.js・sns-send-runner-scenes-3.js） ----
runSnsSendRunnerScenes1({ db, store, approvedJob, ctx, failingPreflight, job, deps });
runSnsSendRunnerScenes2({ db, store, approvedJob, ctx, job, deps });
runSnsSendRunnerScenes3({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });

test("BOA-1164 検査の枠: cron は Chromium の上限に runner と同じ値を渡す（本文の字でなく、cron の run が作る Chromium の引数で見る。作った所で止め、送信・DB に届かせない）", async () => {
  const stub = `export const createChromiumHeadless = (o) => { globalThis.snsSendHeadless = o; throw new Error("headless_stub"); };`;
  (await import("node:module")).register(`data:text/javascript,${encodeURIComponent(`export async function resolve(s, c, next) { const r = await next(s, c); return r.url === ${JSON.stringify(new URL("../../api/_lib/snsHeadless.js", import.meta.url).href)} && c.parentURL === ${JSON.stringify(new URL("../../api/cron/sns-send.js", import.meta.url).href)} ? { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(stub)}`)}, shortCircuit: true } : r; }`)}`);
  const { made } = await (await import("./verifyData/cronWiring.js")).cronWiring(() => import("../../api/cron/sns-send.js"));
  await assert.rejects(made[0].options.run({}), /headless_stub/);
  assert.equal(globalThis.snsSendHeadless?.maxInspections, (await import("../lib/snsSendRunner.js")).SNS_SEND_HEADLESS_BUDGET);
});

// ---- 後半の場面（verifyData/sns-send-runner-scenes-3.js） ----
runSnsSendRunnerScenes4({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });

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

// ---- 後半の場面（verifyData/sns-send-runner-scenes-3.js・sns-send-runner-scenes-4.js・sns-send-runner-scenes-5.js・sns-send-runner-scenes-6.js） ----
runSnsSendRunnerScenes5({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });
runSnsSendRunnerScenes6({ db, store, approvedJob, ctx, failingPreflight, job, deps });
runSnsSendRunnerScenes7({ db, first, store, approvedJob, ctx, job, deps });
runSnsSendRunnerScenes8({ db, store, ctx, job, deps });
