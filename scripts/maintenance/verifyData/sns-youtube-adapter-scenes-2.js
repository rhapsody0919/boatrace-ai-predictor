/**
 * verify-sns-youtube-adapter.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-youtube-adapter.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createYoutubeQueueAdapter } from "../../../api/_lib/youtubeQueueAdapter.js";

let first, approvedJob, json, fakeYoutube, run;

function scene1() {
  test("upload の成功の応答が JSON でない・通信が例外で切れたときは、要照合に残し表紙も公開も試さない", async () => {
    for (const failing of [
      async () => new Response("<html>ok</html>", { status: 200 }),
      async () => {
        throw new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        );
      },
    ]) {
      const job = await approvedJob();
      const calls = [];
      const fetchImpl = async (url) => {
        calls.push(new URL(url).pathname);
        if (new URL(url).pathname === "/upload/youtube/v3/videos")
          return failing();
        throw new Error("ここまで進まない: " + url);
      };
      await assert.rejects(run(job, { calls, fetchImpl }));
      assert.deepEqual(calls, ["/upload/youtube/v3/videos"]);
      const row = await first(
        "SELECT state, youtube_stage, external_post_id FROM sns_x_send_jobs WHERE id=$1",
        [job.id],
      );
      // 動画が上がったかは分からないので非公開と断定せず、要照合（ID 不明）のまま
      assert.deepEqual(row, {
        state: "reconcile",
        youtube_stage: null,
        external_post_id: null,
      });
    }
  });
  test("公開の更新の後の確認の読み取りが失われても、公開済み・非公開のどちらとも断定せず update_started の要照合に残す", async () => {
    const job = await approvedJob({ withCover: false });
    const base = fakeYoutube();
    let gets = 0;
    const fetchImpl = async (url, options = {}) => {
      const u = new URL(url);
      if (
        u.pathname === "/youtube/v3/videos" &&
        (options.method || "GET") === "GET" &&
        ++gets === 2
      ) {
        throw new TypeError("fetch failed");
      }
      return base.fetchImpl(url, options);
    };
    await assert.rejects(
      run(job, { calls: base.calls, fetchImpl }),
      /fetch failed/,
    );
    assert.deepEqual(
      await first(
        "SELECT state, youtube_stage FROM sns_x_send_jobs WHERE id=$1",
        [job.id],
      ),
      {
        state: "reconcile",
        youtube_stage: "update_started",
      },
    );
  });
  test("公開を読めても publishedAt が無いときは公開済みにしない", async () => {
    const job = await approvedJob({ withCover: false });
    const fake = fakeYoutube({ publishedAt: null });
    await assert.rejects(run(job, fake), /youtube_publication_unconfirmed/);
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
        .state,
      "reconcile",
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・approvedJob・json・fakeYoutube・run） */
export function runSnsYoutubeAdapterScenes2(env) {
  ({ first, approvedJob, json, fakeYoutube, run } = env);
  scene1();
}

function scene2() {
  test("BOA-1164 照合（lookup）: 自分の非公開は owned・found、削除済み（items が空）は found=false、items の無い応答は投げる", async () => {
    const job = {
      external_post_id: "closedvid01",
      snapshot: { youtube_title: "全貌 唐津12R" },
    };
    const own = fakeYoutube({ videoId: "closedvid01" });
    const mine = await createYoutubeQueueAdapter({
      accessToken: "tok",
      fetchImpl: own.fetchImpl,
    }).lookup(job);
    assert.equal(mine.owned, true);
    assert.equal(mine.found, true);
    assert.equal(mine.privacyStatus, "private");
    const gone = await createYoutubeQueueAdapter({
      accessToken: "tok",
      fetchImpl: async () => json({ items: [] }),
    }).lookup(job);
    assert.equal(gone.found, false);
    assert.equal(gone.owned, false);
    await assert.rejects(
      createYoutubeQueueAdapter({
        accessToken: "tok",
        fetchImpl: async () => json({}),
      }).lookup(job),
      /items がありません/,
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・approvedJob・json・fakeYoutube・run） */
export function runSnsYoutubeAdapterScenes3(env) {
  ({ first, approvedJob, json, fakeYoutube, run } = env);
  scene2();
}
