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
    if (/\/append$/.test(u.pathname))
      return new Response(null, { status: 204 });
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

test("媒体の分割アップロードと投稿: エンドポイント・本文の形・渡したトークンで呼ぶ、トークンが無ければ作らない", async () => {
  const { calls, fetchImpl } = fakeX();
  const x = createXApiAdapter({ fetchImpl, accessToken: "tok" });
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
  assert.throws(
    () => createXApiAdapter({ fetchImpl }),
    /access token がありません/,
  );
  // 媒体も返信先も無い投稿は本文だけを送る
  await x.createPost({ text: "だけ" });
  assert.deepEqual(JSON.parse(calls[5].options.body), { text: "だけ" });
});

test("投稿の失敗は1回だけ呼んで投げ、X の詳細な本文はエラーに入れない", async () => {
  const { calls, fetchImpl } = fakeX({ postStatus: 429 });
  const x = createXApiAdapter({
    fetchImpl,
    accessToken: "tok",
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
      accessToken: "tok",
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

test("runXSendJob: 媒体の処理が failed・append が失敗したら begin_post に進まず投稿しない", async () => {
  const me = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const bytes = new Uint8Array(1024).fill(3);
  const loadMedia = async () => bytes;
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
  for (const make of [
    () => fakeX({ processing: ["failed"] }),
    () => {
      const base = fakeX();
      return {
        calls: base.calls,
        fetchImpl: async (url, options) =>
          /\/append$/.test(new URL(url).pathname)
            ? (base.calls.push({ path: new URL(url).pathname }),
              json({ title: "Service Unavailable" }, 503))
            : base.fetchImpl(url, options),
      };
    },
  ]) {
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
    const { calls, fetchImpl } = make();
    await assert.rejects(
      runXSendJob(job.id, {
        store,
        x: createXApiAdapter({ fetchImpl, accessToken: "tok" }),
        loadMedia,
        wait: async () => {},
        preflight: async () => {},
      }),
    );
    assert.equal(calls.filter((c) => c.path === "/2/tweets").length, 0);
    // 投稿の前に止まる（begin_post に進まない）。この DB は 137 だけなので hold が無く、held ではなく sending のまま残る
    // （139 以降は hold で held になる。verify-sns-deadline-queue が確かめている）
    assert.equal(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
        .state,
      "sending",
    );
  }
});

test("成功の応答を解釈できないときは理由つきで投げる（再送しない）", async () => {
  const x = createXApiAdapter({
    accessToken: "tok",
    fetchImpl: async () => new Response("<html>", { status: 201 }),
  });
  await assert.rejects(
    x.createPost({ text: "本文" }),
    /応答を解釈できません: HTTP 201/,
  );
});

// 媒体の処理の応答が欠けたときに投稿へ進まない（開発の補助の点検 D1、2026-10-13）
async function sendWith(fetchImpl, { path = "v.mp4", waits = [] } = {}) {
  // 保留になった試行の予約は戻らないので、試行ごとに月の予約を空にする（このテストは費用の上限を見ない）
  await first(
    "UPDATE sns_x_send_control SET reserved_microusd=0 WHERE id=true RETURNING id",
  );
  const me = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const media = new Uint8Array(1024).fill(5);
  const loadMedia = async () => media;
  const draft = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,video_storage_path,cover_image_path) VALUES(gen_random_uuid(),'short','x','ja','全貌',$1,$2) RETURNING *",
    path.endsWith(".mp4") ? [path, null] : [null, path],
  );
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3) r", [
      draft.id,
      me,
      await createXSnapshot(draft, loadMedia),
    ])
  ).r;
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
  return {
    job,
    run: () =>
      runXSendJob(job.id, {
        store,
        x: createXApiAdapter({ fetchImpl, accessToken: "tok" }),
        loadMedia,
        wait: async (sec) => {
          waits.push(sec);
        },
        preflight: async () => {},
      }),
  };
}
const postIds = (() => {
  let n = 0n;
  return () => String(1900000000000000000n + ++n);
})();
function mediaFake({ finalize, status }) {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + u.search);
    if (u.pathname === "/2/media/upload/initialize")
      return json({ data: { id: "m1" } });
    if (/\/append$/.test(u.pathname))
      return new Response(null, { status: 204 });
    if (/\/finalize$/.test(u.pathname)) return finalize();
    if (u.pathname === "/2/media/upload") return status();
    if (u.pathname === "/2/tweets")
      return json({ data: { id: postIds() } }, 201);
    throw new Error("想定外: " + url);
  };
  return { calls, fetchImpl };
}

test("媒体の処理中に STATUS の応答が欠けたら（{}・空本文・null）、投稿へ進まない", async () => {
  for (const missing of [
    () => json({}),
    () => new Response("", { status: 200 }),
    () => json(null),
    () => json({ data: {} }),
  ]) {
    const fake = mediaFake({
      finalize: () =>
        json({
          data: {
            id: "m1",
            processing_info: { state: "in_progress", check_after_secs: 1 },
          },
        }),
      status: missing,
    });
    const { run, job } = await sendWith(fake.fetchImpl);
    await assert.rejects(run(), /処理状態が読めません/);
    assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
    assert.notEqual(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
        .state,
      "reconcile",
    );
  }
});

