/**
 * verify-sns-send-runner.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import { runSnsSend } from "../../lib/snsSendRunner.js";
import { checkTokenHealth } from "../../../api/_lib/snsTokenHealth.js";
import { runSnsSendRunnerScenes1 } from "./sns-send-runner-scenes-1.js";
import { runSnsSendRunnerScenes2 } from "./sns-send-runner-scenes-2.js";
import {
  runSnsSendRunnerScenes3,
  runSnsSendRunnerScenes4,
  runSnsSendRunnerScenes5,
} from "./sns-send-runner-scenes-3.js";
import { runSnsSendRunnerScenes6 } from "./sns-send-runner-scenes-4.js";
import { runSnsSendRunnerScenes7 } from "./sns-send-runner-scenes-5.js";
import { runSnsSendRunnerScenes8 } from "./sns-send-runner-scenes-6.js";

let db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2;

function ssrb2Scene1() {
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
}

function ssrb2Scene2() {
  test("鍵の健全性: X は保存値を読むだけで refresh しない", async () => {
    const { encryptTokens } = await import("../../../api/_lib/snsTokenStore.js");
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenesB2(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  ssrb2Scene1();
  ssrb2Scene2();
}

function ssrb2Scene3() {
  // ---- 後半の場面（verifyData/sns-send-runner-scenes-3.js） ----
  runSnsSendRunnerScenes4({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenesB3(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  ssrb2Scene3();
}

function ssrb2Scene4() {
  // ---- 後半の場面（verifyData/sns-send-runner-scenes-3.js・sns-send-runner-scenes-4.js・sns-send-runner-scenes-5.js・sns-send-runner-scenes-6.js） ----
  runSnsSendRunnerScenes5({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 });
  runSnsSendRunnerScenes6({ db, store, approvedJob, ctx, failingPreflight, job, deps });
  runSnsSendRunnerScenes7({ db, first, store, approvedJob, ctx, job, deps });
  runSnsSendRunnerScenes8({ db, store, ctx, job, deps });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・approvedJob・ctx・failingPreflight・job・deps・retainedJob2） */
export function runSnsSendRunnerScenesB4(env) {
  ({ db, first, store, approvedJob, ctx, failingPreflight, job, deps, retainedJob2 } = env);
  ssrb2Scene4();
}
