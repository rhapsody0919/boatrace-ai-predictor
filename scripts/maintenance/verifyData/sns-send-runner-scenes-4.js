/**
 * verify-sns-send-runner.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runSnsSend,
  createPostgrestEventWriter,
  createSnsSendStore,
} from "../../lib/snsSendRunner.js";
import { events } from "./sns-send-runner-scenes-3.js";

let db, store, approvedJob, ctx, failingPreflight, job, deps;

// ---- BOA-1201（#2070 の審査）: claim の DB の拒否を文言ごとの code に、begin_post の後は stage=after_post に ----

// 本番の xSendStore（api/_lib/snsXSendStore.js）の transition を、PostgREST の応答の形で PGlite につなぐ。
// RAISE は PostgREST と同じく HTTP 400 と {code, message, details, hint} で返す。override は action ごとに応答を差し替える
async function withPostgrestTransition(fn, override = {}) {
  const { xSendStore } = await import("../../../api/_lib/snsXSendStore.js");
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /rpc\/transition_sns_x_send$/);
    const body = JSON.parse(options.body);
    if (override[body.p_action]) return override[body.p_action]();
    try {
      const r = await store.transition(
        body.p_job_id,
        body.p_action,
        body.p_result,
      );
      return new Response(JSON.stringify(r), { status: 200 });
    } catch (e) {
      return new Response(
        JSON.stringify({
          code: e.code ?? "P0001",
          message: e.message,
          details: null,
          hint: null,
        }),
        { status: 400 },
      );
    }
  };
  try {
    return await fn({
      ...store,
      transition: (id, action, result) =>
        xSendStore.transition(id, action, result),
    });
  } finally {
    globalThis.fetch = original;
  }
}

function scene1() {
  for (const [label, failure, alerted] of [
    ["表が無い（404・PGRST205）", { tableMissing: true }, false],
    ["それ以外の失敗", { tableMissing: false }, true],
  ])
    test(`BOA-1201 理由の記録: 書き込みが落ちても送信は続く（${label}）`, async () => {
      const a = await approvedJob("x", { scheduledOffsetMin: -3 });
      const b = await approvedJob("x", { scheduledOffsetMin: -1 });
      const result = await runSnsSend(
        ctx(),
        deps({
          store: {
            ...store,
            recordEvent: async () => {
              throw Object.assign(
                new Error("sns_send_events の書き込みに失敗"),
                failure,
              );
            },
          },
          preflight: async (j) => {
            if (j.id === a.id) throw new Error("source_changed");
          },
        }),
      );
      assert.deepEqual(
        result.body.jobs.map((r) => [r.id, r.outcome]),
        [
          [a.id, "precheck_failed"],
          [b.id, "posted"],
        ],
      );
      assert.equal((await job(b.id)).state, "posted");
      // 表が無い間（191 は db-apply でデプロイの後）は Slack を鳴らし続けない
      assert.equal(
        result.report.alerts.some((x) => x.key === "send_events"),
        alerted,
      );
    });
  test("BOA-1201 理由の記録: shadow では書かない", async () => {
    await approvedJob("x");
    const result = await runSnsSend(
      ctx("shadow"),
      deps({ preflight: failingPreflight }),
    );
    assert.equal(result.body.jobs[0].outcome, "precheck_failed");
    assert.deepEqual(await events(), []);
  });
  test("BOA-1201 理由の記録: YouTube の送信の中で public_component_missing なら held（youtube_preflight_failed）と stage=send の1行。日本語の失敗は holdReasonOf の code", async () => {
    const y = await approvedJob("youtube");
    // runner の検査（1回目）は通し、送信の中の検査（2回目）で落とす
    let calls = 0;
    const result = await runSnsSend(
      ctx(),
      deps({
        preflight: async () => {
          calls += 1;
          if (calls >= 2) throw new Error("public_component_missing");
        },
      }),
    );
    assert.equal(result.body.jobs[0].reason, "public_component_missing");
    const row = await job(y.id);
    assert.equal(row.state, "held");
    assert.equal(row.error_code, "youtube_preflight_failed");
    assert.deepEqual(await events(), [
      {
        job_id: y.id,
        stage: "send",
        reason: "public_component_missing",
        detail: "public_component_missing",
      },
    ]);
    // 媒体の照合の失敗（日本語の文言）は「youtube_preflight_種類」の code、文言は detail
    const z = await approvedJob("youtube");
    await runSnsSend(
      ctx(),
      deps({ loadMedia: async () => new Uint8Array([9, 9, 9]) }),
    );
    assert.equal((await job(z.id)).error_code, "youtube_preflight_failed");
    assert.deepEqual(
      (await events()).filter((e) => e.job_id === z.id),
      [
        {
          job_id: z.id,
          stage: "send",
          reason: "youtube_preflight_media_changed",
          detail: "媒体が変更されています",
        },
      ],
    );
  });
}

function scene2() {
  test("BOA-1201 PostgREST の書き込み: on_conflict と ignore-duplicates で POST し、404・PGRST205 は tableMissing、ほかの失敗は投げる", async () => {
    const calls = [];
    const respond = (status, body) => async (url, init) => {
      calls.push({ url, init });
      return new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      });
    };
    const event = {
      job_id: "00000000-0000-0000-0000-000000000001",
      stage: "precheck",
      reason: "source_changed",
      detail: "source_changed",
    };
    await createPostgrestEventWriter({
      url: "https://db.example",
      key: "k",
      fetchImpl: respond(201),
    })(event);
    assert.equal(
      calls[0].url,
      "https://db.example/rest/v1/sns_send_events?on_conflict=job_id,stage,reason",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(
      calls[0].init.headers.Prefer,
      "resolution=ignore-duplicates,return=minimal",
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), event);
    for (const [status, body, missing] of [
      [404, { code: "PGRST205", message: "Could not find the table" }, true],
      [404, null, true],
      [409, { code: "23503", message: "fk" }, false],
      [500, null, false],
    ]) {
      const error = await createPostgrestEventWriter({
        url: "https://db.example",
        key: "k",
        fetchImpl: respond(status, body ?? undefined),
      })(event).then(
        () => null,
        (e) => e,
      );
      assert.ok(error, `HTTP ${status} は投げる`);
      assert.equal(error.tableMissing, missing, `HTTP ${status}`);
      assert.doesNotMatch(error.message, /Could not find|fk$/);
    }
    // runner の store に渡す
    assert.equal(
      createSnsSendStore({ db: async () => [], xSendStore: {}, writeEvent: 1 })
        .recordEvent,
      1,
    );
  });
  test("BOA-1201 理由の記録: detail は文字単位で300字までに切る", async () => {
    await approvedJob("x");
    const long = "あ".repeat(299) + "😀" + "い".repeat(10);
    await runSnsSend(
      ctx(),
      deps({
        preflight: async () => {
          throw new Error(long);
        },
      }),
    );
    const [row] = await events();
    assert.equal(row.reason, "unexpected_error");
    assert.equal(Array.from(row.detail).length, 300);
    assert.ok(row.detail.endsWith("😀"));
  });
}

function scene3() {
  test("BOA-1201 claim の拒否: 日次全体上限と月額上限は別の reason の2行（detail は元の文言）、利用者に見せる文言は今までどおり", async () => {
    const j = await approvedJob("x");
    const notices = [];
    await withPostgrestTransition(async (pgStore) => {
      await db.exec("UPDATE sns_x_send_control SET daily_external_count=1000");
      const daily = await runSnsSend(
        ctx(),
        deps({ store: pgStore, notify: async (t) => notices.push(t) }),
      );
      assert.equal(daily.body.jobs[0].reason, "claim_daily_limit");
      await db.exec(
        "UPDATE sns_x_send_control SET daily_external_count=0, reserved_microusd=budget_microusd",
      );
      const monthly = await runSnsSend(
        ctx(),
        deps({ store: pgStore, notify: async (t) => notices.push(t) }),
      );
      assert.equal(monthly.body.jobs[0].reason, "claim_monthly_budget");
    });
    assert.equal((await job(j.id)).state, "queued");
    assert.deepEqual(await events(), [
      {
        job_id: j.id,
        stage: "send",
        reason: "claim_daily_limit",
        detail: "日次全体上限です",
      },
      {
        job_id: j.id,
        stage: "send",
        reason: "claim_monthly_budget",
        detail: "月額上限です",
      },
    ]);
    assert.match(notices[0], /X送信のDB操作に失敗しました/);
  });
  for (const [label, response, detail] of [
    [
      "表に無い文言",
      () =>
        new Response(
          JSON.stringify({ code: "P0001", message: "知らない拒否です" }),
          { status: 400 },
        ),
      "知らない拒否です",
    ],
    [
      "本文の無い 503",
      () => new Response("", { status: 503 }),
      "X送信のDB操作に失敗しました（HTTP 503）",
    ],
  ])
    test(`BOA-1201 claim の拒否: 写せない（${label}）は db_rejected で、detail に元の文言`, async () => {
      const j = await approvedJob("x");
      const result = await withPostgrestTransition(
        (pgStore) => runSnsSend(ctx(), deps({ store: pgStore })),
        { claim: response },
      );
      assert.equal(result.body.jobs[0].reason, "db_rejected");
      assert.deepEqual(await events(), [
        { job_id: j.id, stage: "send", reason: "db_rejected", detail },
      ]);
    });
  test("BOA-1201 claim の拒否: 英小文字と _ の文言（YouTube のクォータ）も code に写す", async () => {
    const y = await approvedJob("youtube");
    await db.exec("UPDATE sns_youtube_quota_control SET external_uploads=10");
    const result = await withPostgrestTransition((pgStore) =>
      runSnsSend(ctx(), deps({ store: pgStore })),
    );
    assert.equal(result.body.jobs[0].reason, "claim_youtube_quota_limit");
    assert.deepEqual(await events(), [
      {
        job_id: y.id,
        stage: "send",
        reason: "claim_youtube_quota_limit",
        detail: "youtube_quota_limit",
      },
    ]);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・store・approvedJob・ctx・failingPreflight・job・deps） */
export function runSnsSendRunnerScenes6(env) {
  ({ db, store, approvedJob, ctx, failingPreflight, job, deps } = env);
  scene1();
  scene2();
  scene3();
}
