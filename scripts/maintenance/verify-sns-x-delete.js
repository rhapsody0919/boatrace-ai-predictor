// X の投稿を消す口（BOA-1279）の再現テスト。X・DB・本番の関数はすべて差し替え（外部接続なし、本物の X を呼ばない）。
// adapter の DELETE /2/tweets/:id（404 は既に無い）、消す本体（記録に無い・ID 違い・196 未適用で X を呼ばない、1件落ちたら残りを送らない）、
// 管理 API、CLI（既定 dry-run・--apply は ID の明示と理由が要る・HQ_TEST で断る・候補は名簿に無い選手の名前）、
// マイグレーション 196 を PGlite に当てた mark_sns_x_post_deleted（時刻と理由・計測の pending を閉じる・何度呼んでも同じ・権限）
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXApiAdapter } from "../../api/_lib/xApiAdapter.js";
import {
  candidateRow,
  deleteReasonIssue,
  deleteTargetsIssue,
  fictionalReasons,
  normalizeRacerName,
  racerNamesOf,
  runDeleteXPosts,
} from "../../api/_lib/snsXDelete.js";
import {
  POST,
  config as deleteConfig,
  createDeleteHandler,
} from "../../api/admin/sns-hub/delete-x-post.js";
import {
  DELETE_API_URL,
  main,
  parseDeleteArgs,
} from "../../scripts/sns/delete-x-post.js";
import { extractConfirmationSections } from "../lib/dbApplySql.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const JOB = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";
const TWEET = "2117595614477439138";
const TWEET2 = "2117440373719183402";
const postedJob = (over = {}) => ({
  id: JOB,
  draft_id: "d1",
  channel: "x",
  state: "posted",
  external_post_id: TWEET,
  posted_at: "2026-11-03T12:31:52Z",
  deleted_at: null,
  snapshot: {
    text: "【節の機力】ボートレース丸亀の優勝戦、今節いちばん足が来てる\n\n本文",
  },
  ...over,
});

// --- adapter ---
function fakeDelete(status, body) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method });
      return json(body, status);
    },
  };
}

test("adapter: DELETE /2/tweets/:id を1回呼び、deleted=true で成功", async () => {
  const f = fakeDelete(200, { data: { deleted: true } });
  const x = createXApiAdapter({ accessToken: "t", fetchImpl: f.fetchImpl });
  assert.deepEqual(await x.deletePost(TWEET), { already: false });
  assert.deepEqual(f.calls, [
    { url: `https://api.x.com/2/tweets/${TWEET}`, method: "DELETE" },
  ]);
});

test("adapter: 404 は既に無いとして成功（already）、403 は本文を出さずに投げる、deleted=false は投げる、ID が不正なら呼ばない", async () => {
  const gone = fakeDelete(404, { title: "Not Found Error" });
  assert.deepEqual(
    await createXApiAdapter({
      accessToken: "t",
      fetchImpl: gone.fetchImpl,
    }).deletePost(TWEET),
    { already: true },
  );
  const forbidden = fakeDelete(403, {
    title: "Forbidden",
    detail: "secret detail",
  });
  await assert.rejects(
    createXApiAdapter({
      accessToken: "t",
      fetchImpl: forbidden.fetchImpl,
    }).deletePost(TWEET),
    (e) => /HTTP 403 Forbidden/.test(e.message) && !/secret/.test(e.message),
  );
  const notDeleted = fakeDelete(200, { data: { deleted: false } });
  await assert.rejects(
    createXApiAdapter({
      accessToken: "t",
      fetchImpl: notDeleted.fetchImpl,
    }).deletePost(TWEET),
    /削除を確認できません/,
  );
  const bad = fakeDelete(200, {});
  await assert.rejects(
    createXApiAdapter({
      accessToken: "t",
      fetchImpl: bad.fetchImpl,
    }).deletePost("../2/users"),
    /ID が不正/,
  );
  assert.equal(bad.calls.length, 0);
});

