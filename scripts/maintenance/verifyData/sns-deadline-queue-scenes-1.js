/**
 * verify-sns-deadline-queue.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-deadline-queue.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createMockXAdapter } from "../../../api/_lib/snsXSend.js";
import {
  createMockHeadless,
  createDeadlinePreflight,
  checkPublicDisplay,
  reconcileSendJob,
  createMockYoutubeAdapter,
  runYoutubeQueueJob,
} from "../../../api/_lib/snsDeadlineQueue.js";

let db, first, store, loadMedia, queue, job, enable, run;

export function preflight(
  j,
  headless = createMockHeadless({ visibleSelectors: ["[data-sonar]"] }),
  extra = {},
) {
  return createDeadlinePreflight({
    headless,
    markers: { sonar: ["[data-sonar]"] },
    readCurrent: async () => ({
      withdrawn: false,
      cancelled: false,
      source_revision: "v1",
      deadline_at: j.snapshot.queue.deadline_at,
    }),
    ...extra,
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・loadMedia・queue・job・enable） */
export function runSnsDeadlineQueueScenes1(env) {
  ({ db, first, store, loadMedia, queue, job, enable } = env);

}

function scene1() {
  test("設定未承認は保留、期限境界・期限欠落・鮮度を自動保留", async () => {
    const pending = await job();
    assert.equal(
      (await store.transition(pending.id, "claim")).error_code,
      "timing_pending_owner",
    );
    await enable();
    for (const [q, reason] of [
      [
        { ...queue(), expires_at: new Date(Date.now() - 1).toISOString() },
        "deadline_expired",
      ],
      [{ ...queue(), expires_at: null }, "deadline_missing"],
      [
        { ...queue(), source_observed_at: "2000-01-01T00:00:00Z" },
        "source_stale",
      ],
    ]) {
      const j = await job({ q });
      assert.equal((await store.transition(j.id, "claim")).error_code, reason);
    }
  });
  test("毎回ログインなしの公開表示検査、Preview・redirect・非表示・変更版は送らない", async () => {
    await enable();
    const j = await job(),
      browser = createMockHeadless({ visibleSelectors: ["[data-sonar]"] });
    const x = createMockXAdapter();
    assert.equal(
      (await run(j, x, { preflight: preflight(j, browser) })).state,
      "posted",
    );
    assert.equal(browser.calls.length, 2);
    assert.deepEqual(browser.calls[0].context, { storageState: null });
    for (const patch of [
      { public_url: "https://www.boat-ai.jp/race/test?preview=1" },
      { public_url: "https://www.boat-ai.jp/race/test?analogy=1" },
    ])
      await assert.rejects(
        checkPublicDisplay({ ...queue(), ...patch }, browser, {
          sonar: ["[data-sonar]"],
        }),
      );
    for (const opts of [
      { visibleSelectors: [] },
      {
        visibleSelectors: ["[data-sonar]"],
        finalUrl: "https://www.boat-ai.jp/login",
      },
      { fail: true },
    ]) {
      const held = await job(),
        adapter = createMockXAdapter();
      await assert.rejects(
        run(held, adapter, {
          preflight: preflight(held, createMockHeadless(opts)),
        }),
      );
      assert.equal(adapter.calls.length, 0);
      assert.equal(
        (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [held.id]))
          .state,
        "held",
      );
    }
    const changed = await job();
    await assert.rejects(
      preflight(changed, browser, {
        readCurrent: async () => ({ withdrawn: true }),
      })(changed),
    );
  });
  test("加重文字数と未解決差し込みを拒否、URLは公式計数", async () => {
    await enable();
    for (const text of ["あ".repeat(141), "締切{HH:mm}", "本文 ${value}"]) {
      const j = await job({ text }),
        x = createMockXAdapter();
      await assert.rejects(run(j, x));
      assert.equal(x.calls.length, 0);
    }
    const j = await job({
      text: "あ".repeat(120) + " https://www.boat-ai.jp/" + "a".repeat(500),
    });
    await preflight(j)(j);
  });
}

