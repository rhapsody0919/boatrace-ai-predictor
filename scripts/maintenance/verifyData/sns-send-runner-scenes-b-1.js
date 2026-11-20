/**
 * verify-sns-send-runner.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { runSnsSend, createSnsSendStore } from "../../lib/snsSendRunner.js";
import { checkTokenHealth } from "../../../api/_lib/snsTokenHealth.js";
import { handleTokenHealth } from "../../../api/admin/sns-hub/token-health.js";
import { livenessCheckable } from "../../lib/scrapeJobs/monitor.js";
import { activeMinutesOf, SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";

let store, approvedJob, ctx, job, deps;

function ssrb1Scene1() {
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
}

function ssrb1Scene2() {
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
}

function ssrb1Scene3() {
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
}

function ssrb1Scene4() {
  test("鍵の健全性: x_read で refresh の後に保存できなかったら、Slack に連携のやり直しを知らせる（点検 2026-10-13-11）", async () => {
    const { encryptTokens } = await import("../../../api/_lib/snsTokenStore.js");
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（store・approvedJob・ctx・job・deps） */
export function runSnsSendRunnerScenesB1(env) {
  ({ store, approvedJob, ctx, job, deps } = env);
  ssrb1Scene1();
  ssrb1Scene2();
  ssrb1Scene3();
  ssrb1Scene4();
}
