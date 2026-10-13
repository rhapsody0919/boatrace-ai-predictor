// YouTube Data API v3 の実 adapter（sns-pdca-loop tasks 18）の再現テスト。
// runYoutubeQueueJob・reconcileYoutubeJob に実 adapter をつなぎ、SQL146 までを PGlite で動かす。fetch はモックで外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  deadlineSchedule,
  reconcileYoutubeJob,
  runYoutubeQueueJob,
} from "../../api/_lib/snsDeadlineQueue.js";
import { createYoutubeQueueAdapter } from "../../api/_lib/youtubeQueueAdapter.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const video = new Uint8Array([1, 2, 3, 4]);
const cover = new Uint8Array([9, 9]);
const loadMedia = async (path) => (path.endsWith(".png") ? cover : video);
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

async function approvedJob({ withCover = true } = {}) {
  const deadline_at = new Date(Date.now() + 7200000).toISOString();
  const queue = {
    deadline_at,
    ...deadlineSchedule(deadline_at),
    youtube_mode: "immediate",
    source_revision: "v1",
    source_observed_at: new Date().toISOString(),
  };
  const d = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,video_storage_path,cover_image_path,source_data) VALUES(gen_random_uuid(),'short','youtube','ja','全貌 唐津12R','説明','v.mp4',$1,$2) RETURNING *",
    [withCover ? "c.png" : null, { deadline_queue: queue }],
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

test("処理中なら公開せず要照合のまま、サムネイルの 403 は公開せず非公開のまま残す", async () => {
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
