// SNS の 48h・7d の取り込み（sns-pdca-loop tasks 21、cron sns_metrics）の再現テスト。
// SQL154 までを PGlite に入れ、送信はモックの adapter（runSnsSend）で posted にする。X・YouTube の読み取りは fetch のモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createMockXAdapter,
  createXSnapshot,
} from "../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../api/_lib/snsDeadlineQueue.js";
import { pickDueJobs, runSnsSend } from "../lib/snsSendRunner.js";
import {
  createSnsMetricsStore,
  createXMetricsReader,
  createYoutubeMetricsReader,
  dailySendMicrousd,
  joinDueJobs,
  runSnsMetrics,
} from "../lib/snsMetricsRunner.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

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
  // runner の store の形（#1520: 走査位置つきの dueJobs と、リース切れの sending の読み取り）に合わせる。
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
  expiredSending: async (now) =>
    all(
      "SELECT id, channel FROM sns_x_send_jobs WHERE state='sending' AND lease_until<=$1",
      [now.toISOString()],
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
after(() => db.close());

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
  assert.equal(result.rowsWritten, 5);
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
  assert.equal(rows.length, 5);
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

test("失敗は pending のままやり直し、3回目で1度だけ Slack、その後15分を過ぎたら最後の失敗の理由つきで欠測", async () => {
  const { draft } = await postedDraft("x", "1840000000000000005");
  const notices = [];
  const failing = {
    store: metricsStore,
    readers: {
      x: async () => ({
        read: async () => {
          throw new Error("X GET /2/users/{id}/tweets が失敗: HTTP 503");
        },
      }),
    },
    notify: async (t) => notices.push(t),
  };
  for (const m of [0, 5, 10, 14])
    await runSnsMetrics(ctx(windowEnd(draft, 48, m)), failing);
  const [job48] = await metricJobs(draft.id);
  assert.equal(job48.state, "pending");
  assert.equal(job48.attempts, 4);
  assert.equal(notices.length, 1);
  assert.match(notices[0], /3回続けて失敗/);
  await runSnsMetrics(ctx(windowEnd(draft, 48, 20)), failing);
  assert.equal((await metricJobs(draft.id))[0].state, "missing");
  assert.match(
    (await observations(draft.id))[0].missing_reason,
    /最後の失敗: X GET .* HTTP 503/,
  );
});

test("月の残りが送信の分を割るときは X を読まない（予約しない）", async () => {
  const { draft } = await postedDraft("x", "1840000000000000006");
  // 残りが「月の残り日数×1日の送信の予約額」を下回る
  await db.exec(
    "UPDATE sns_x_send_control SET budget_microusd=50000, daily_limit_x=6, ceiling_x_url_microusd=20000, ceiling_x_plain_microusd=10000",
  );
  const before = await reserved();
  const result = await runSnsMetrics(ctx(windowEnd(draft, 48, 1)), {
    store: metricsStore,
    readers: { x: async () => xReader({}, { at: new Date() }) },
  });
  assert.equal(result.body.jobs[0].outcome, "retry");
  assert.match(result.body.jobs[0].reason, /x_read_budget/);
  assert.equal(await reserved(), before);
  assert.equal(
    dailySendMicrousd({
      daily_limit_x: 6,
      ceiling_x_url_microusd: 20000,
      ceiling_x_plain_microusd: 10000,
    }),
    70000,
  );
});

test("トークンを取れないときは全件やり直しにして report.alerts に出す", async () => {
  const { draft } = await postedDraft("x", "1840000000000000007");
  const result = await runSnsMetrics(ctx(windowEnd(draft, 48, 1)), {
    store: metricsStore,
    readers: {
      x: async () => {
        throw new Error("X と連携していません");
      },
    },
  });
  assert.equal((await metricJobs(draft.id))[0].attempts, 1);
  assert.equal(result.report.alerts[0].key, "token:x");
});

test("YouTube: videos.list の累積値を保存する（views・likes・comments）", async () => {
  const { draft, postId } = await postedDraft("youtube");
  const now = windowEnd(draft, 168, 3);
  // 48h の job は15分を過ぎているので欠測で閉じ、7d の job だけを読む
  const calls = [];
  await runSnsMetrics(ctx(now), {
    store: metricsStore,
    readers: {
      youtube: async () =>
        xReader(
          { [postId]: { views: 900, likes: 30, comments: 2 } },
          { at: now, calls },
        ),
    },
  });
  assert.deepEqual(calls, [[postId]]);
  assert.deepEqual(
    (await metricJobs(draft.id)).map((j) => [j.w, j.state]),
    [
      ["48h", "missing"],
      ["7d", "done"],
    ],
  );
  const values = (await observations(draft.id))
    .filter((r) => r.v !== null)
    .map((r) => [r.metric_name, r.v, r.source]);
  assert.deepEqual(values, [
    ["comments", 2, "youtube-data"],
    ["likes", 30, "youtube-data"],
    ["views", 900, "youtube-data"],
  ]);
});

test("投稿の外部 ID が無い job は、やり直さずに failed で閉じて知らせる", async () => {
  const { draft } = await postedDraft("x", "1840000000000000008");
  await db.query(
    "UPDATE sns_x_send_jobs SET external_post_id=NULL WHERE draft_id=$1",
    [draft.id],
  );
  const notices = [];
  await runSnsMetrics(ctx(windowEnd(draft, 48, 1)), {
    store: metricsStore,
    readers: { x: async () => assert.fail("読まない") },
    notify: async (t) => notices.push(t),
  });
  const [job48] = await metricJobs(draft.id);
  assert.equal(job48.state, "failed");
  assert.equal(job48.last_error, "external_post_id_missing");
  assert.equal(notices.length, 1);
});

test("shadow は外部を読まず、DB も変えない", async () => {
  const { draft } = await postedDraft("x", "1840000000000000009");
  const result = await runSnsMetrics(ctx(windowEnd(draft, 48, 1), "shadow"), {
    store: metricsStore,
    readers: { x: async () => assert.fail("読まない") },
  });
  assert.deepEqual(result.body, { mode: "shadow", due: 1 });
  assert.equal((await metricJobs(draft.id))[0].state, "pending");
});

test("継続監視: 直近の欠測・失敗の割合が2%を超えたら report.alerts に出す", async () => {
  const { draft } = await postedDraft("x", "1840000000000000010");
  const result = await runSnsMetrics(ctx(windowEnd(draft, 48, 30)), {
    store: metricsStore,
    readers: {},
  });
  assert.deepEqual(result.report.recent, { done: 0, missing: 1, failed: 0 });
  assert.equal(result.report.alerts[0].key, "missing_rate");
});

test("X の読み取り: since_id・until_id で対象の1件に絞り、自分の投稿の API を読む", async () => {
  const urls = [];
  const reader = createXMetricsReader({
    accessToken: "t",
    accountId: "42",
    now: () => new Date("2026-10-15T00:00:00Z"),
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({
        data: [
          {
            id: "100",
            public_metrics: {
              like_count: 2,
              retweet_count: 1,
              bookmark_count: 0,
            },
            non_public_metrics: { impression_count: 50, url_link_clicks: 3 },
          },
        ],
      });
    },
  });
  const got = await reader.read(["100"]);
  const u = new URL(urls[0]);
  assert.equal(u.pathname, "/2/users/42/tweets");
  assert.equal(u.searchParams.get("since_id"), "99");
  assert.equal(u.searchParams.get("until_id"), "101");
  assert.equal(
    u.searchParams.get("tweet.fields"),
    "public_metrics,non_public_metrics",
  );
  assert.deepEqual(got.get("100").values, {
    impressions: 50,
    url_link_clicks: 3,
    likes: 2,
    shares: 1,
    saves: 0,
  });
  // 応答に無ければ空（呼び出し側がやり直す）、失敗は本文を出さずに状態コードだけ
  const empty = createXMetricsReader({
    accessToken: "t",
    accountId: "42",
    fetchImpl: async () => Response.json({ meta: { result_count: 0 } }),
  });
  assert.equal((await empty.read(["100"])).size, 0);
  const failing = createXMetricsReader({
    accessToken: "t",
    accountId: "42",
    fetchImpl: async () =>
      Response.json(
        { title: "Unauthorized", detail: "secret detail" },
        { status: 401 },
      ),
  });
  await assert.rejects(
    failing.read(["100"]),
    (e) => /HTTP 401 Unauthorized/.test(e.message) && !/secret/.test(e.message),
  );
});