// --- 純粋関数 ---
test("架空の候補: 名簿に無い選手の名前・試験の印。名簿の名前は空白の違いを無視して一致", () => {
  const roster = new Set(["西田　　　靖", "田中 太郎"].map(normalizeRacerName));
  const fake = {
    title: "節の機力 2026-11-03 v15-final",
    source_data: {
      setsu_kiryoku: {
        racers: [{ name: "田中 イ" }, { name: "佐藤 ウ" }, { name: "西田 靖" }],
      },
    },
  };
  assert.deepEqual(racerNamesOf(fake.source_data), [
    "田中 イ",
    "佐藤 ウ",
    "西田 靖",
  ]);
  assert.deepEqual(fictionalReasons({ draft: fake }, roster), [
    "選手の名簿に無い名前 2人（田中 イ・佐藤 ウ）",
  ]);
  const real = {
    title: "優勝戦",
    source_data: { setsu_kiryoku: { racers: [{ name: "田中　太郎" }] } },
  };
  assert.deepEqual(fictionalReasons({ draft: real }, roster), []);
  assert.deepEqual(
    fictionalReasons(
      { draft: { title: "smoke 試し", source_data: {} } },
      roster,
    ),
    ["試験の印（smoke 試し）"],
  );
  // 名前の無い型（/today 等）は候補に出ない
  assert.deepEqual(
    fictionalReasons(
      {
        draft: {
          title: "本日のデータ一覧",
          source_data: { source_manifest: [{ name: "a.json" }] },
        },
      },
      roster,
    ),
    [],
  );
});

test("一覧の1行: 本文は先頭30字（改行は空白）", () => {
  const row = candidateRow(
    { job: postedJob(), draft: { format: "setsu_kiryoku", title: "t" } },
    ["r"],
  );
  assert.equal([...row.head].length, 30);
  assert.equal(row.tweet_id, TWEET);
  assert.ok(!/\n/.test(row.head));
});

