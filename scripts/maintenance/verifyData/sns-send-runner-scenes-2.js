/**
 * verify-sns-send-runner.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-send-runner.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import { createMockYoutubeAdapter } from "../../../api/_lib/snsDeadlineQueue.js";
import { createSnsSendStore, runSnsSend } from "../../lib/snsSendRunner.js";

let db, store, approvedJob, ctx, job, deps;

// ---- BOA-1164: 検査の枠・残した理由・公開しないで閉じる ----

// 本番の Chromium と同じく、1回の実行で6回を超えたら public_check_budget を投げる送る前の検査（実行ごとに作り直す）
const budgetedPreflight = () => {
  let used = 0;
  return async () => {
    used += 1;
    if (used > 6) throw new Error("public_check_budget");
  };
};

function scene1() {
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
  test("182: claim が出し物ごとの取り置き（kind_slot_full）で held を返したら、一度きりの事象として Slack に知らせる", async () => {
    const x = await approvedJob("x");
    const notices = [];
    // 182 の claim が返す形（held・kind_slot_full）を、153 までの PGlite の hold で作る
    const holding = {
      ...store,
      transition: (id, action, result) =>
        action === "claim"
          ? store.transition(id, "hold", { reason: "kind_slot_full" })
          : store.transition(id, action, result),
    };
    await runSnsSend(
      ctx(),
      deps({ store: holding, notify: async (t) => notices.push(t) }),
    );
    assert.equal((await job(x.id)).error_code, "kind_slot_full");
    assert.equal(notices.filter((t) => t.includes("kind_slot_full")).length, 1);
  });
}

function scene2() {
  test("BOA-1172: サムネイルの設定に失敗しても YouTube は posted まで進め、理由を report.jobs に入れて Slack に1回知らせる。届かなければ report.alerts に残す", async () => {
    const y = await approvedJob("youtube", { cover: "c.png" });
    const notices = [];
    const result = await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () =>
            createMockYoutubeAdapter({
              failAt: "thumbnail",
              videoId: "thumbfail01",
            }),
        },
        notify: async (t) => notices.push(t),
      }),
    );
    assert.equal((await job(y.id)).state, "posted");
    const row = result.body.jobs.find((r) => r.id === y.id);
    assert.equal(row.outcome, "posted");
    assert.equal(row.thumbnail_error, "mock_failure");
    const told = notices.filter((t) => t.includes("サムネイル"));
    assert.equal(told.length, 1);
    assert.match(
      told[0],
      new RegExp(`job ${y.id} のサムネイルを設定できなかった`),
    );
    assert.match(told[0], /動画の送信は続けた/);

    // Slack に届かなければ report.alerts に残す（一度きりの事象と同じ扱い）
    const z = await approvedJob("youtube", { cover: "c.png" });
    const undelivered = await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () =>
            createMockYoutubeAdapter({
              failAt: "thumbnail",
              videoId: "thumbfail02",
            }),
        },
        notify: async () => {
          throw new Error("webhook_down");
        },
      }),
    );
    assert.equal((await job(z.id)).state, "posted");
    assert.ok(
      undelivered.report.alerts.some(
        (a) => a.key === `undelivered:thumbnail:${z.id}`,
      ),
    );
    // サムネイルが通れば知らせない
    const w = await approvedJob("youtube", { cover: "c.png" });
    const quiet = [];
    await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () =>
            createMockYoutubeAdapter({ videoId: "thumbpass01" }),
        },
        notify: async (t) => quiet.push(t),
      }),
    );
    assert.equal((await job(w.id)).state, "posted");
    assert.equal(quiet.filter((t) => t.includes("サムネイル")).length, 0);
  });
  test("BOA-1164 検査の枠: 先に別レースの X が検査を使った実行では YouTube を claim せず次の実行に回し、次の実行で公開する", async () => {
    const x = await approvedJob("x", { scheduledOffsetMin: -3 });
    const y = await approvedJob("youtube", { scheduledOffsetMin: -2 });
    const firstRun = await runSnsSend(
      ctx(),
      deps({ preflight: budgetedPreflight(), headlessBudget: 6 }),
    );
    assert.equal((await job(x.id)).state, "posted");
    // 修正前は X（3回）の後に YouTube（6回）が入り、公開の準備の後の検査で public_check_budget になって非公開のまま残った
    assert.equal((await job(y.id)).state, "queued");
    assert.equal((await job(y.id)).attempts, 0);
    assert.equal(
      firstRun.body.jobs.find((r) => r.id === y.id)?.outcome,
      "headless_budget_wait",
    );
    await runSnsSend(
      {
        ...ctx(),
        state: { cursor: firstRun.cursor, last_report: firstRun.report },
      },
      deps({ preflight: budgetedPreflight(), headlessBudget: 6 }),
    );
    assert.equal((await job(y.id)).state, "posted");
  });
}

function scene3() {
  test("BOA-1164 検査の枠: X は1回の実行で2件まで（3件目は次の実行）。試運転は検査1回ずつで枠を待たない", async () => {
    const xs = [];
    for (const offset of [-4, -3, -2])
      xs.push(await approvedJob("x", { scheduledOffsetMin: offset }));
    // 投稿の ID は job ごとに違う（external_post_id は一意）
    const base = createMockXAdapter();
    let n = 0;
    const xAdapter = {
      ...base,
      createPost: async (payload) => ({
        ...(await base.createPost(payload)),
        id: String(9000 + ++n),
      }),
    };
    const run = await runSnsSend(
      ctx(),
      deps({
        preflight: budgetedPreflight(),
        headlessBudget: 6,
        adapters: { x: async () => xAdapter },
      }),
    );
    assert.deepEqual(
      await Promise.all(xs.map(async (j) => (await job(j.id)).state)),
      ["posted", "posted", "queued"],
    );
    assert.equal(run.body.jobs.at(-1).outcome, "headless_budget_wait");
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
    );
    const extra = await approvedJob("x");
    const dry = await runSnsSend(
      ctx(),
      deps({ preflight: budgetedPreflight(), headlessBudget: 6 }),
    );
    assert.deepEqual(
      dry.body.jobs.map((r) => r.outcome),
      ["dry_run", "dry_run"],
    );
    assert.equal((await job(extra.id)).state, "queued");
  });
}

function scene4() {
  test("BOA-1164 残した理由: 処理の確認を使い切った・検査の枠・検査の失敗・太平洋時間の日付の境目を error_code に分ける", async () => {
    const processing = await approvedJob("youtube");
    await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () =>
            createMockYoutubeAdapter({ processingStatus: "processing" }),
        },
      }),
    );
    assert.equal(
      (await job(processing.id)).error_code,
      "youtube_retained_processing",
    );

    // 公開の準備の後の検査（runner の検査から数えて4回目）で落ちる
    for (const [message, code, videoId] of [
      ["public_check_budget", "youtube_retained_budget", "bbbbbbbbbbb"],
      [
        "public_component_missing",
        "youtube_retained_check_failed",
        "ccccccccccc",
      ],
    ]) {
      await db.exec(
        "UPDATE sns_x_send_jobs SET state='cancelled' WHERE state IN ('queued','reconcile')",
      );
      const y = await approvedJob("youtube");
      let n = 0;
      await runSnsSend(
        ctx(),
        deps({
          preflight: async () => {
            n += 1;
            if (n === 4) throw new Error(message);
          },
          adapters: {
            youtube: async () => createMockYoutubeAdapter({ videoId }),
          },
          notify: async () => {},
        }),
      );
      const row = await job(y.id);
      assert.equal(row.youtube_stage, "private_retained");
      assert.equal(row.error_code, code);
    }

    // アップロードの後に太平洋時間の日付が変わった（試行のクォータの日が今日でない）
    await db.exec(
      "UPDATE sns_x_send_jobs SET state='cancelled' WHERE state IN ('queued','reconcile')",
    );
    const crossing = await approvedJob("youtube");
    await runSnsSend(
      ctx(),
      deps({
        adapters: {
          youtube: async () =>
            createMockYoutubeAdapter({
              videoId: "ddddddddddd",
              afterUpload: () =>
                db.exec(
                  "UPDATE sns_youtube_quota_attempts SET quota_day = quota_day - 1",
                ),
            }),
        },
        notify: async () => {},
      }),
    );
    assert.equal((await job(crossing.id)).error_code, "youtube_retained_pt_day");
  });
  test("BOA-1164 残した理由: 理由を渡さない呼び出し（186 の前のコード）・知らない理由は今までの youtube_private_retained", async () => {
    for (const [result, videoId] of [
      [undefined, "eeeeeeeeeee"],
      [{ reason: "other" }, "fffffffffff"],
    ]) {
      const y = await approvedJob("youtube");
      await store.transition(y.id, "claim");
      await store.transition(y.id, "begin_post");
      await store.transition(y.id, "youtube_call", { method: "videos.insert" });
      await store.transition(y.id, "youtube_uploaded", { id: videoId });
      assert.equal(
        (await store.transition(y.id, "youtube_retain", result)).error_code,
        "youtube_private_retained",
      );
      await db.query("UPDATE sns_x_send_jobs SET state='cancelled' WHERE id=$1", [
        y.id,
      ]);
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・store・approvedJob・ctx・job・deps） */
export function runSnsSendRunnerScenes2(env) {
  ({ db, store, approvedJob, ctx, job, deps } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