test("YouTube の読み取り: 50件までを1回で、非公開の数（likeCount が無い）は null", async () => {
  const urls = [];
  const reader = createYoutubeMetricsReader({
    accessToken: "t",
    fetchImpl: async (url) => {
      urls.push(String(url));
      return Response.json({
        items: [
          {
            id: "a",
            statistics: { viewCount: "10", likeCount: "1", commentCount: "0" },
          },
          { id: "b", statistics: { viewCount: "7", commentCount: "0" } },
        ],
      });
    },
  });
  const got = await reader.read(["a", "b"]);
  assert.match(urls[0], /\/videos\?part=statistics&id=a,b&/);
  assert.deepEqual(got.get("a").values, { views: 10, likes: 1, comments: 0 });
  assert.deepEqual(got.get("b").values, { views: 7, likes: null, comments: 0 });
});

test("PostgREST の store: pending で due を過ぎたものを古い順、閉じるのは pending のときだけ", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push([init.method ?? "GET", u, init.body]);
    if (u.includes("sns_metric_jobs?state=eq.pending"))
      return Response.json([
        {
          id: "j1",
          draft_id: "d1",
          window: "48h",
          source: "x-api",
          attempts: 0,
        },
      ]);
    if (u.includes("sns_drafts?"))
      return Response.json([
        {
          id: "d1",
          status: "posted",
          posted_at: "2026-10-13T00:00:00Z",
          platform: "x",
        },
      ]);
    if (u.includes("sns_x_send_jobs?"))
      return Response.json([
        { draft_id: "d1", channel: "x", external_post_id: "9" },
      ]);
    if (init.method === "PATCH") return Response.json([]);
    return Response.json([]);
  };
  const pg = createSnsMetricsStore({ url: "https://db", key: "k", fetchImpl });
  const [job] = await pg.dueJobs(new Date("2026-10-15T00:05:00Z"), 50);
  assert.equal(job.channel, "x");
  assert.equal(job.external_post_id, "9");
  assert.match(
    calls[0][1],
    /state=eq\.pending&due_at=lte\.2026-10-15T00:05:00\.000Z&order=due_at\.asc,id\.asc&limit=50/,
  );
  assert.match(calls[2][1], /draft_id=in\.\(d1\)&state=eq\.posted/);
  await assert.rejects(pg.finish("j1", "done", null), /pending でない/);
  assert.match(calls.at(-1)[1], /sns_metric_jobs\?id=eq\.j1&state=eq\.pending/);
});

