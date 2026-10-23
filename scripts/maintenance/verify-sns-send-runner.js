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
  PARENT_WAIT_ALERT_MINUTES,
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

test("死活の監視: sns_send は JST 8:00〜23:00 の中だけを見る（ミッドナイトの優勝戦の送る時刻まで）", () => {
  const active = activeMinutesOf(SCRAPE_JOBS.sns_send);
  assert.deepEqual(active, { start: 480, end: 1380 });
  const at = (hhmm) => new Date(`2026-10-13T${hhmm}:00+09:00`);
  assert.equal(livenessCheckable(at("07:50"), 25, active), false);
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

test("D2: 即時の通知が届かなければ report.alerts に残し、次の実行にも持ち越す。sweep で要照合になった送信も report.alerts に出す", async () => {
  const y = await approvedJob("x");
  const failingNotify = async () => {
    throw new Error("SLACK_WEBHOOK_URL が未設定です");
  };
  const first1 = await runSnsSend(
    ctx(),
    deps({
      notify: failingNotify,
      adapters: {
        x: async () => createMockXAdapter({ failAt: "initialize" }),
      },
    }),
  );
  const undelivered = first1.report.alerts.filter((a) =>
    a.key.startsWith("undelivered:"),
  );
  assert.equal(undelivered.length, 1);
  assert.match(undelivered[0].key, new RegExp(`undelivered:send:${y.id}`));
  assert.ok(Date.parse(undelivered[0].until) > Date.now());
  // 次の実行（対象の job なし）でも持ち越す。期限を過ぎたものは落とす
  const next = await runSnsSend(
    { ...ctx(), state: { last_report: first1.report } },
    deps({ notify: failingNotify }),
  );
  assert.deepEqual(
    next.report.alerts.map((a) => a.key),
    undelivered.map((a) => a.key),
  );
  const expired = await runSnsSend(
    {
      ...ctx(),
      state: {
        last_report: {
          alerts: [
            {
              ...undelivered[0],
              until: new Date(Date.now() - 1000).toISOString(),
            },
          ],
        },
      },
    },
    deps({ notify: failingNotify }),
  );
  assert.deepEqual(expired.report.alerts, []);

  // sweep でリースの切れた送信が要照合になったら report.alerts に出す（DB の状態から作る）
  const x = await approvedJob("x");
  await store.transition(x.id, "claim");
  await db.query(
    "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 minute' WHERE id=$1",
    [x.id],
  );
  const swept = await runSnsSend(ctx(), deps());
  assert.equal((await job(x.id)).state, "reconcile");
  assert.ok(
    swept.report.alerts.some(
      (a) => a.key === `reconcile:${x.id}` && a.text.includes("要照合"),
    ),
  );
});

// 開発の補助の点検 2026-10-13-28（D2 の残り）: 通知が実行のメモリにしか無く、正常に終わったときにだけ保存される
const leaseExpiredX = async (leaseUntilSql) => {
  const x = await approvedJob("x");
  await store.transition(x.id, "claim");
  await db.query(
    `UPDATE sns_x_send_jobs SET lease_until=${leaseUntilSql} WHERE id=$1`,
    [x.id],
  );
  return x;
};
const rejectNotify = async () => {
  throw new Error("Slack に届かない");
};

test("D2-1: sweep の後に DB の読み取りが落ちて report が保存されなくても、次の実行で要照合を report.alerts に出す", async () => {
  const x = await leaseExpiredX("now()-interval '1 minute'");
  await assert.rejects(
    runSnsSend(
      ctx(),
      deps({
        notify: rejectNotify,
        store: {
          ...store,
          controls: async () => {
            throw new Error("送信の DB の読み取りに失敗");
          },
        },
      }),
    ),
  );
  assert.equal((await job(x.id)).state, "reconcile");
  // 前の report は保存されていない（ctx.state なし）
  const next = await runSnsSend(ctx(), deps({ notify: rejectNotify }));
  assert.ok(next.report.alerts.some((a) => a.key === `reconcile:${x.id}`));
});

test("D2-2: runner の時刻と DB の now() がずれ、sweep だけが要照合にした job も report.alerts に出す", async () => {
  // DB の now() では切れているが、runner の時刻（1分前）ではまだ切れていない
  const x = await leaseExpiredX("now()-interval '5 seconds'");
  const result = await runSnsSend(
    { ...ctx(), now: () => new Date(Date.now() - 60000) },
    deps(),
  );
  assert.equal((await job(x.id)).state, "reconcile");
  assert.ok(result.report.alerts.some((a) => a.key === `reconcile:${x.id}`));
  // 照合で要照合が解けたら出さない（DB の状態から毎回作る）
  await db.query("UPDATE sns_x_send_jobs SET state='held' WHERE id=$1", [x.id]);
  const resolved = await runSnsSend(ctx(), deps());
  assert.ok(
    !resolved.report.alerts.some((a) => a.key.startsWith("reconcile:")),
  );
});

test("D2-3: 候補を巡回しても、まだ見直していない job の検査の理由とトークンの失敗は期限まで残す", async () => {
  const [a, b, c] = [
    await approvedJob("x", { scheduledOffsetMin: -3 }),
    await approvedJob("x", { scheduledOffsetMin: -2 }),
    await approvedJob("x", { scheduledOffsetMin: -1 }),
  ];
  const precheckKeys = (r) =>
    r.report.alerts
      .filter((al) => al.key.startsWith("precheck:"))
      .map((al) => al.key.split(":")[1])
      .sort();
  const r1 = await runSnsSend(
    ctx(),
    deps({ preflight: failingPreflight, maxCandidates: 2 }),
  );
  assert.deepEqual(precheckKeys(r1), [a.id, b.id].sort());
  const r2 = await runSnsSend(
    { ...ctx(), state: { cursor: r1.cursor, last_report: r1.report } },
    deps({ preflight: failingPreflight, maxCandidates: 2 }),
  );
  assert.deepEqual(precheckKeys(r2), [a.id, b.id, c.id].sort());
  // 見直して検査に通った job の理由は消す（dry_run で送らない）
  await db.query(
    "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
  );
  const r3 = await runSnsSend(
    { ...ctx(), state: { cursor: r2.cursor, last_report: r2.report } },
    deps({ maxCandidates: 2 }),
  );
  assert.deepEqual(precheckKeys(r3), [c.id]);
  // 期限を過ぎた理由は消す
  const stale = {
    alerts: r3.report.alerts.map((al) => ({
      ...al,
      until: new Date(Date.now() - 1000).toISOString(),
    })),
  };
  await db.query("UPDATE sns_x_send_jobs SET state='cancelled' WHERE id=$1", [
    c.id,
  ]);
  const r4 = await runSnsSend(
    { ...ctx(), state: { cursor: null, last_report: stale } },
    deps({ maxCandidates: 2 }),
  );
  assert.deepEqual(precheckKeys(r4), []);

  // トークンの失敗: その実行で X を見なくても残し、取れたら消す
  await db.query(
    "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
  );
  const noToken = {
    x: async () => {
      throw new Error("X と連携していません");
    },
    youtube: async () => createMockYoutubeAdapter(),
  };
  const t1 = await runSnsSend(
    ctx(),
    deps({ adapters: noToken, maxCandidates: 1 }),
  );
  assert.ok(t1.report.alerts.some((al) => al.key === "token:x"));
  await db.query("UPDATE sns_x_send_jobs SET state='cancelled'");
  const t2 = await runSnsSend(
    { ...ctx(), state: { last_report: t1.report } },
    deps({ adapters: noToken }),
  );
  assert.ok(t2.report.alerts.some((al) => al.key === "token:x"));
  await approvedJob("x");
  const t3 = await runSnsSend(
    { ...ctx(), state: { last_report: t2.report } },
    deps(),
  );
  assert.ok(!t3.report.alerts.some((al) => al.key === "token:x"));
});

test("鍵の健全性: ?x_read=1 のときだけ X の自分のアカウントを読み、既定では X を呼ばない", async () => {
  const { encryptTokens } = await import("../../api/_lib/snsTokenStore.js");
  const key = Buffer.alloc(32, 9).toString("base64");
  const row = {
    ...(await encryptTokens(
      { access_token: "x-access", refresh_token: "x-refresh" },
      key,
    )),
    key_version: 1,
    account_id: "1234567890",
    access_expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
  const env = {
    X_OAUTH_CLIENT_ID: "i",
    X_OAUTH_CLIENT_SECRET: "s",
    SNS_TOKEN_ENC_KEY: key,
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), auth: options.headers?.Authorization });
    if (String(url) === "https://api.x.com/2/users/me")
      return Response.json({ data: { id: "1234567890" } });
    throw new Error("想定外: " + url);
  };
  const xDb = { read: async () => row };
  const plain = await checkTokenHealth({ env, xDb, fetchImpl });
  assert.equal(plain.x.read, undefined);
  assert.equal(calls.length, 0);
  const withRead = await checkTokenHealth({ env, xDb, fetchImpl, xRead: true });
  assert.deepEqual(withRead.x.read, { ok: true, sameAccount: true });
  assert.deepEqual(calls, [
    { url: "https://api.x.com/2/users/me", auth: "Bearer x-access" },
  ]);
  assert.ok(!JSON.stringify(withRead).includes("x-access"));
  const denied = await checkTokenHealth({
    env,
    xDb,
    xRead: true,
    fetchImpl: async () =>
      new Response(JSON.stringify({ title: "Unauthorized" }), { status: 401 }),
  });
  assert.equal(denied.x.read.ok, false);
  assert.match(denied.x.read.error, /HTTP 401/);
});