test("理由と targets の形: 理由は必須・200字・改行なし、targets は明示の ID だけで5件まで・重なりなし", () => {
  assert.match(deleteReasonIssue(""), /--reason/);
  assert.match(deleteReasonIssue("a".repeat(201)), /200字/);
  assert.match(deleteReasonIssue("a\nb"), /改行/);
  assert.equal(
    deleteReasonIssue("架空の選手の試験の投稿（オーナー 11/4）"),
    null,
  );
  assert.match(deleteTargetsIssue([]), /明示/);
  assert.match(deleteTargetsIssue(undefined), /明示/);
  assert.match(deleteTargetsIssue([{ job_id: JOB }]), /形/);
  assert.match(
    deleteTargetsIssue([
      { job_id: JOB, tweet_id: TWEET },
      { job_id: JOB, tweet_id: TWEET },
    ]),
    /2回/,
  );
  const eleven = Array.from({ length: 6 }, (_, i) => ({
    job_id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`,
    tweet_id: TWEET,
  }));
  assert.match(deleteTargetsIssue(eleven), /5件/);
});

// --- 本体 ---
function fakeStore(jobs) {
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
function fakeXFactory(result = { already: false }) {
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

test("本体: 196 が未適用（deleted_at の列が無い）なら X を呼ばずに止める。消した記録があれば X を呼ばず記録だけ", async () => {
  const { deleted_at: _drop, ...noColumn } = postedJob();
  const x = fakeXFactory();
  const stopped = await runDeleteXPosts(
    { targets: [{ job_id: JOB, tweet_id: TWEET }], reason: "r" },
    { store: fakeStore({ [JOB]: noColumn }), getX: x.getX },
  );
  assert.equal(stopped.ok, false);
  assert.match(stopped.results[0].error, /196 が未適用/);
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

// --- 管理 API ---
const authEnv = () => {
  process.env.SNS_HUB_BASIC_AUTH_USER = "u";
  process.env.SNS_HUB_BASIC_AUTH_PASSWORD = "p";
};
const authHeader = `Basic ${Buffer.from("u:p").toString("base64")}`;

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

function fakeSupabase({ jobs, drafts, roster }) {
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
const ENV = {
  SUPABASE_URL: "https://db",
  SUPABASE_SERVICE_KEY: "k",
  SNS_HUB_BASIC_AUTH_USER: "u",
  SNS_HUB_BASIC_AUTH_PASSWORD: "p",
};
const fixture = () => ({
  jobs: [
    postedJob({ draft_id: "d1" }),
    postedJob({
      id: JOB2,
      draft_id: "d2",
      external_post_id: TWEET2,
      snapshot: { text: "徳山12R 優勝戦" },
    }),
  ],
  drafts: [
    {
      id: "d1",
      format: "setsu_kiryoku",
      title: "節の機力 2026-11-03 v15-final",
      source_data: { setsu_kiryoku: { racers: [{ name: "田中 イ" }] } },
    },
    {
      id: "d2",
      format: "finals_image",
      title: "優勝戦 思考の順",
      source_data: {},
    },
  ],
  roster: ["西田　　　靖"],
});
async function runMain(argv, env, fetchImpl) {
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

test("CLI: --apply は ID を明示した投稿だけを API に送る。HQ_TEST が立っていれば何も読まず断る", async () => {
  const f = fakeSupabase(fixture());
  const { code, result } = await runMain(
    ["--tweet-id", TWEET, "--reason", "架空の選手", "--apply"],
    ENV,
    f.fetchImpl,
  );
  assert.equal(code, 0);
  assert.equal(result.mode, "apply");
  const sent = f.calls.find((c) => c.url === DELETE_API_URL);
  assert.equal(sent.method, "POST");
  // fake の DB は or の条件を見ずに2件返す。手元でも指定の ID に絞り、指定した1件だけを送る
  assert.deepEqual(JSON.parse(sent.body).targets, [
    { job_id: JOB, tweet_id: TWEET },
  ]);
  assert.equal(JSON.parse(sent.body).reason, "架空の選手");
  const t = fakeSupabase(fixture());
  const refused = await runMain(
    ["--tweet-id", TWEET, "--reason", "r", "--apply"],
    { ...ENV, HQ_TEST: "1" },
    t.fetchImpl,
  );
  assert.equal(refused.code, 2);
  assert.match(refused.result.error, /HQ_TEST/);
  assert.equal(t.calls.length, 0);
});

test("CLI: 記録に無い ID は --apply でも何も消さない（exit 2）", async () => {
  const f = fakeSupabase({ ...fixture(), jobs: [] });
  const { code, result } = await runMain(
    ["--tweet-id", TWEET, "--reason", "r", "--apply"],
    ENV,
    f.fetchImpl,
  );
  assert.equal(code, 2);
  assert.deepEqual(result.missing, [TWEET]);
  assert.ok(f.calls.every((c) => c.url !== DELETE_API_URL));
});

test("本体: 2件目の DB の読み取りが落ちても、1件目の済んだ結果を返す", async () => {
  const store = fakeStore({ [JOB]: postedJob() });
  const read = store.readJob;
  store.readJob = async (id) => {
    if (id === JOB2) throw new Error("X送信のDB操作に失敗しました");
    return read(id);
  };
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
  assert.deepEqual(
    out.results.map((r) => r.ok),
    [true, false],
  );
  assert.deepEqual(x.deleted, [TWEET]);
});

test("CLI: --item-id だけで当たった消せない job（同じ item の未送信）は外し、止めない", async () => {
  const ITEM = "33333333-3333-4333-8333-333333333333";
  const f = fakeSupabase({
    ...fixture(),
    jobs: [
      postedJob({ auto_item_id: ITEM }),
      postedJob({
        id: JOB2,
        draft_id: "d2",
        state: "cancelled",
        external_post_id: null,
        auto_item_id: ITEM,
      }),
    ],
  });
  const { code, result } = await runMain(
    ["--item-id", ITEM, "--reason", "架空", "--apply"],
    ENV,
    f.fetchImpl,
  );
  assert.equal(code, 0);
  const sent = f.calls.find((c) => c.url === DELETE_API_URL);
  assert.deepEqual(JSON.parse(sent.body).targets, [
    { job_id: JOB, tweet_id: TWEET },
  ]);
  assert.equal(result.mode, "apply");
});

test("CLI: 消す API の応答が JSON でない（未デプロイ等）ときも DELETE_RESULT を出して exit 1", async () => {
  const f = fakeSupabase(fixture());
  const fetchImpl = async (url, init) =>
    String(url) === DELETE_API_URL
      ? new Response("<html></html>", { status: 200 })
      : f.fetchImpl(url, init);
  const { code, result } = await runMain(
    ["--tweet-id", TWEET, "--reason", "r", "--apply"],
    ENV,
    fetchImpl,
  );
  assert.equal(code, 1);
  assert.match(result.error, /応答が読めない/);
});

// --- マイグレーション 196（PGlite） ---
const sql = await readFile(
  new URL(
    "../../docs/db-migration/196_sns_x_post_deleted.sql",
    import.meta.url,
  ),
  "utf8",
);
const db = new PGlite();
after(() => db.close());
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
const sectionSql = (prefix) =>
  extractConfirmationSections(sql)
    .find((s) => s.heading.startsWith(prefix))
    .lines.join("\n");

test("196: 適用前後の確認・posted の X だけに時刻と理由・計測の pending を閉じる・何度呼んでも同じ・不一致は拒否・権限", async () => {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.sns_x_send_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL DEFAULT gen_random_uuid(),
      channel text NOT NULL DEFAULT 'x' CHECK (channel IN ('x','youtube')),
      state text NOT NULL DEFAULT 'posted', external_post_id text, posted_at timestamptz,
      error_code text, parent_job_id uuid, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.sns_metric_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), draft_id uuid NOT NULL, "window" text NOT NULL,
      source text NOT NULL, state text NOT NULL DEFAULT 'pending', last_error text, done_at timestamptz);
    -- 154 のトリガー（state の UPDATE で計測の job を作る）が、消した記録の UPDATE で発火しないこと
    CREATE TABLE public.trigger_log (job_id uuid);
    CREATE FUNCTION public.log_state() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO public.trigger_log VALUES (NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER sns_metric_jobs_on_posted AFTER UPDATE OF state ON public.sns_x_send_jobs FOR EACH ROW EXECUTE FUNCTION public.log_state();
  `);
  assert.deepEqual(await one(sectionSql("適用前の確認")), {
    deleted_columns: 0,
    mark_fn: null,
  });
  await db.exec(sql);
  assert.deepEqual(await one(sectionSql("適用後の確認")), {
    deleted_columns: 2,
    anon_exec: false,
    auth_exec: false,
    service_exec: true,
  });
  const job = await one(
    `INSERT INTO public.sns_x_send_jobs (external_post_id) VALUES ($1) RETURNING id, draft_id`,
    [TWEET],
  );
  await db.query(
    `INSERT INTO public.sns_metric_jobs (draft_id, "window", source, state) VALUES ($1,'48h','x-api','pending'),($1,'7d','x-api','pending'),($1,'48h','x-api','done')`,
    [job.draft_id],
  );
  // その投稿への返信: queued・held は取り消す、sending は触らない（出たかもしれない）
  for (const state of ["queued", "held", "sending"])
    await db.query(
      `INSERT INTO public.sns_x_send_jobs (state, parent_job_id) VALUES ($1,$2)`,
      [state, job.id],
    );
  const first = (
    await one(`SELECT public.mark_sns_x_post_deleted($1,$2,$3) r`, [
      job.id,
      TWEET,
      " 架空の選手 ",
    ])
  ).r;
  assert.equal(first.deleted_reason, "架空の選手");
  assert.equal(first.metric_jobs_closed, 2);
  assert.equal(first.replies_cancelled, 2);
  assert.deepEqual(
    (
      await db.query(
        `SELECT state, error_code FROM public.sns_x_send_jobs WHERE parent_job_id=$1 ORDER BY state`,
        [job.id],
      )
    ).rows,
    [
      { state: "cancelled", error_code: "parent_deleted" },
      { state: "cancelled", error_code: "parent_deleted" },
      { state: "sending", error_code: null },
    ],
  );
  assert.deepEqual(
    (
      await db.query(
        `SELECT state, last_error FROM public.sns_metric_jobs ORDER BY state, "window"`,
      )
    ).rows,
    [
      { state: "done", last_error: null },
      { state: "missing", last_error: "post_deleted" },
      { state: "missing", last_error: "post_deleted" },
    ],
  );
  const again = (
    await one(`SELECT public.mark_sns_x_post_deleted($1,$2,'別の理由') r`, [
      job.id,
      TWEET,
    ])
  ).r;
  assert.equal(again.deleted_reason, "架空の選手");
  assert.equal(again.deleted_at, first.deleted_at);
  assert.equal(again.metric_jobs_closed, 0);
  const row = await one(
    `SELECT state FROM public.sns_x_send_jobs WHERE id=$1`,
    [job.id],
  );
  assert.equal(row.state, "posted");
  assert.equal(
    Number(
      (
        await one(`SELECT count(*) n FROM public.trigger_log WHERE job_id=$1`, [
          job.id,
        ])
      ).n,
    ),
    0,
  );

  const reject = (q, a) =>
    db.query(q, a).then(
      () => null,
      (e) => e.message,
    );
  assert.match(
    await reject(`SELECT public.mark_sns_x_post_deleted($1,$2,'r')`, [
      job.id,
      TWEET2,
    ]),
    /delete_job_mismatch/,
  );
  assert.match(
    await reject(
      `SELECT public.mark_sns_x_post_deleted(gen_random_uuid(),$1,'r')`,
      [TWEET],
    ),
    /delete_job_not_found/,
  );
  assert.match(
    await reject(`SELECT public.mark_sns_x_post_deleted($1,$2,'  ')`, [
      job.id,
      TWEET,
    ]),
    /delete_reason_invalid/,
  );
  assert.match(
    await reject(`SELECT public.mark_sns_x_post_deleted($1,$2,E'a\\nb')`, [
      job.id,
      TWEET,
    ]),
    /delete_reason_invalid/,
  );
  const held = await one(
    `INSERT INTO public.sns_x_send_jobs (state, external_post_id) VALUES ('held',$1) RETURNING id`,
    [TWEET2],
  );
  assert.match(
    await reject(`SELECT public.mark_sns_x_post_deleted($1,$2,'r')`, [
      held.id,
      TWEET2,
    ]),
    /delete_job_mismatch/,
  );
  // CHECK: 理由だけ・posted でない行に時刻は入らない
  assert.ok(
    await reject(
      `UPDATE public.sns_x_send_jobs SET deleted_reason='r' WHERE id=$1`,
      [held.id],
    ),
  );
  assert.ok(
    await reject(
      `UPDATE public.sns_x_send_jobs SET deleted_at=now(), deleted_reason='r' WHERE id=$1`,
      [held.id],
    ),
  );
  await db.exec("SET ROLE anon");
  try {
    assert.match(
      await reject(`SELECT public.mark_sns_x_post_deleted($1,$2,'r')`, [
        job.id,
        TWEET,
      ]),
      /permission denied/,
    );
  } finally {
    await db.exec("RESET ROLE");
  }
});
