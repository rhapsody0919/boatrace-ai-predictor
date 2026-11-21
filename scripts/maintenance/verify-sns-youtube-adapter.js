// YouTube Data API v3 の実 adapter（sns-pdca-loop tasks 18）の再現テスト。
// runYoutubeQueueJob・reconcileYoutubeJob に実 adapter をつなぎ、SQL146 までを PGlite で動かす。fetch はモックで外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot, sha256 } from "../../api/_lib/snsXSend.js";
import { deadlineSchedule, runYoutubeQueueJob } from "../../api/_lib/snsDeadlineQueue.js";
import {
  createYoutubeQueueAdapter,
  THUMBNAIL_TIMEOUT_MS,
} from "../../api/_lib/youtubeQueueAdapter.js";
import { runSnsYoutubeAdapterScenes1 } from "./verifyData/sns-youtube-adapter-scenes-1.js";
import { runSnsYoutubeAdapterScenes2, runSnsYoutubeAdapterScenes3 } from "./verifyData/sns-youtube-adapter-scenes-2.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const video = new Uint8Array([1, 2, 3, 4]);
const cover = new Uint8Array([9, 9]);
const loadMedia = async (path) =>
  path.endsWith(".png") || path.endsWith(".jpg") ? cover : video;
const store = {
  transition: async (id, action, result = {}) =>
    (
      await first("SELECT transition_sns_x_send($1,$2,$3) r", [
        id,
        action,
        result,
      ])
    ).r,
};
let me;
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const file of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + file, import.meta.url),
        "utf8",
      ),
    );
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});
beforeEach(async () => {
  await db.exec(
    "DELETE FROM sns_youtube_quota_reads; DELETE FROM sns_youtube_quota_attempts; DELETE FROM sns_x_send_jobs; DELETE FROM sns_drafts",
  );
  await db.exec(
    "UPDATE sns_x_send_control SET paused=false,timing_approved=true,daily_limit=1000,daily_baseline_date=(now() AT TIME ZONE 'Asia/Tokyo')::date,daily_external_count=0,max_source_age_seconds=3600,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=1,reserved_microusd=0",
  );
  await db.exec(
    "UPDATE sns_youtube_quota_control SET verified=true,baseline_day=(now() AT TIME ZONE 'America/Los_Angeles')::date,upload_limit=100,general_limit=10000,external_uploads=0,external_general=0",
  );
});
after(() => db.close());

async function approvedJob({
  withCover = true,
  title = "全貌 唐津12R",
  hashtags = null,
  cover = "c.png",
} = {}) {
  const deadline_at = new Date(Date.now() + 7200000).toISOString();
  const queue = {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    youtube_mode: "immediate",
    source_revision: "v1",
    source_observed_at: new Date().toISOString(),
  };
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,hashtags,video_storage_path,cover_image_path,source_data) VALUES(gen_random_uuid(),'short','youtube','ja',$3,'説明',$4,'v.mp4',$1,$2) RETURNING *",
    [withCover ? cover : null, { deadline_queue: queue }, title, hashtags],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,now()) r", [
      d.id,
      me,
      await createXSnapshot(d, loadMedia),
    ])
  ).r;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
let videoSeq = 0;
// YouTube のふりをする fetch。動画の状態を持ち、呼ばれた順に記録する
function fakeYoutube({
  title = "全貌 唐津12R",
  processing = "succeeded",
  thumbnailStatus = 200,
  ownVideo = true,
  publishedAt = "2026-10-13T03:01:00Z",
  // 同じテストの中で複数の job を作るので、動画 ID は呼び出しごとに変える（external_post_id は一意）
  videoId = `vid${String(++videoSeq).padStart(8, "0")}`,
} = {}) {
  const calls = [];
  let privacy = "private";
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    calls.push({
      method: options.method || "GET",
      path: u.pathname,
      search: u.search,
      options,
    });
    if (u.pathname === "/upload/youtube/v3/videos")
      return json({ id: videoId });
    if (u.pathname === "/upload/youtube/v3/thumbnails/set")
      return thumbnailStatus === 200
        ? json({ items: [] })
        : json(
            {
              error: {
                errors: [{ reason: "forbidden" }],
                message: "secret detail",
              },
            },
            thumbnailStatus,
          );
    if (
      u.pathname === "/youtube/v3/videos" &&
      (options.method || "GET") === "PUT"
    ) {
      privacy = JSON.parse(options.body).status.privacyStatus;
      return json({ id: videoId });
    }
    if (u.pathname === "/youtube/v3/videos")
      return json({
        items: [
          {
            id: videoId,
            status: { privacyStatus: privacy },
            snippet: {
              title,
              publishedAt:
                privacy === "public" ? publishedAt : "2026-10-13T02:00:00Z",
            },
            ...(ownVideo
              ? { processingDetails: { processingStatus: processing } }
              : {}),
          },
        ],
      });
    throw new Error("想定外: " + url);
  };
  return { calls, fetchImpl };
}
const run = (job, fake, extra = {}) =>
  runYoutubeQueueJob(job.id, {
    store,
    youtube: createYoutubeQueueAdapter({
      accessToken: "tok",
      fetchImpl: fake.fetchImpl,
    }),
    loadMedia,
    preflight: async () => {},
    ...extra,
  });