test("live の sweep: RETURNS void の RPC の空の応答で落ちない（2026-10-14、sns_send が304回連続で Unexpected end of JSON input）", async () => {
  const { xSendStore } = await import("../../api/_lib/snsXSendStore.js");
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    return new Response(null, { status: 204 });
  };
  try {
    assert.equal(await xSendStore.sweep(), null);
    assert.match(calls[0].url, /rpc\/sweep_sns_deadline_queue$/);
    // 200 で本文が空のときも同じ
    globalThis.fetch = async () => new Response("", { status: 200 });
    assert.equal(await xSendStore.sweep(), null);
    // 本文がある応答は今までどおり JSON として返す・失敗は投げる
    globalThis.fetch = async () =>
      new Response('[{"id":"a"}]', { status: 200 });
    assert.deepEqual(await xSendStore.sweep(), [{ id: "a" }]);
    globalThis.fetch = async () => new Response("", { status: 500 });
    await assert.rejects(xSendStore.sweep(), /DB操作に失敗/);
  } finally {
    globalThis.fetch = original;
  }
});

test("親を待ったまま期限が近い子（全貌の Shorts・スレッドの子）は report.alerts で知らせる。期限が遠い子・親が公開済みの子は出さない", async () => {
  const parent = await approvedJob("youtube", { scheduledOffsetMin: 60 });
  const child = await approvedJob("youtube", { parentJobId: parent.id });
  const quiet = await runSnsSend(ctx(), deps());
  assert.ok(
    !quiet.report.alerts.some((a) => a.key.startsWith("parent_waiting:")),
  );
  // 期限を PARENT_WAIT_ALERT_MINUTES 分以内に寄せる
  await db.query(
    "UPDATE sns_x_send_jobs SET expires_at = now() + interval '5 minutes' WHERE id=$1",
    [child.id],
  );
  assert.ok(PARENT_WAIT_ALERT_MINUTES > 5);
  const near = await runSnsSend(ctx(), deps());
  const alert = near.report.alerts.find(
    (a) => a.key === `parent_waiting:${child.id}`,
  );
  assert.ok(alert, "親を待つ子の通知が出る");
  assert.match(alert.text, new RegExp(parent.id));
  assert.equal((await job(child.id)).state, "queued");
  // 親が公開されたら出さない
  await db.query(
    "UPDATE sns_x_send_jobs SET state='posted', external_post_id='fullvideo01' WHERE id=$1",
    [parent.id],
  );
  assert.deepEqual(
    await store.waitingChildren(new Date(), PARENT_WAIT_ALERT_MINUTES),
    [],
  );
});

