import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { actionFeedback } from "../../src/pages/admin/sns-hub/actionFeedback.js";

// 固定ダミー設定のみ。実envファイル/ネットワークは一切使用しない。
for (const name of [
  "SUPABASE_SERVICE_KEY",
  "SNS_HUB_BASIC_AUTH_USER",
  "SNS_HUB_BASIC_AUTH_PASSWORD",
  "YOUTUBE_CLIENT_ID",
  "YOUTUBE_CLIENT_SECRET",
  "YOUTUBE_REFRESH_TOKEN",
  "GITHUB_MERGE_TOKEN",
])
  process.env[name] = "mock";
process.env.SUPABASE_URL = "https://mock.invalid";
process.env.SNS_YOUTUBE_ROUTINE_FIRE_URL = "";
process.env.SNS_YOUTUBE_ROUTINE_FIRE_TOKEN = "";
const { default: youtube } =
  await import("../../api/admin/sns-hub/drafts/[id]/publish-youtube.js");
const { default: blog } =
  await import("../../api/admin/sns-hub/drafts/[id]/merge-blog-pr.js");
const { default: approve } =
  await import("../../api/admin/sns-hub/drafts/[id]/approve.js");
const { default: redo } =
  await import("../../api/admin/sns-hub/drafts/[id]/redo.js");
const { default: preview } =
  await import("../../api/admin/sns-hub/drafts/[id]/blog-pr-preview.js");
const { default: archiveDraft } =
  await import("../../api/admin/sns-hub/drafts/[id]/archive.js");
const { default: markPosted } =
  await import("../../api/admin/sns-hub/drafts/[id]/mark-posted.js");