function scene2() {
  test("長文の1投稿（25,000まで）は queue.thread_length=1 の親だけ。子・印なし・超過は weighted_text_invalid", async () => {
    const fake = (text, extra = {}) => {
      const queue = {
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        deadline_at: new Date(Date.now() + 7200000).toISOString(),
        source_revision: "v1",
        public_url: "https://www.boat-ai.jp/race/x",
        screen_key: "sonar",
        ...extra,
      };
      const snapshot = { text, queue };
      return {
        id: "j",
        draft_id: "d",
        channel: "x",
        snapshot,
        snapshot_text: JSON.stringify(snapshot),
      };
    };
    const long = "あ".repeat(5000);
    const ok = fake(long, { thread_length: 1 });
    await preflight(ok)(ok);
    for (const [j, why] of [
      [fake(long), "印なし（auto-plan 以外の下書き）"],
      [fake(long, { thread_length: 2 }), "子のあるスレッドの親"],
      [fake(long, { thread_length: 1, parent_job_id: "p" }), "返信"],
      [fake("あ".repeat(12501), { thread_length: 1 }), "25,000 超え"],
    ])
      await assert.rejects(preflight(j)(j), /weighted_text_invalid/, why);
  });
  test("公開検査の待ち時間で失効しても送らない", async () => {
    const j = await job();
    let t = Date.now();
    const browser = {
      async inspect(req) {
        t = Date.parse(j.expires_at);
        return { finalUrl: req.url, visibleSelectors: ["[data-sonar]"] };
      },
    };
    await assert.rejects(
      preflight(j, browser, { now: () => t })(j),
      /deadline_expired/,
    );
  });
  test("日次全体上限をロックで守る、上限不明は止める", async () => {
    await enable();
    await db.exec("UPDATE sns_x_send_control SET daily_limit=NULL");
    const a = await job();
    await assert.rejects(store.transition(a.id, "claim"), /日次/);
    const count = Number(
      (
        await first(
          "SELECT count(*) n FROM sns_x_send_jobs WHERE channel='x' AND (locked_at AT TIME ZONE 'Asia/Tokyo')::date=(now() AT TIME ZONE 'Asia/Tokyo')::date",
        )
      ).n,
    );
    await enable(count + 1);
    const b = await job();
    const result = await Promise.allSettled([
      store.transition(a.id, "claim"),
      store.transition(b.id, "claim"),
    ]);
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・loadMedia・queue・job・enable・run） */
export function runSnsDeadlineQueueScenes2(env) {
  ({ db, first, store, loadMedia, queue, job, enable, run } = env);
  scene1();
  scene2();
}

function scene3() {
  test("HTTP timeout・lease失効は要照合、1チャネル障害で他を再送しない", async () => {
    await enable();
    const failed = await job(),
      other = await job({
        platform: "youtube",
        q: { ...queue(), youtube_mode: "immediate" },
      });
    await assert.rejects(
      run(failed, createMockXAdapter({ failAt: "createPost" })),
    );
    const uncertain = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
      failed.id,
    ]);
    assert.equal(uncertain.state, "reconcile");
    assert.equal(
      (
        await reconcileSendJob(uncertain, {
          store,
          lookup: async () => ({ confirmed: false }),
        })
      ).state,
      "reconcile",
    );
    await assert.rejects(store.transition(failed.id, "claim"));
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [other.id]))
        .state,
      "queued",
    );
    const youtube = createMockYoutubeAdapter();
    assert.equal(
      (
        await runYoutubeQueueJob(other.id, {
          store,
          youtube,
          loadMedia,
          preflight: preflight(other),
        })
      ).state,
      "posted",
    );
    const lease = await job();
    await store.transition(lease.id, "claim");
    await db.query(
      "UPDATE sns_x_send_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [lease.id],
    );
    await db.exec("SELECT sweep_sns_deadline_queue()");
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [lease.id]))
        .state,
      "reconcile",
    );
  });
  test("source_data編集は再承認、権限を維持", async () => {
    await enable();
    const j = await job();
    await db.query("UPDATE sns_drafts SET source_data='{}' WHERE id=$1", [
      j.draft_id,
    ]);
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [j.id]))
        .state,
      "cancelled",
    );
    await db.exec("SET ROLE authenticated");
    await assert.rejects(
      db.exec("SELECT sweep_sns_deadline_queue()"),
      /permission denied/,
    );
    await db.exec("RESET ROLE");
  });
}

function scene4() {
  test("YouTube予約は時刻待ち、due時に再検査して公開、署名URLを保存しない", async () => {
    await enable();
    const j = await job({
      platform: "youtube",
      q: { ...queue(), youtube_mode: "scheduled" },
    });
    await db.query(
      "UPDATE sns_x_send_jobs SET scheduled_at=now()+interval '10 minutes' WHERE id=$1",
      [j.id],
    );
    const youtube = createMockYoutubeAdapter({ videoId: "scheduled01" });
    await assert.rejects(
      runYoutubeQueueJob(j.id, {
        store,
        youtube,
        loadMedia,
        preflight: preflight(j),
      }),
      /claim/,
    );
    assert.equal(youtube.calls.length, 0);
    await db.query("UPDATE sns_x_send_jobs SET scheduled_at=now() WHERE id=$1", [
      j.id,
    ]);
    let checked = 0;
    assert.equal(
      (
        await runYoutubeQueueJob(j.id, {
          store,
          youtube,
          loadMedia,
          preflight: async (current) => {
            checked++;
            await preflight(j)(current);
          },
        })
      ).state,
      "posted",
    );
    // begin_post の前・videos.insert の前・公開の準備の後・videos.update の前の4回。videos.list（公開の確認）の前は検査しない
    // （videos.update の後で止められるものが無い。BOA-1164 の system-architect の指摘）
    assert.equal(checked, 4);
    assert.equal(youtube.calls[0].payload.privacyStatus, "private");
    assert.equal(youtube.calls[0].payload.publishAt, null);
    assert.equal(youtube.calls[0].payload.snapshot.media[0].path, "demo/a.mp4");
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・store・loadMedia・queue・job・enable・run） */
export function runSnsDeadlineQueueScenes3(env) {
  ({ db, first, store, loadMedia, queue, job, enable, run } = env);
  scene3();
  scene4();
}
