/**
 * verify-sns-metrics-runner.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-metrics-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSnsMetrics,
  dailySendMicrousd,
  createXMetricsReader,
  createYoutubeMetricsReader,
  createSnsMetricsStore,
} from "../../lib/snsMetricsRunner.js";

let db, metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, reserved, xReader;

function scene1() {
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
}

function scene2() {
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
}

function scene3() {
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
                reply_count: 4,
                quote_count: 1,
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
      replies: 4,
      quotes: 1,
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
}

function scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・metricsStore・postedDraft・windowEnd・ctx・metricJobs・observations・reserved・xReader） */
export function runSnsMetricsRunnerScenes1(env) {
  ({ db, metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, reserved, xReader } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