test("値を保存した後に閉じるのが失敗しても、次の実行で欠測に上書きせず done で閉じる", async () => {
  const { draft, postId } = await postedDraft("x", "1840000000000000011");
  const now = windowEnd(draft, 48, 1);
  let failOnce = true;
  const flaky = {
    ...metricsStore,
    finish: async (...args) => {
      if (failOnce) {
        failOnce = false;
        throw new Error(
          "取り込みの DB 操作に失敗: HTTP 503 PATCH sns_metric_jobs",
        );
      }
      return metricsStore.finish(...args);
    },
  };
  await runSnsMetrics(ctx(now), {
    store: flaky,
    readers: {
      x: async () =>
        xReader(
          {
            [postId]: {
              impressions: 7,
              url_link_clicks: 1,
              likes: 1,
              shares: 0,
              saves: 0,
            },
          },
          { at: now },
        ),
    },
  });
  assert.equal((await metricJobs(draft.id))[0].state, "pending");
  await runSnsMetrics(ctx(windowEnd(draft, 48, 20)), {
    store: flaky,
    readers: { x: async () => assert.fail("読まない") },
  });
  assert.equal((await metricJobs(draft.id))[0].state, "done");
  const rows = await observations(draft.id);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.missing_reason === null));
});

test("トークンを取れない失敗は job ごとに Slack を出さない（report.alerts の token:x に任せる）", async () => {
  const { draft } = await postedDraft("x", "1840000000000000012");
  const notices = [];
  for (const m of [0, 5, 10])
    await runSnsMetrics(ctx(windowEnd(draft, 48, m)), {
      store: metricsStore,
      readers: {
        x: async () => {
          throw new Error("X と連携していません");
        },
      },
      notify: async (t) => notices.push(t),
    });
  assert.equal((await metricJobs(draft.id))[0].attempts, 3);
  assert.deepEqual(notices, []);
});

test("PostgREST の store: 直近の件数は Content-Range から取り、max-rows で数え漏れない", async () => {
  const urls = [];
  const totals = { done: 1500, missing: 20, failed: 0 };
  const pg = createSnsMetricsStore({
    url: "https://db",
    key: "k",
    fetchImpl: async (url, init) => {
      const u = decodeURIComponent(String(url));
      urls.push([u, init.headers.Prefer]);
      const state = u.match(/state=eq\.(\w+)/)[1];
      return new Response("[{}]", {
        headers: { "content-range": `0-0/${totals[state]}` },
      });
    },
  });
  assert.deepEqual(
    await pg.recentOutcomes(new Date("2026-10-15T00:00:00Z"), 5),
    totals,
  );
  assert.ok(
    urls.every(
      ([u, prefer]) =>
        /done_at=gte\.2026-10-10T00:00:00\.000Z&select=id&limit=1/.test(u) &&
        prefer === "count=exact",
    ),
  );
});