test("finalize の応答に data が無ければ投稿へ進まない", async () => {
  const fake = mediaFake({
    finalize: () => json({}),
    status: () => assert.fail("呼ばない"),
  });
  const { run } = await sendWith(fake.fetchImpl);
  await assert.rejects(run(), /finalize の応答に data がありません/);
  assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
});

test("動画は finalize で processing_info が省略されても STATUS で完了を確かめてから投稿し、画像は省略で完了", async () => {
  const video = mediaFake({
    finalize: () => json({ data: { id: "m1" } }),
    status: () =>
      json({ data: { id: "m1", processing_info: { state: "succeeded" } } }),
  });
  const v = await sendWith(video.fetchImpl);
  assert.equal((await v.run()).state, "posted");
  assert.deepEqual(video.calls.slice(-2), [
    "/2/media/upload?command=STATUS&media_id=m1",
    "/2/tweets",
  ]);

  const image = mediaFake({
    finalize: () => json({ data: { id: "m1" } }),
    status: () => assert.fail("呼ばない"),
  });
  const i = await sendWith(image.fetchImpl, { path: "c.png" });
  assert.equal((await i.run()).state, "posted");
  assert.equal(
    image.calls.some((c) => c.startsWith("/2/media/upload?command=STATUS")),
    false,
  );
});

test("finalize: processing_info のキーが無いときだけ省略とみなし、null・false・0・空文字・状態の無い値は投稿の前に止める", async () => {
  for (const info of [
    null,
    false,
    0,
    "",
    {},
    { state: "" },
    { state: 5 },
    [],
    "succeeded",
  ]) {
    for (const path of ["c.png", "v.mp4"]) {
      const fake = mediaFake({
        finalize: () => json({ data: { id: "m1", processing_info: info } }),
        status: () =>
          json({ data: { id: "m1", processing_info: { state: "succeeded" } } }),
      });
      const { run, job } = await sendWith(fake.fetchImpl, { path });
      await assert.rejects(
        run(),
        /finalize の processing_info が不正です/,
        `${JSON.stringify(info)} ${path}`,
      );
      assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
      assert.notEqual(
        (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
          .state,
        "reconcile",
      );
    }
  }
});

test("finalize・STATUS: data がオブジェクトでない（文字列・配列・数）ときは投稿の前に止める", async () => {
  for (const data of ["ok", [], 1]) {
    const finalizeBad = mediaFake({
      finalize: () => json({ data }),
      status: () => assert.fail("呼ばない"),
    });
    await assert.rejects(
      (await sendWith(finalizeBad.fetchImpl, { path: "c.png" })).run(),
      /finalize の応答に data がありません/,
    );
    assert.equal(finalizeBad.calls.filter((c) => c === "/2/tweets").length, 0);
    const statusBad = mediaFake({
      finalize: () =>
        json({
          data: {
            id: "m1",
            processing_info: { state: "in_progress", check_after_secs: 1 },
          },
        }),
      status: () => json({ data }),
    });
    await assert.rejects(
      (await sendWith(statusBad.fetchImpl)).run(),
      /処理状態が読めません/,
    );
    assert.equal(statusBad.calls.filter((c) => c === "/2/tweets").length, 0);
  }
});

test("媒体の処理の待ちは 1〜30 秒に収め、check_after_secs が数でなければ投稿の前に止める", async () => {
  const inProgress = (secs) => () =>
    json({
      data: {
        id: "m1",
        processing_info: { state: "in_progress", check_after_secs: secs },
      },
    });
  const done = () =>
    json({ data: { id: "m1", processing_info: { state: "succeeded" } } });
  for (const [secs, expected] of [
    [3600, 30],
    [0, 1],
    [-5, 1],
    [7, 7],
    [undefined, 1],
  ]) {
    const waits = [];
    const fake = mediaFake({ finalize: inProgress(secs), status: done });
    const { run } = await sendWith(fake.fetchImpl, { waits });
    assert.equal((await run()).state, "posted", String(secs));
    assert.deepEqual(waits, [expected], String(secs));
  }
  for (const secs of ["5", null, true, {}]) {
    const fake = mediaFake({ finalize: inProgress(secs), status: done });
    const { run, job } = await sendWith(fake.fetchImpl);
    await assert.rejects(run(), /check_after_secs/, JSON.stringify(secs));
    assert.equal(fake.calls.filter((c) => c === "/2/tweets").length, 0);
    // この DB は 137 だけなので hold が無い（上の説明）。begin_post に進まず要照合にならないことを見る
    assert.notEqual(
      (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
        .state,
      "reconcile",
    );
  }
});