test("非公開で上げ、サムネイル、処理の確認、公開、公開の確認の順で呼び、posted になる", async () => {
  const job = await approvedJob();
  const fake = fakeYoutube({ videoId: "abcdefghijk" });
  const done = await run(job, fake);
  assert.equal(done.state, "posted");
  assert.equal(done.external_post_id, "abcdefghijk");
  assert.equal(
    new Date(done.posted_at).toISOString(),
    "2026-10-13T03:01:00.000Z",
  );
  assert.deepEqual(
    fake.calls.map((c) => `${c.method} ${c.path}`),
    [
      "POST /upload/youtube/v3/videos",
      "POST /upload/youtube/v3/thumbnails/set",
      "GET /youtube/v3/videos",
      "PUT /youtube/v3/videos",
      "GET /youtube/v3/videos",
    ],
  );
  // upload は非公開・子供向けではない、本文は multipart
  const uploadBody = await new Response(fake.calls[0].options.body).text();
  assert.match(uploadBody, /"privacyStatus":"private"/);
  assert.match(uploadBody, /"selfDeclaredMadeForKids":false/);
  assert.match(uploadBody, /"title":"全貌 唐津12R"/);
  assert.match(
    fake.calls[0].options.headers["Content-Type"],
    /^multipart\/related; boundary=/,
  );
  // サムネイルの Content-Type は媒体（png）に合わせる
  assert.equal(fake.calls[1].options.headers["Content-Type"], "image/png");
  assert.match(fake.calls[1].search, /videoId=abcdefghijk/);
  assert.deepEqual(JSON.parse(fake.calls[3].options.body), {
    id: "abcdefghijk",
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  });
  assert.ok(
    fake.calls.every((c) => c.options.headers.Authorization === "Bearer tok"),
  );
  // クォータの台帳には呼び出しの前に記録されている
  const ledger = await first(
    "SELECT calls, processing_polls FROM sns_youtube_quota_attempts WHERE job_id=$1",
    [job.id],
  );
  assert.deepEqual(ledger.calls, [
    "videos.insert",
    "thumbnails.set",
    "videos.update",
    "videos.list",
  ]);
  assert.equal(ledger.processing_polls, 1);
});

test("処理中なら公開せず要照合のまま、サムネイルの 403 は記録する先（onThumbnailFailed）が無い呼び出しなら公開せず非公開のまま残す", async () => {
  const processingJob = await approvedJob();
  const slow = fakeYoutube({ processing: "processing" });
  const waiting = await run(processingJob, slow);
  assert.equal(waiting.state, "reconcile");
  assert.equal(
    slow.calls.some((c) => c.options.method === "PUT"),
    false,
  );

  const thumbJob = await approvedJob();
  const forbidden = fakeYoutube({ thumbnailStatus: 403 });
  await assert.rejects(run(thumbJob, forbidden), (error) => {
    assert.match(error.message, /HTTP 403 forbidden/);
    assert.ok(!error.message.includes("secret detail"));
    return true;
  });
  const row = await first(
    "SELECT state, youtube_stage FROM sns_x_send_jobs WHERE id=$1",
    [thumbJob.id],
  );
  assert.deepEqual(row, {
    state: "reconcile",
    youtube_stage: "private_retained",
  });
  assert.equal(
    forbidden.calls.some((c) => c.options.method === "PUT"),
    false,
  );
});

