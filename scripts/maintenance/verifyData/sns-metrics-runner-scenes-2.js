/**
 * verify-sns-metrics-runner.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-metrics-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runSnsMetrics, createSnsMetricsStore } from "../../lib/snsMetricsRunner.js";

let metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, xReader;

function scene1() {
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
                replies: 0,
                quotes: 0,
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
    assert.equal(rows.length, 7);
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（metricsStore・postedDraft・windowEnd・ctx・metricJobs・observations・xReader） */
export function runSnsMetricsRunnerScenes2(env) {
  ({ metricsStore, postedDraft, windowEnd, ctx, metricJobs, observations, xReader } = env);
  scene1();
}