test("PostgREST の読み取り: 親を待つ子は queued・親あり・期限の上限で引き、親が posted の子を除く", async () => {
  const calls = [];
  const fakeDb = async (path) => {
    calls.push(decodeURIComponent(path));
    if (path.includes("parent_job_id=not.is.null"))
      return [
        {
          id: "c1",
          channel: "youtube",
          parent_job_id: "p1",
          expires_at: "2026-10-21T03:00:00Z",
        },
        {
          id: "c2",
          channel: "youtube",
          parent_job_id: "p2",
          expires_at: "2026-10-21T03:00:00Z",
        },
      ];
    return [
      { id: "p1", state: "posted", external_post_id: "fullvideo01" },
      { id: "p2", state: "sending", external_post_id: null },
    ];
  };
  const pg = createSnsSendStore({ db: fakeDb, xSendStore: {} });
  const waiting = await pg.waitingChildren(
    new Date("2026-10-21T02:55:00Z"),
    10,
  );
  assert.deepEqual(
    waiting.map((c) => c.id),
    ["c2"],
  );
  assert.match(
    calls[0],
    /state=eq\.queued&parent_job_id=not\.is\.null&expires_at=lte\.2026-10-21T03:05:00\.000Z/,
  );
  assert.match(calls[1], /id=in\.\(p1,p2\)/);
  assert.deepEqual(
    await createSnsSendStore({
      db: async () => [],
      xSendStore: {},
    }).waitingChildren(new Date(), 10),
    [],
  );
});