// BOA-1172: サムネイルが付かなくても動画の公開は止めず、理由を記録する
test("BOA-1172: サムネイルの 403・通信の例外でも動画は公開まで進み、理由を onThumbnailFailed に渡す（API の本文は入れない）", async () => {
  const throwing = (fake) => ({
    ...fake,
    fetchImpl: async (url, options) => {
      if (new URL(url).pathname === "/upload/youtube/v3/thumbnails/set") {
        fake.calls.push({ method: "POST", path: "thumb", options });
        throw new TypeError("fetch failed");
      }
      return fake.fetchImpl(url, options);
    },
  });
  for (const [label, makeFake, expected] of [
    ["403", () => fakeYoutube({ thumbnailStatus: 403 }), /HTTP 403 forbidden/],
    ["通信の例外", () => throwing(fakeYoutube()), /fetch failed/],
  ]) {
    const job = await approvedJob();
    const fake = makeFake();
    const reasons = [];
    const done = await run(job, fake, {
      onThumbnailFailed: (reason) => reasons.push(reason),
    });
    assert.equal(done.state, "posted", label);
    assert.equal(reasons.length, 1, label);
    assert.match(reasons[0], expected, label);
    assert.ok(!reasons[0].includes("secret detail"), label);
    assert.equal(
      fake.calls.filter((c) => c.options.method === "PUT").length,
      1,
      `${label}: 公開の videos.update を呼ぶ`,
    );
    // 台帳には thumbnails.set の前の記録が残る（50単位を数えたまま。再試行しない）
    assert.deepEqual(
      (
        await first(
          "SELECT calls FROM sns_youtube_quota_attempts WHERE job_id=$1",
          [job.id],
        )
      ).calls,
      ["videos.insert", "thumbnails.set", "videos.update", "videos.list"],
      label,
    );
  }
});

test("BOA-1172: thumbnails.set の待ちは30秒（ほかの呼び出しは120秒）。失敗しても公開に進むので、公開の段が関数の上限に近づかない（審査 P3）", async (t) => {
  const timeouts = [];
  const original = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    timeouts.push(ms);
    return original.call(AbortSignal, ms);
  });
  const job = await approvedJob();
  const fake = fakeYoutube();
  const seen = [];
  const done = await run(job, {
    ...fake,
    fetchImpl: async (url, options) => {
      seen.push([new URL(url).pathname, timeouts.at(-1)]);
      return fake.fetchImpl(url, options);
    },
  });
  assert.equal(done.state, "posted");
  assert.equal(THUMBNAIL_TIMEOUT_MS, 30000);
  const thumb = seen.filter(([p]) => p === "/upload/youtube/v3/thumbnails/set");
  assert.equal(thumb.length, 1);
  assert.equal(thumb[0][1], 30000);
  assert.ok(
    seen
      .filter(([p]) => p !== "/upload/youtube/v3/thumbnails/set")
      .every(([, ms]) => ms === 120000),
  );
});

// ---- 後半の場面（verifyData/sns-youtube-adapter-scenes-1.js・sns-youtube-adapter-scenes-2.js） ----
runSnsYoutubeAdapterScenes1({ first, store, approvedJob, json, fakeYoutube, run });
runSnsYoutubeAdapterScenes2({ first, approvedJob, json, fakeYoutube, run });

test("32 MiB を超える動画は begin_post の前に held にし、何も呼ばない", async () => {
  const big = new Uint8Array(32 * 1024 * 1024 + 1);
  const job = await (async () => {
    const deadline_at = new Date(Date.now() + 7200000).toISOString();
    const d = await first(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,source_data) VALUES(gen_random_uuid(),'short','youtube','ja','全貌','説明','big.mp4',$1) RETURNING *",
      [
        {
          deadline_queue: {
            deadline_at,
            ...deadlineSchedule(deadline_at),
            youtube_mode: "immediate",
            source_revision: "v1",
            source_observed_at: new Date().toISOString(),
          },
        },
      ],
    );
    // 承認の createXSnapshot は 32 MiB で止める。SQL の外枠（500 MiB）だけを通った承認を想定して、
    // 小さい動画で作った snapshot の媒体を大きい動画に差し替えて承認する
    await assert.rejects(
      createXSnapshot(d, async () => big),
      /媒体の容量/,
    );
    const small = await createXSnapshot(d, async () => new Uint8Array(1024));
    const snapshot = {
      ...small,
      media: [
        { ...small.media[0], size: big.byteLength, sha256: await sha256(big) },
      ],
    };
    return (
      await first("SELECT approve_sns_x_send($1,$2,$3,now()) r", [
        d.id,
        me,
        snapshot,
      ])
    ).r;
  })();
  const fake = fakeYoutube();
  await assert.rejects(
    runYoutubeQueueJob(job.id, {
      store,
      youtube: createYoutubeQueueAdapter({
        accessToken: "tok",
        fetchImpl: fake.fetchImpl,
      }),
      loadMedia: async () => big,
      preflight: async () => {},
    }),
    /youtube_video_too_large/,
  );
  assert.equal(fake.calls.length, 0);
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
      .state,
    "held",
  );
});

// ---- 後半の場面（verifyData/sns-youtube-adapter-scenes-2.js） ----
runSnsYoutubeAdapterScenes3({ first, approvedJob, json, fakeYoutube, run });
