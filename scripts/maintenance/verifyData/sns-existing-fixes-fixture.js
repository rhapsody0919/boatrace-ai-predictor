// verify-sns-existing-fixes.js の固定データ（PGlite の下書き1件と fetch の模型。越えの単位を分けるため移した。verify ではない）
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

export const id = "00000000-0000-4000-8000-000000000001";
export const headSha = "a".repeat(40);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
let sharedDb;
export const closeSharedDb = async () => {
  if (sharedDb) await sharedDb.close();
};

export async function fixture(platform = "youtube", options = {}) {
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
          "../../../docs/db-migration/138_sns_external_operations.sql",
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
  const state = { uploads: 0, merges: 0, ready: 0, injected: false };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) =>
    fakeFetch({ db, options, state }, url, init);
  return {
    db,
    counts: () => ({
      uploads: state.uploads,
      merges: state.merges,
      ready: state.ready,
    }),
    row: async () =>
      (await db.query("SELECT to_jsonb(sns_drafts) AS data FROM sns_drafts"))
        .rows[0].data,
    close: async () => {
      globalThis.fetch = oldFetch;
    },
  };
}

async function fakeFetch({ db, options, state }, url, init) {
  const u = new URL(url);
  if (u.hostname === "mock.invalid" && u.pathname.startsWith("/rest/v1/rpc/"))
    return rpcResponse({ db, options, state }, u, init);
  if (u.hostname === "mock.invalid" && u.pathname === "/rest/v1/sns_drafts")
    return draftsResponse(db, u, init);
  if (u.hostname === "mock.invalid" && u.pathname.startsWith("/storage/"))
    return json([{ path: "video.mp4", signedURL: "/video" }]);
  if (u.hostname === "mock.invalid" && u.pathname.endsWith("/video"))
    return new Response("video");
  if (u.hostname.endsWith("googleapis.com")) {
    const r = await googleResponse(options, state, u);
    if (r) return r;
  }
  if (u.hostname === "api.github.com")
    return githubResponse(options, state, u, init);
  throw new Error(`Unexpected network call: ${u.hostname}${u.pathname}`);
}

async function rpcResponse({ db, options, state }, u, init) {
  const name = u.pathname.split("/").at(-1);
  if (options.failRpc === name && !state.injected) {
    state.injected = true;
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
    if (options.loseClaimResponse && name === "sns_claim_external") throw error;
    return json({ error: error.message }, 409);
  }
}

async function draftsResponse(db, u, init) {
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

async function googleResponse(options, state, u) {
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
    state.uploads++;
    if (options.uploadTimeout) throw new Error("mock timeout");
    return json({ id: "video-id" });
  }
  return null;
}

function githubResponse(options, state, u, init) {
  if (u.hostname === "api.github.com" && u.pathname.endsWith("/merge")) {
    state.merges++;
    assert.equal(JSON.parse(init.body).sha, headSha);
    if (options.shaChangedAtMerge)
      return json({ message: "Head changed" }, 409);
    return json({ merged: true, sha: "b".repeat(40) });
  }
  if (u.hostname === "api.github.com" && u.pathname === "/graphql") {
    state.ready++;
    return json({ data: {} });
  }
  if (u.hostname === "api.github.com")
    return json({
      head: { sha: options.headSha || headSha },
      state: "open",
      draft: true,
      node_id: "node",
    });
}
