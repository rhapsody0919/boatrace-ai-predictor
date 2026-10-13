// X API v2 の実 adapter（sns-pdca-loop tasks 17）の再現テスト。fetch はモックで、外部への投稿はしない。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  createXApiAdapter,
  postedAtFromId,
} from "../../api/_lib/xApiAdapter.js";
import {
  createXSnapshot,
  runXSendJob,
  X_CHUNK_BYTES,
} from "../../api/_lib/snsXSend.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// X API のふりをする fetch。呼ばれた順に記録する
function fakeX({
  processing = ["in_progress", "succeeded"],
  postStatus = 201,
  postId = "1845678901234567890",
} = {}) {
  const calls = [];
  let polls = 0;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    calls.push({
      method: options.method || "GET",
      path: u.pathname + u.search,
      options,
    });
    if (u.pathname === "/2/media/upload/initialize")
      return json({
        data: { id: "m1", media_key: "7_m1", expires_after_secs: 86400 },
      });
    if (/\/append$/.test(u.pathname)) return new Response(null, { status: 204 });
    if (/\/finalize$/.test(u.pathname) || u.pathname === "/2/media/upload")
      return json({
        data: {
          id: "m1",
          processing_info: {
            state: processing[Math.min(polls++, processing.length - 1)],
            check_after_secs: 1,
          },
        },
      });
    if (u.pathname === "/2/tweets")
      return postStatus === 201
        ? json({ data: { id: postId, text: "x" } }, 201)
        : json(
            { title: "Too Many Requests", detail: "secret detail" },
            postStatus,
          );
    throw new Error("想定外: " + url);
  };
  return { calls, fetchImpl };
}

test("posted_at は投稿 ID の snowflake から求める", () => {
  // 2026-10-13T03:00:00.000Z に作られた ID を組み立てて戻す
  const ms = BigInt(Date.parse("2026-10-13T03:00:00.000Z")) - 1288834974657n;
  const id = String((ms << 22n) | 12345n);
  assert.equal(postedAtFromId(id), "2026-10-13T03:00:00.000Z");
  assert.throws(() => postedAtFromId("abc"), /不正/);
});

test("媒体の分割アップロードと投稿: エンドポイント・本文の形・トークンは1回だけ取る", async () => {
  const { calls, fetchImpl } = fakeX();
  let tokenCalls = 0;
  const x = createXApiAdapter({
    fetchImpl,
    getAccessToken: async () => {
      tokenCalls++;
      return { accessToken: "tok" };
    },
  });
  const upload = await x.initialize({
    size: 6 * 1024 * 1024,
    type: "video/mp4",
    category: "tweet_video",
  });
  assert.deepEqual(upload, { id: "m1" });
  await x.append({ id: "m1", index: 0, bytes: new Uint8Array(5) });
  const fin = await x.finalize("m1");
  assert.equal(fin.processing_info.state, "in_progress");
  const st = await x.status("m1");
  assert.equal(st.processing_info.state, "succeeded");
  const post = await x.createPost({
    text: "本文",
    mediaIds: ["m1"],
    replyTo: "1800000000000000000",
  });
  assert.equal(post.id, "1845678901234567890");
  assert.equal(post.posted_at, postedAtFromId("1845678901234567890"));
  assert.equal(tokenCalls, 1);

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.path}`),
    [
      "POST /2/media/upload/initialize",
      "POST /2/media/upload/m1/append",
      "POST /2/media/upload/m1/finalize",
      "GET /2/media/upload?command=STATUS&media_id=m1",
      "POST /2/tweets",
    ],
  );
  assert.ok(
    calls.every((c) => c.options.headers.Authorization === "Bearer tok"),
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    media_type: "video/mp4",
    total_bytes: 6 * 1024 * 1024,
    media_category: "tweet_video",
  });
  const form = calls[1].options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("segment_index"), "0");
  assert.equal((await form.get("media").arrayBuffer()).byteLength, 5);
  assert.deepEqual(JSON.parse(calls[4].options.body), {
    text: "本文",
    media: { media_ids: ["m1"] },
    reply: { in_reply_to_tweet_id: "1800000000000000000" },
  });
  // 媒体も返信先も無い投稿は本文だけを送る
  await x.createPost({ text: "だけ" });
  assert.deepEqual(JSON.parse(calls[5].options.body), { text: "だけ" });
});

test("投稿の失敗は1回だけ呼んで投げ、X の詳細な本文はエラーに入れない", async () => {
  const { calls, fetchImpl } = fakeX({ postStatus: 429 });
  const x = createXApiAdapter({
    fetchImpl,
    getAccessToken: async () => ({ accessToken: "tok" }),
  });
  await assert.rejects(x.createPost({ text: "本文" }), (error) => {
    assert.match(error.message, /HTTP 429 Too Many Requests/);
    assert.ok(!error.message.includes("secret detail"));
    return true;
  });
  assert.equal(calls.filter((c) => c.path === "/2/tweets").length, 1);
});

// runXSendJob（既存の送信の手順）に実 adapter をつないで、承認から posted まで通す（SQL137 を PGlite で）
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const name of [
    "035_sns_marketing_hub_schema.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + name, import.meta.url),
        "utf8",
      ),
    );
  await db.exec(
    "UPDATE sns_x_send_control SET paused=false,period_start=date_trunc('month',now()),period_end=date_trunc('month',now())+interval '1 month',attempt_ceiling_microusd=300000,reserved_microusd=0",
  );
});
after(() => db.close());

test("runXSendJob に実 adapter をつなぐと、6MB の動画は2つに分けて送り、posted になる", async () => {
  const me = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const bytes = new Uint8Array(6 * 1024 * 1024).fill(7);
  const loadMedia = async () => bytes;
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,video_storage_path) VALUES(gen_random_uuid(),'short','x','ja','全貌','v.mp4') RETURNING *",
  );
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3) r", [
      draft.id,
      me,
      await createXSnapshot(draft, loadMedia),
    ])
  ).r;
  const { calls, fetchImpl } = fakeX();
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
  const done = await runXSendJob(job.id, {
    store,
    x: createXApiAdapter({
      fetchImpl,
      getAccessToken: async () => ({ accessToken: "tok" }),
    }),
    loadMedia,
    wait: async () => {},
    preflight: async () => {},
  });
  assert.equal(done.state, "posted");
  assert.equal(done.external_post_id, "1845678901234567890");
  assert.equal(
    new Date(done.posted_at).toISOString(),
    postedAtFromId("1845678901234567890"),
  );
  assert.equal(
    calls.filter((c) => /\/append$/.test(c.path)).length,
    Math.ceil(bytes.byteLength / X_CHUNK_BYTES),
  );
  assert.equal(calls.filter((c) => c.path === "/2/tweets").length, 1);
});
