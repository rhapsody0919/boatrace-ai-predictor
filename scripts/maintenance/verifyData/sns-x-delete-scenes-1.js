/**
 * verify-sns-x-delete.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-x-delete.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runDeleteXPosts } from "../../../api/_lib/snsXDelete.js";
import { config as deleteConfig, POST, createDeleteHandler } from "../../../api/admin/sns-hub/delete-x-post.js";
import { parseDeleteArgs, DELETE_API_URL, main } from "../../sns/delete-x-post.js";

let json, JOB, JOB2, TWEET, TWEET2, postedJob, fixture;
let authHeader;

// --- 本体 ---
export function fakeStore(jobs) {
  const marks = [];
  return {
    marks,
    readJob: async (id) => jobs[id] ?? null,
    markDeleted: async (jobId, tweetId, reason) => {
      marks.push([jobId, tweetId, reason]);
      return { deleted_at: "2026-11-04T00:00:00Z", metric_jobs_closed: 2 };
    },
  };
}

export function fakeXFactory(result = { already: false }) {
  const deleted = [];
  let tokens = 0;
  return {
    deleted,
    tokens: () => tokens,
    getX: async () => {
      tokens++;
      return {
        deletePost: async (id) => (
          deleted.push(id),
          typeof result === "function" ? result(id) : result
        ),
      };
    },
  };
}

// --- 管理 API ---
const authEnv = () => {
  process.env.SNS_HUB_BASIC_AUTH_USER = "u";
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "p";
};

export function fakeSupabase({ jobs, drafts, roster }) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    calls.push({ url: u, method: init.method ?? "GET", body: init.body });
    if (u === DELETE_API_URL) {
      const body = JSON.parse(init.body);
      return json({
        data: {
          ok: true,
          results: body.targets.map((t) => ({ ...t, ok: true })),
        },
      });
    }
    assert.equal(init.method ?? "GET", "GET", "DB には書かない");
    if (u.includes("/rest/v1/sns_x_send_jobs"))
      return json(u.includes("offset=0") ? jobs : []);
    if (u.includes("/rest/v1/sns_drafts")) return json(drafts);
    if (u.includes("/rest/v1/racer_profiles"))
      return json(
        u.includes("offset=0") ? roster.map((name) => ({ name })) : [],
      );
    throw new Error("想定外: " + u);
  };
  return { calls, fetchImpl };
}

export const ENV = {
  SUPABASE_URL: "https://db",
  SUPABASE_SERVICE_KEY: "k",
  SNS_HUB_BASIC_AUTH_USER: "u",
  SNS_HUB_BASIC_AUTH_PASSWORD: "p",
};

export async function runMain(argv, env, fetchImpl) {
  const lines = [];
  const original = { log: console.log, error: console.error };
  console.log = (line) => lines.push(String(line));
  console.error = () => {};
  try {
    const code = await main(argv, env, fetchImpl);
    const last = lines.at(-1);
    assert.match(last, /^DELETE_RESULT /);
    return {
      code,
      result: JSON.parse(last.slice("DELETE_RESULT ".length)),
      lines,
    };
  } finally {
    Object.assign(console, original);
  }
}

function scene1() {
  test("本体: X で消してから記録を直す。404（already）も記録を直す", async () => {
    const store = fakeStore({ [JOB]: postedJob() });
    const x = fakeXFactory({ already: true });
    const out = await runDeleteXPosts(
      { targets: [{ job_id: JOB, tweet_id: TWEET }], reason: " 架空の選手 " },
      { store, getX: x.getX },
    );
    assert.equal(out.ok, true);
    assert.deepEqual(x.deleted, [TWEET]);
    assert.deepEqual(store.marks, [[JOB, TWEET, "架空の選手"]]);
    assert.equal(out.results[0].already, true);
  });
  test("本体: 記録に無い・ID が記録と違う・posted でない・X でないものは X を呼ばない。1件落ちたら残りを送らない", async () => {
    for (const job of [
      null,
      postedJob({ external_post_id: TWEET2 }),
      postedJob({ state: "reconcile" }),
      postedJob({ channel: "youtube" }),
    ]) {
      const store = fakeStore({
        [JOB]: job,
        [JOB2]: postedJob({ id: JOB2, external_post_id: TWEET2 }),
      });
      const x = fakeXFactory();
      const out = await runDeleteXPosts(
        {
          targets: [
            { job_id: JOB, tweet_id: TWEET },
            { job_id: JOB2, tweet_id: TWEET2 },
          ],
          reason: "r",
        },
        { store, getX: x.getX },
      );
      assert.equal(out.ok, false);
      assert.equal(out.results.length, 1);
      assert.equal(x.tokens(), 0);
      assert.deepEqual(store.marks, []);
    }
  });
  test("本体: 197 が未適用（deleted_at の列が無い）なら X を呼ばずに止める。消した記録があれば X を呼ばず記録だけ", async () => {
    const { deleted_at: _drop, ...noColumn } = postedJob();
    const x = fakeXFactory();
    const stopped = await runDeleteXPosts(
      { targets: [{ job_id: JOB, tweet_id: TWEET }], reason: "r" },
      { store: fakeStore({ [JOB]: noColumn }), getX: x.getX },
    );
    assert.equal(stopped.ok, false);
    assert.match(stopped.results[0].error, /197 が未適用/);
    assert.equal(x.tokens(), 0);
    const store = fakeStore({
      [JOB]: postedJob({ deleted_at: "2026-11-04T00:00:00Z" }),
    });
    const out = await runDeleteXPosts(
      { targets: [{ job_id: JOB, tweet_id: TWEET }], reason: "r" },
      { store, getX: x.getX },
    );
    assert.equal(out.ok, true);
    assert.equal(x.tokens(), 0);
    assert.equal(store.marks.length, 1);
  });
  test("本体: X が落ちたら記録を直さず、残りを送らない", async () => {
    const store = fakeStore({
      [JOB]: postedJob(),
      [JOB2]: postedJob({ id: JOB2, external_post_id: TWEET2 }),
    });
    const x = {
      getX: async () => ({
        deletePost: async () => {
          throw new Error(
            "X API DELETE /2/tweets/1 が失敗: HTTP 429 Too Many Requests",
          );
        },
      }),
    };
    const out = await runDeleteXPosts(
      {
        targets: [
          { job_id: JOB, tweet_id: TWEET },
          { job_id: JOB2, tweet_id: TWEET2 },
        ],
        reason: "r",
      },
      { store, getX: x.getX },
    );
    assert.equal(out.ok, false);
    assert.equal(out.results.length, 1);
    assert.match(out.results[0].error, /429/);
    assert.deepEqual(store.marks, []);
  });
  authHeader = `Basic ${Buffer.from("u:p").toString("base64")}`;
}

function scene2() {
  test("管理 API の書き出し: nodejs・300秒・POST の名前（既定の書き出しは Node の (req, res) で呼ばれるので置かない）", () => {
    assert.deepEqual(deleteConfig, { runtime: "nodejs", maxDuration: 300 });
    assert.equal(typeof POST, "function");
  });
  test("管理 API: 認証なしは 401・GET は 405・targets が無ければ 400 で X を呼ばない・正しければ 200", async () => {
    authEnv();
    const store = fakeStore({ [JOB]: postedJob() });
    const x = fakeXFactory();
    const handler = createDeleteHandler({
      store,
      getX: x.getX,
      configured: () => true,
    });
    const req = (method, body, auth = authHeader) =>
      new Request("https://www.boat-ai.jp/api/admin/sns-hub/delete-x-post", {
        method,
        headers: {
          ...(auth ? { authorization: auth } : {}),
          "content-type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    assert.equal(
      (await handler(req("POST", { targets: [], reason: "r" }, null))).status,
      401,
    );
    assert.equal((await handler(req("GET"))).status, 405);
    assert.equal((await handler(req("POST", { reason: "r" }))).status, 400);
    assert.equal(
      (
        await handler(
          req("POST", { targets: [{ job_id: JOB, tweet_id: TWEET }] }),
        )
      ).status,
      400,
    );
    assert.equal(x.tokens(), 0);
    const ok = await handler(
      req("POST", {
        targets: [{ job_id: JOB, tweet_id: TWEET }],
        reason: "架空",
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.ok, true);
    assert.deepEqual(x.deleted, [TWEET]);
  });
  // --- CLI ---
  test("CLI の引数: 既定は dry-run・--apply は ID と理由が要る・ID の形・5件まで・知らない引数は不可・--reason の後が引数なら不可", () => {
    assert.equal(parseDeleteArgs([]).apply, false);
    assert.match(parseDeleteArgs(["--apply", "--reason", "r"]).error, /明示/);
    assert.match(
      parseDeleteArgs(["--apply", "--tweet-id", TWEET]).error,
      /--reason/,
    );
    assert.match(parseDeleteArgs(["--tweet-id", "abc"]).error, /不正/);
    assert.match(parseDeleteArgs(["--item-id", "1"]).error, /不正/);
    assert.match(parseDeleteArgs(["--all"]).error, /知らない/);
    assert.match(
      parseDeleteArgs(
        Array.from({ length: 6 }, () => ["--tweet-id", TWEET]).flat(),
      ).error,
      /5件/,
    );
    assert.match(
      parseDeleteArgs(["--tweet-id", TWEET, "--reason", "--apply"]).error,
      /--reason の後/,
    );
    const ok = parseDeleteArgs(["--tweet-id", TWEET, "--reason", "r", "--apply"]);
    assert.deepEqual([ok.apply, ok.tweetIds, ok.reason], [true, [TWEET], "r"]);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（json・JOB・JOB2・TWEET・TWEET2・postedJob） */
export function runSnsXDeleteScenes1(env) {
  ({ json, JOB, JOB2, TWEET, TWEET2, postedJob } = env);
  scene1();
  scene2();
}

function scene3() {
  test("CLI: 引数なしは架空の候補の一覧だけ（名簿に無い名前の1件）。DB に書かず、消す API も呼ばない", async () => {
    const f = fakeSupabase(fixture());
    const { code, result } = await runMain([], ENV, f.fetchImpl);
    assert.equal(code, 0);
    assert.equal(result.mode, "dry-run");
    assert.deepEqual(
      result.candidates.map((c) => c.tweet_id),
      [TWEET],
    );
    assert.match(
      result.candidates[0].reasons[0],
      /名簿に無い名前 1人（田中 イ）/,
    );
    assert.ok(f.calls.every((c) => c.url !== DELETE_API_URL));
    assert.ok(
      f.calls.some((c) => c.url.includes("channel=eq.x&state=eq.posted")),
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（json・JOB・JOB2・TWEET・TWEET2・postedJob・fixture） */
export function runSnsXDeleteScenes2(env) {
  ({ json, JOB, JOB2, TWEET, TWEET2, postedJob, fixture } = env);
  scene3();
}
