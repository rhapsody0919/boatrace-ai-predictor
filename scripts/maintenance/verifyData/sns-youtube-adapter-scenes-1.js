/**
 * verify-sns-youtube-adapter.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-youtube-adapter.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileYoutubeJob } from "../../../api/_lib/snsDeadlineQueue.js";
import { createYoutubeQueueAdapter } from "../../../api/_lib/youtubeQueueAdapter.js";

let first, store, approvedJob, json, fakeYoutube, run;

// 送った multipart の metadata（1つ目のパート）を取り出す
async function uploadedMetadata(call) {
  const text = await new Response(call.options.body).text();
  return JSON.parse(text.split("\r\n\r\n")[1].split("\r\n")[0]);
}

function scene1() {
  test("BOA-1172: thumbnails.set の前の検査・台帳への記録が落ちたら、サムネイルを呼ばず今までどおり非公開のまま残す（止める判断は続けない）", async () => {
    // 送る前の検査は queue の1回・videos.insert の前・thumbnails.set の前の順。3回目で落とす
    const checkJob = await approvedJob();
    const checkFake = fakeYoutube();
    let checks = 0;
    const reasons = [];
    await assert.rejects(
      run(checkJob, checkFake, {
        preflight: async () => {
          if (++checks === 3) throw new Error("source_changed");
        },
        onThumbnailFailed: (reason) => reasons.push(reason),
      }),
      /source_changed/,
    );
    // 台帳が拒否した（クォータ・停止など）
    const ledgerJob = await approvedJob();
    const ledgerFake = fakeYoutube();
    await assert.rejects(
      run(ledgerJob, ledgerFake, {
        store: {
          transition: (id, action, result) =>
            action === "youtube_call" && result?.method === "thumbnails.set"
              ? Promise.reject(new Error("youtube_quota_limit"))
              : store.transition(id, action, result),
        },
        onThumbnailFailed: (reason) => reasons.push(reason),
      }),
      /youtube_quota_limit/,
    );
    assert.deepEqual(reasons, [], "サムネイルの失敗としては記録しない");
    for (const [job, fake] of [
      [checkJob, checkFake],
      [ledgerJob, ledgerFake],
    ]) {
      assert.deepEqual(
        await first(
          "SELECT state, youtube_stage FROM sns_x_send_jobs WHERE id=$1",
          [job.id],
        ),
        { state: "reconcile", youtube_stage: "private_retained" },
      );
      assert.equal(
        fake.calls.some((c) => c.path === "/upload/youtube/v3/thumbnails/set"),
        false,
        "thumbnails.set を呼ばない",
      );
      assert.equal(
        fake.calls.some((c) => c.options.method === "PUT"),
        false,
      );
    }
  });
  test("本人の動画と確かめられない（processingDetails が無い・題名が承認と違う）ときは公開しない", async () => {
    for (const options of [{ ownVideo: false }, { title: "別の題名" }]) {
      const job = await approvedJob({ withCover: false });
      const fake = fakeYoutube(options);
      await assert.rejects(run(job, fake), /youtube_processing_unconfirmed/);
      assert.equal(
        fake.calls.some((c) => c.options.method === "PUT"),
        false,
      );
      assert.equal(
        (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
          .state,
        "reconcile",
      );
    }
  });
}

function scene2() {
  test("照合（lookup）: 公開済みなら complete、まだ非公開なら要照合のまま", async () => {
    const job = await approvedJob({ withCover: false });
    const slow = fakeYoutube({
      processing: "processing",
      videoId: "lookupvid01",
    });
    const waiting = await run(job, slow);
    assert.equal(waiting.state, "reconcile");
    const privateResult = await reconcileYoutubeJob(waiting, {
      store,
      lookup: createYoutubeQueueAdapter({
        accessToken: "tok",
        fetchImpl: slow.fetchImpl,
      }).lookup,
    });
    assert.equal(privateResult.state, "reconcile");

    const published = fakeYoutube({ videoId: "lookupvid01" });
    await published.fetchImpl(
      "https://www.googleapis.com/youtube/v3/videos?part=status",
      {
        method: "PUT",
        body: JSON.stringify({
          id: "abcdefghijk",
          status: { privacyStatus: "public" },
        }),
      },
    );
    const reconciled = await reconcileYoutubeJob(waiting, {
      store,
      lookup: createYoutubeQueueAdapter({
        accessToken: "tok",
        fetchImpl: published.fetchImpl,
      }).lookup,
    });
    assert.equal(reconciled.state, "posted");
  });
  test("非公開以外での upload・予約公開・トークン無しは受け付けない", async () => {
    const youtube = createYoutubeQueueAdapter({
      accessToken: "tok",
      fetchImpl: async () => assert.fail("呼ばない"),
    });
    await assert.rejects(
      youtube.upload({
        snapshot: {},
        media: [],
        privacyStatus: "public",
        publishAt: null,
      }),
      /非公開でだけ/,
    );
    await assert.rejects(
      youtube.makePublic({
        job: {},
        privacyStatus: "public",
        publishAt: "2026-10-14T00:00:00Z",
      }),
      /即時だけ/,
    );
    assert.throws(
      () => createYoutubeQueueAdapter({}),
      /access token がありません/,
    );
  });
  test("題名が YouTube の決まりに合わないときは begin_post の前に held にし、何も呼ばない", async () => {
    for (const title of ["あ".repeat(101), "<告知>"]) {
      const job = await approvedJob({ withCover: false, title });
      const fake = fakeYoutube();
      await assert.rejects(run(job, fake));
      assert.equal(fake.calls.length, 0);
      assert.equal(
        (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
          .state,
        "held",
      );
    }
  });
}

function scene3() {
  test("videos.update の失敗は update_started の要照合に残し、公開の確認で private が返れば公開済みと扱わない", async () => {
    const job = await approvedJob({ withCover: false });
    const base = fakeYoutube();
    const failingUpdate = {
      calls: base.calls,
      fetchImpl: async (url, options = {}) =>
        options.method === "PUT"
          ? (base.calls.push({
              method: "PUT",
              path: new URL(url).pathname,
              options,
            }),
            json({ error: { errors: [{ reason: "backendError" }] } }, 500))
          : base.fetchImpl(url, options),
    };
    await assert.rejects(run(job, failingUpdate), /HTTP 500 backendError/);
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

    const stillPrivate = await approvedJob({ withCover: false });
    const base2 = fakeYoutube();
    const ignoresUpdate = {
      calls: base2.calls,
      fetchImpl: async (url, options = {}) =>
        options.method === "PUT"
          ? json({ id: "ignored" })
          : base2.fetchImpl(url, options),
    };
    await assert.rejects(
      run(stillPrivate, ignoresUpdate),
      /youtube_publication_unconfirmed/,
    );
    assert.equal(
      (
        await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [
          stillPrivate.id,
        ])
      ).state,
      "reconcile",
    );
  });
  test("動画 ID の無い job の照合は YouTube を呼ばず要照合のまま", async () => {
    const youtube = createYoutubeQueueAdapter({
      accessToken: "tok",
      fetchImpl: async () => assert.fail("呼ばない"),
    });
    assert.equal(
      (await youtube.lookup({ external_post_id: null })).confirmed,
      false,
    );
  });
  test("承認したタグと本文を YouTube に送る（承認の hash に入る値と同じ）", async () => {
    const job = await approvedJob({
      withCover: false,
      hashtags: ["#ボートレース", "#唐津", "#ボートレース", ""],
    });
    const fake = fakeYoutube();
    await run(job, fake);
    const meta = await uploadedMetadata(fake.calls[0]);
    const approved = JSON.parse(job.snapshot_text);
    assert.equal(meta.snippet.description, approved.text);
    assert.equal(
      meta.snippet.description,
      "説明\n\n#ボートレース #唐津 #ボートレース",
    );
    assert.deepEqual(meta.snippet.tags, ["ボートレース", "唐津"]);
    assert.deepEqual(approved.source.hashtags, [
      "#ボートレース",
      "#唐津",
      "#ボートレース",
      "",
    ]);
    // タグの無い下書きは空の配列
    const plain = await approvedJob({ withCover: false });
    const fake2 = fakeYoutube();
    await run(plain, fake2);
    assert.deepEqual((await uploadedMetadata(fake2.calls[0])).snippet.tags, []);
  });
  test("表紙が JPEG なら Content-Type は image/jpeg", async () => {
    const job = await approvedJob({ cover: "c.jpg" });
    const fake = fakeYoutube();
    assert.equal((await run(job, fake)).state, "posted");
    assert.equal(fake.calls[1].options.headers["Content-Type"], "image/jpeg");
  });
}

function scene4() {
  test("題名は100文字（絵文字などの補助文字も1文字）までは通る", async () => {
    for (const title of ["あ".repeat(100), "🚤".repeat(100)]) {
      const job = await approvedJob({ withCover: false, title });
      assert.equal((await run(job, fakeYoutube({ title }))).state, "posted");
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（first・store・approvedJob・json・fakeYoutube・run） */
export function runSnsYoutubeAdapterScenes1(env) {
  ({ first, store, approvedJob, json, fakeYoutube, run } = env);
  scene1();
  scene2();
  scene3();
  scene4();
}
