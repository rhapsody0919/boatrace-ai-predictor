// X の投稿を消す口（BOA-1279）の再現テスト。X・DB・本番の関数はすべて差し替え（外部接続なし、本物の X を呼ばない）。
// adapter の DELETE /2/tweets/:id（404 は既に無い）、消す本体（記録に無い・ID 違い・197 未適用で X を呼ばない、1件落ちたら残りを送らない）、
// 管理 API、CLI（既定 dry-run・--apply は ID の明示と理由が要る・HQ_TEST で断る・候補は名簿に無い選手の名前）、
// マイグレーション 197 を PGlite に当てた mark_sns_x_post_deleted（時刻と理由・計測の pending を閉じる・何度呼んでも同じ・権限）
import { test } from "node:test";
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
} from "../../api/_lib/snsXDelete.js";


import { extractConfirmationSections } from "../lib/dbApplySql.js";
import { runSnsXDeleteScenes1, runSnsXDeleteScenes2 } from "./verifyData/sns-x-delete-scenes-1.js";
import { runSnsXDeleteScenes3, runSnsXDeleteScenes4 } from "./verifyData/sns-x-delete-scenes-2.js";

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

// ---- 後半の場面（verifyData/sns-x-delete-scenes-1.js） ----
runSnsXDeleteScenes1({ json, JOB, JOB2, TWEET, TWEET2, postedJob });
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

// ---- 後半の場面（verifyData/sns-x-delete-scenes-1.js・sns-x-delete-scenes-2.js） ----
runSnsXDeleteScenes2({ json, JOB, JOB2, TWEET, TWEET2, postedJob, fixture });
runSnsXDeleteScenes3({ JOB, JOB2, TWEET, TWEET2, postedJob, fixture });

// --- マイグレーション 197（PGlite） ---
const sql = await readFile(
  new URL(
    "../../docs/db-migration/197_sns_x_post_deleted.sql",
    import.meta.url,
  ),
  "utf8",
);
const db = new PGlite();

// ---- 後半の場面（verifyData/sns-x-delete-scenes-2.js） ----
runSnsXDeleteScenes4({ JOB, JOB2, TWEET, TWEET2, postedJob, fixture, db });
const one = async (q, a = []) => (await db.query(q, a)).rows[0];
const sectionSql = (prefix) =>
  extractConfirmationSections(sql)
    .find((s) => s.heading.startsWith(prefix))
    .lines.join("\n");

test("197: 適用前後の確認・posted の X だけに時刻と理由・計測の pending を閉じる・何度呼んでも同じ・不一致は拒否・権限", async () => {
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
