/**
 * verify-sns-send-runner.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { runSnsSend, PARENT_WAIT_ALERT_MINUTES } from "../../lib/snsSendRunner.js";
import { checkTokenHealth } from "../../../api/_lib/snsTokenHealth.js";

let db, store, approvedJob, ctx, failingPreflight, job, deps;

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

function scene1() {
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
}

function scene2() {
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
}

function scene3() {
  test("鍵の健全性: ?x_read=1 のときだけ X の自分のアカウントを読み、既定では X を呼ばない", async () => {
    const { encryptTokens } = await import("../../../api/_lib/snsTokenStore.js");
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
    const { xSendStore } = await import("../../../api/_lib/snsXSendStore.js");
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
}

function scene4() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・store・approvedJob・ctx・failingPreflight・job・deps） */
export function runSnsSendRunnerScenes1(env) {
  ({ db, store, approvedJob, ctx, failingPreflight, job, deps } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