const id = "00000000-0000-4000-8000-000000000001";
const approverId = "00000000-0000-4000-8000-000000000002";
const headSha = "a".repeat(40);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
function request(action, body = {}, auth = true) {
  return new Request(
    `https://local.invalid/api/admin/sns-hub/drafts/${id}/${action}`,
    {
      method: action === "blog-pr-preview" ? "GET" : "POST",
      headers: auth
        ? {
            authorization: `Basic ${btoa("mock:mock")}`,
            "Content-Type": "application/json",
          }
        : {},
      ...(action !== "blog-pr-preview" && {
        body: JSON.stringify({ approverId, ...body }),
      }),
    },
  );
}
let sharedDb;
after(async () => {
  if (sharedDb) await sharedDb.close();
});
async function fixture(platform = "youtube", options = {}) {
  const db = sharedDb || new PGlite();
  if (!sharedDb) {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE sns_drafts(id uuid PRIMARY KEY, platform text, status text, title text, caption_text text,
      hashtags jsonb, video_storage_path text, cover_image_path text, source_data jsonb, pr_url text,
      approver_id uuid, approved_at timestamptz, posted_at timestamptz, archived_at timestamptz, updated_at timestamptz,
      revision_reason_codes jsonb, revision_reason_freetext text, format text, language text);
  `);
    await db.exec(
      await readFile(
        new URL(
          "../../docs/db-migration/138_sns_external_operations.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    sharedDb = db;
  }
  await db.exec("TRUNCATE sns_drafts");
  await db.query(
    `INSERT INTO sns_drafts(id, platform, status, title, caption_text, video_storage_path, source_data, pr_url)
    VALUES ($1,$2,'pending_review','テスト','本文','video.mp4','{}','https://github.com/rhapsody0919/boatrace-ai-predictor/pull/1')`,
    [id, platform],
  );
  if (options.thumbnail)
    await db.query("UPDATE sns_drafts SET cover_image_path='video.mp4'");
  let uploads = 0,
    merges = 0,
    ready = 0;
  let injected = false;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    if (
      u.hostname === "mock.invalid" &&
      u.pathname.startsWith("/rest/v1/rpc/")
    ) {
      const name = u.pathname.split("/").at(-1);
      if (options.failRpc === name && !injected) {
        injected = true;
        return json({}, 500);
      }
      const args = Object.values(JSON.parse(init.body));
      const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
      try {
        const result = await db.query(
          `SELECT ${name}(${placeholders}) AS data`,
          args,
        );
        if (options.loseClaimResponse && name === "sns_claim_external")
          throw new Error("mock response lost");
        return json(result.rows[0].data);
      } catch (error) {
        if (options.loseClaimResponse && name === "sns_claim_external")
          throw error;
        return json({ error: error.message }, 409);
      }
    }
    if (u.hostname === "mock.invalid" && u.pathname === "/rest/v1/sns_drafts") {
      if (init.method === "PATCH") {
        const patch = JSON.parse(init.body);
        const entries = Object.entries(patch);
        const values = entries.map(([, value]) =>
          typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : value,
        );
        let condition = "";
        const externalFilter = u.searchParams.get("or");
        if (externalFilter) {
          assert.equal(
            externalFilter,
            "(external_operation_state.is.null,external_operation_state.eq.done)",
          );
          condition +=
            " AND (external_operation_state IS NULL OR external_operation_state='done')";
        }
        const status = u.searchParams.get("status");
        if (status) condition += ` AND status='${status.slice(3)}'`;
        const result = await db.query(
          `UPDATE sns_drafts SET ${entries.map(([key], i) => `${key}=$${i + 1}`).join(",")}
          WHERE id='${id}'${condition} RETURNING to_jsonb(sns_drafts) AS data`,
          values,
        );
        return json(result.rows.map((row) => row.data));
      }
      const result = await db.query(
        "SELECT to_jsonb(sns_drafts) AS data FROM sns_drafts WHERE id=$1",
        [id],
      );
      return json(result.rows.map((row) => row.data));
    }
    if (u.hostname === "mock.invalid" && u.pathname.startsWith("/storage/"))
      return json([{ path: "video.mp4", signedURL: "/video" }]);
    if (u.hostname === "mock.invalid" && u.pathname.endsWith("/video"))
      return new Response("video");
    if (u.hostname === "oauth2.googleapis.com")
      return json({ access_token: "mock" });
    if (
      u.hostname === "www.googleapis.com" &&
      u.pathname.endsWith("/thumbnails/set")
    ) {
      if (options.thumbnailGate) await options.thumbnailGate();
      return json({}, options.thumbnailSuccess ? 200 : 403);
    }
    if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/videos")) {
      uploads++;
      if (options.uploadTimeout) throw new Error("mock timeout");
      return json({ id: "video-id" });
    }
    if (u.hostname === "api.github.com" && u.pathname.endsWith("/merge")) {
      merges++;
      assert.equal(JSON.parse(init.body).sha, headSha);
      if (options.shaChangedAtMerge)
        return json({ message: "Head changed" }, 409);
      return json({ merged: true, sha: "b".repeat(40) });
    }
    if (u.hostname === "api.github.com" && u.pathname === "/graphql") {
      ready++;
      return json({ data: {} });
    }
    if (u.hostname === "api.github.com")
      return json({
        head: { sha: options.headSha || headSha },
        state: "open",
        draft: true,
        node_id: "node",
      });
    throw new Error(`Unexpected network call: ${u.hostname}${u.pathname}`);
  };
  return {
    db,
    counts: () => ({ uploads, merges, ready }),
    row: async () =>
      (await db.query("SELECT to_jsonb(sns_drafts) AS data FROM sns_drafts"))
        .rows[0].data,
    close: async () => {
      globalThis.fetch = oldFetch;
    },
  };
}

test("同時YouTube承認は1回だけアップロードする", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      youtube(request("publish-youtube")),
      youtube(request("publish-youtube")),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(f.counts().uploads, 1);
    assert.equal((await f.row()).status, "posted");
  } finally {
    await f.close();
  }
});

test("通常承認とredoは条件付き更新で片方のみ成功する", async () => {
  const f = await fixture();
  try {
    const results = await Promise.all([
      approve(request("approve")),
      redo(request("redo", { freeText: "直す" })),
    ]);
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.ok(
      ["approved", "revision_requested"].includes((await f.row()).status),
    );
  } finally {
    await f.close();
  }
});

for (const platform of ["youtube", "blog"]) {
  for (const failRpc of ["sns_record_external", "sns_finish_external"]) {
    test(`${platform}: 外部成功後${failRpc}失敗でも再送しない`, async () => {
      const f = await fixture(platform, { failRpc });
      try {
        const handler = platform === "youtube" ? youtube : blog;
        const action =
          platform === "youtube" ? "publish-youtube" : "merge-blog-pr";
        assert.equal((await handler(request(action, { headSha }))).status, 500);
        const row = await f.row();
        assert.equal(
          row.external_operation_state,
          failRpc === "sns_record_external" ? "reconcile" : "external_done",
        );
        if (failRpc === "sns_finish_external")
          assert.ok(row.external_operation_result.source_data);
        const retry = await handler(request(action, { headSha }));
        assert.equal(
          retry.status,
          failRpc === "sns_record_external" ? 409 : 200,
        );
        assert.equal(
          platform === "youtube" ? f.counts().uploads : f.counts().merges,
          1,
        );
        if (retry.status === 200)
          assert.equal((await f.row()).status, "posted");
      } finally {
        await f.close();
      }
    });
  }
}

test("YouTube応答消失とclaim応答消失は再送しない", async () => {
  for (const option of [{ uploadTimeout: true }, { loseClaimResponse: true }]) {
    const f = await fixture("youtube", option);
    try {
      assert.equal((await youtube(request("publish-youtube"))).status, 500);
      assert.equal((await youtube(request("publish-youtube"))).status, 409);
      assert.equal(f.counts().uploads, option.uploadTimeout ? 1 : 0);
    } finally {
      await f.close();
    }
  }
});

test("画面確認SHAの不一致はReady化前に拒否、GETは固定版を返す", async () => {
  const f = await fixture("blog", { headSha: "c".repeat(40) });
  try {
    const result = await preview(request("blog-pr-preview"));
    assert.equal(result.headers.get("cache-control"), "no-store");
    const body = await result.json();
    assert.ok(body.previewUrl.endsWith(body.headSha));
    assert.equal(
      (await blog(request("merge-blog-pr", { headSha }))).status,
      409,
    );
    assert.deepEqual(f.counts(), { uploads: 0, merges: 0, ready: 0 });
    assert.equal((await blog(request("merge-blog-pr"))).status, 400);
  } finally {
    await f.close();
  }
});

test("PR取得後のSHA変更もmergeのsha条件で拒否し、再実行を停止", async () => {
  const f = await fixture("blog", { shaChangedAtMerge: true });
  try {
    assert.equal(
      (await blog(request("merge-blog-pr", { headSha }))).status,
      502,
    );
    assert.equal(
      (await blog(request("merge-blog-pr", { headSha }))).status,
      409,
    );
    assert.equal(f.counts().merges, 1);
  } finally {
    await f.close();
  }
});

test("claim中は承認・redo・DB直接更新・削除を拒否、RPCは公開ロールに不可", async () => {
  const f = await fixture("youtube", { uploadTimeout: true });
  try {
    await youtube(request("publish-youtube"));
    assert.notEqual((await approve(request("approve"))).status, 200);
    assert.notEqual(
      (await redo(request("redo", { freeText: "直す" }))).status,
      200,
    );
    await assert.rejects(f.db.query("UPDATE sns_drafts SET title='変更'"));
    await assert.rejects(f.db.query("DELETE FROM sns_drafts"));
    await assert.rejects(
      f.db.query("UPDATE sns_drafts SET external_operation_state=NULL"),
    );
    await assert.rejects(
      f.db.query("UPDATE sns_drafts SET external_operation_token=NULL"),
    );
    for (const role of ["anon", "authenticated"]) {
      const result = await f.db.query(
        `SELECT has_function_privilege($1,'sns_claim_external(uuid,jsonb,uuid,uuid)','EXECUTE') AS allowed`,
        [role],
      );
      assert.equal(result.rows[0].allowed, false);
    }
    assert.equal((await archiveDraft(request("archive"))).status, 409);
  } finally {
    await f.close();
  }
});

test("承認済み下書きが外部操作中のmark-postedは409（500固定ではない）", async () => {
  const f = await fixture();
  try {
    await f.db.query(
      "UPDATE sns_drafts SET status='approved', external_operation_state='reconcile'",
    );
    assert.equal((await markPosted(request("mark-posted"))).status, 409);
  } finally {
    await f.close();
  }
});

test("redo起動失敗は応答に残り、通知はrisk/thumbnailも保持する", async () => {
  const f = await fixture();
  try {
    const response = await redo(request("redo", { freeText: "直す" }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.routine.fired, false);
    const messages = actionFeedback({
      ...body,
      riskWarnings: [{ id: "risk", matchedPattern: "対象" }],
      thumbnailWarning: "権限不足",
    });
    assert.equal(messages.length, 3);
    assert.match(messages[0], /起動に失敗/);
    assert.match(messages[2], /権限不足/);
  } finally {
    await f.close();
  }
});

test("未認証時は外部通信しない", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await youtube(request("publish-youtube", {}, false))).status,
      401,
    );
    assert.equal(
      (await preview(request("blog-pr-preview", {}, false))).status,
      401,
    );
    assert.deepEqual(f.counts(), { uploads: 0, merges: 0, ready: 0 });
  } finally {
    await f.close();
  }
});

test("同一スナップショットのclaimは1件だけ成功、変更後の版も拒否", async () => {
  const f = await fixture();
  try {
    const row = await f.row();
    const claims = await Promise.allSettled(
      [1, 2].map(() =>
        f.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
          id,
          row,
          crypto.randomUUID(),
          approverId,
        ]),
      ),
    );
    assert.equal(claims.filter((r) => r.status === "fulfilled").length, 1);
  } finally {
    await f.close();
  }
  const g = await fixture();
  try {
    const row = await g.row();
    await g.db.query("UPDATE sns_drafts SET title='変更'");
    await assert.rejects(
      g.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
        id,
        row,
        crypto.randomUUID(),
        approverId,
      ]),
    );
  } finally {
    await g.close();
  }
});

test("サムネ失敗を保存し、サムネ結果DB保存失敗でも動画を再送しない", async () => {
  for (const failRpc of [undefined, "sns_update_external_warning"]) {
    const f = await fixture("youtube", { thumbnail: true, failRpc });
    try {
      const first = await youtube(request("publish-youtube"));
      assert.equal(first.status, failRpc ? 500 : 200);
      const second = await youtube(request("publish-youtube"));
      assert.equal(second.status, 200);
      const result = await second.json();
      assert.ok(result.thumbnailWarning);
      assert.equal(result.data.source_data.youtube_video_id, "video-id");
      assert.equal(f.counts().uploads, 1);
      if (!failRpc)
        assert.match(result.data.source_data.youtube_thumbnail_error, /403/);
    } finally {
      await f.close();
    }
  }
});

test("依頼1の公開保留列がある場合はフラグ解除だけで送信させない", async () => {
  const f = await fixture();
  try {
    await f.db.exec(
      "ALTER TABLE sns_drafts ADD COLUMN publish_blocked boolean DEFAULT false, ADD COLUMN bundle_import_id uuid, ADD COLUMN bundle_version_hash text, ADD COLUMN publication_hold_reasons jsonb DEFAULT '[]'",
    );
    for (const patch of [
      "publish_blocked=true",
      "publish_blocked=false,bundle_import_id='00000000-0000-4000-8000-000000000003'",
      "bundle_import_id=NULL,bundle_version_hash='hash'",
      "bundle_version_hash=NULL,publication_hold_reasons='[\"保留\"]'",
    ]) {
      await f.db.exec(`UPDATE sns_drafts SET ${patch}`);
      const row = await f.row();
      await assert.rejects(
        f.db.query("SELECT sns_claim_external($1,$2,$3,$4)", [
          id,
          row,
          crypto.randomUUID(),
          approverId,
        ]),
      );
    }
    assert.equal(f.counts().uploads, 0);
  } finally {
    await f.close();
  }
});

test("親画面の成功・例外通知は関数型更新で蓄積し、閉じる操作だけが消去する", async () => {
  const source = await readFile(
    new URL("../../src/pages/admin/SnsHubAdmin.jsx", import.meta.url),
    "utf8",
  );
  const updates = [...source.matchAll(/setActionMessages\(([^;]+)\);/g)].map(
    (match) => match[1],
  );
  assert.equal(updates.length, 3);
  assert.ok(
    updates.every((update) => update.startsWith("previous => [...previous,")),
  );
  assert.match(source, /onClick=\{\(\) => setActionMessages\(\[\]\)\}/);
  // 実画面に接続された各updaterを順に実行し、Reactの連続更新を再現する。
  let messages = [];
  for (const result of [
    { thumbnailWarning: "権限不足" },
    {},
    { riskWarnings: [{ id: "risk" }] },
  ]) {
    const next = actionFeedback(result);
    const updater = new Function("messages", `return (${updates[0]})`)(next);
    messages = updater(messages);
  }
  assert.equal(messages.length, 2);
  const err = { message: "内部エラー詳細" };
  for (const update of updates.slice(1))
    messages = new Function("err", `return (${update})`)(err)(messages);
  assert.deepEqual(messages.slice(-2), [
    "操作に失敗しました。最新状態を確認してください。",
    "マージに失敗しました。PRと最新状態を確認してください。",
  ]);
  assert.ok(
    !messages.some((message) => message.includes(err.message)),
    "生のエラー詳細は表示しない",
  );
  assert.match(messages[0], /権限不足/);
});

for (const thumbnailSuccess of [true, false]) {
  test(`サムネ待機中にDB反映だけ再試行しても結果を保存する（成功=${thumbnailSuccess}）`, async () => {
    let started, release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const waiting = new Promise((resolve) => {
      started = resolve;
    });
    const f = await fixture("youtube", {
      thumbnail: true,
      thumbnailSuccess,
      thumbnailGate: async () => {
        started();
        await pending;
      },
    });
    let first;
    try {
      first = youtube(request("publish-youtube"));
      await waiting;
      assert.equal((await f.row()).external_operation_state, "external_done");
      assert.equal((await youtube(request("publish-youtube"))).status, 200);
      assert.equal((await f.row()).external_operation_state, "done");
      release();
      assert.equal((await first).status, 200);
      const row = await f.row();
      assert.equal(row.external_operation_state, "done");
      assert.equal(
        row.external_operation_result.thumbnailWarning,
        thumbnailSuccess ? null : row.source_data.youtube_thumbnail_error,
      );
      if (!thumbnailSuccess)
        assert.match(row.source_data.youtube_thumbnail_error, /403/);
      else assert.equal(row.source_data.youtube_thumbnail_error, undefined);
      const retry = await (await youtube(request("publish-youtube"))).json();
      assert.equal(
        retry.thumbnailWarning ?? null,
        row.external_operation_result.thumbnailWarning,
      );
      assert.equal(f.counts().uploads, 1);
      await assert.rejects(
        f.db.query("SELECT sns_update_external_warning($1,$2,$3)", [
          id,
          crypto.randomUUID(),
          "別操作",
        ]),
      );
    } finally {
      release();
      if (first) await first;
      await f.close();
    }
  });
}
