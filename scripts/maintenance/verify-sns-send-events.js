// SNS の送信で送らなかった理由の表 sns_send_events（マイグレーション 191、BOA-1201）の再現テスト。
// 191 を PGlite に当て、冒頭の確認の SQL（db-apply が job summary に出す節）・権限・UNIQUE と ON CONFLICT DO NOTHING・
// job の削除での CASCADE・CHECK・hq の読み方の SQL・戻し方を確かめる。外部接続なし。
// sns_x_send_jobs は 191 と hq の読み方が使う列だけの土台（137 の本物の表への外部キーは verify-sns-send-runner.js が当てる）
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { extractConfirmationSections } from "../lib/dbApplySql.js";

const sql = await readFile(
  new URL("../../docs/db-migration/191_sns_send_events.sql", import.meta.url),
  "utf8",
);
const sections = extractConfirmationSections(sql);
const sectionSql = (prefix) => {
  const found = sections.find((s) => s.heading.startsWith(prefix));
  assert.ok(found, `冒頭に「${prefix}」の節がある`);
  return found.lines.join("\n");
};
// 冒頭の「見出し:」の後の字下げした行（確認の節以外: hq の読み方・戻し方）
const headerBlock = (prefix) => {
  const lines = sql.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`-- ${prefix}`));
  assert.ok(start >= 0, `冒頭に「${prefix}」がある`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (!/^--\s{2,}\S/.test(line)) break;
    body.push(line.replace(/^--\s{3}/, ""));
  }
  return body.join("\n");
};

const db = new PGlite();
const one = async (query, args = []) => (await db.query(query, args)).rows[0];
const fails = async (query, args = []) =>
  db.query(query, args).then(
    () => null,
    (e) => e,
  );
async function asRole(role, query, args = []) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fails(query, args);
  } finally {
    await db.exec("RESET ROLE");
  }
}
const newJob = async () =>
  (await one("INSERT INTO public.sns_x_send_jobs DEFAULT VALUES RETURNING id"))
    .id;
const count = async () =>
  Number((await one("SELECT count(*) n FROM public.sns_send_events")).n);

before(async () => {
  // Supabase の既定の権限（anon・authenticated・service_role に全部）と 166 の claude_ro の SELECT を再現し、
  // 191 の REVOKE が anon・authenticated から外すことを確かめる
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE claude_ro;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO claude_ro;
    CREATE TABLE public.sns_x_send_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      channel text NOT NULL DEFAULT 'x',
      state text NOT NULL DEFAULT 'queued',
      error_code text,
      approved_at timestamptz NOT NULL DEFAULT now()
    );`);
});
after(() => db.close());

test("適用前の確認: 表が無く、sns_x_send_jobs.id は uuid", async () => {
  assert.deepEqual(await one(sectionSql("適用前の確認")), {
    events: null,
    job_id_type: "uuid",
  });
});

test("191 を当てると、適用後の確認が期待値どおり（RLS・anon と authenticated は不可・service_role は SELECT と INSERT・claude_ro は SELECT）", async () => {
  await db.exec(sql);
  assert.deepEqual(await one(sectionSql("適用後の確認")), {
    rls: true,
    anon_select: false,
    auth_insert: false,
    service_insert: true,
    service_select: true,
    ro_select: true,
  });
});

test("anon・authenticated は INSERT も SELECT も拒まれ、service_role は書ける", async () => {
  const job = await newJob();
  const insert =
    "INSERT INTO public.sns_send_events(job_id,stage,reason) VALUES($1,'precheck','source_changed')";
  for (const role of ["anon", "authenticated"]) {
    assert.match(
      (await asRole(role, insert, [job]))?.message ?? "",
      /permission denied/,
    );
    assert.match(
      (await asRole(role, "SELECT * FROM public.sns_send_events"))?.message ??
        "",
      /permission denied/,
    );
  }
  assert.equal(await asRole("service_role", insert, [job]), null);
  assert.equal(
    await asRole("claude_ro", "SELECT * FROM public.sns_send_events"),
    null,
  );
  assert.match(
    (await asRole("claude_ro", insert, [job]))?.message ?? "",
    /permission denied/,
  );
});

test("UNIQUE (job_id, stage, reason): ON CONFLICT DO NOTHING は行を増やさず、段・理由が違えば別の行", async () => {
  await db.exec("DELETE FROM public.sns_send_events");
  const job = await newJob();
  const upsert =
    "INSERT INTO public.sns_send_events(job_id,stage,reason,detail) VALUES($1,$2,$3,$4) ON CONFLICT (job_id,stage,reason) DO NOTHING";
  for (let i = 0; i < 3; i++)
    await db.query(upsert, [job, "precheck", "source_changed", `回 ${i}`]);
  assert.equal(await count(), 1);
  // 初出の detail のまま
  assert.equal(
    (await one("SELECT detail FROM public.sns_send_events")).detail,
    "回 0",
  );
  await db.query(upsert, [job, "send", "source_changed", null]);
  await db.query(upsert, [job, "precheck", "deadline_expired", null]);
  assert.equal(await count(), 3);
  // ON CONFLICT の無い INSERT は一意の違反で落ちる（PostgREST の ignore-duplicates が要る理由）
  assert.match(
    (
      await fails(
        "INSERT INTO public.sns_send_events(job_id,stage,reason) VALUES($1,'precheck','source_changed')",
        [job],
      )
    )?.message ?? "",
    /duplicate key/,
  );
});

test("job を消すと理由の行も消える（ON DELETE CASCADE）。無い job への行は入らない", async () => {
  const job = await newJob();
  await db.query(
    "INSERT INTO public.sns_send_events(job_id,stage,reason) VALUES($1,'send','public_component_missing')",
    [job],
  );
  const before = await count();
  await db.query("DELETE FROM public.sns_x_send_jobs WHERE id=$1", [job]);
  assert.equal(await count(), before - 1);
  assert.match(
    (
      await fails(
        "INSERT INTO public.sns_send_events(job_id,stage,reason) VALUES(gen_random_uuid(),'send','x')",
      )
    )?.message ?? "",
    /foreign key/,
  );
});

test("CHECK: stage は precheck・send だけ、reason は英小文字と _ の1〜64字、detail は300字まで（NULL 可）", async () => {
  const job = await newJob();
  const insert = (stage, reason, detail = null) =>
    fails(
      "INSERT INTO public.sns_send_events(job_id,stage,reason,detail) VALUES($1,$2,$3,$4)",
      [job, stage, reason, detail],
    );
  assert.match((await insert("claim", "a"))?.message ?? "", /check/);
  for (const bad of [
    "",
    "Source_changed",
    "youtube-preflight",
    "http_403",
    "a".repeat(65),
  ])
    assert.match(
      (await insert("send", bad))?.message ?? "",
      /check/,
      `reason ${JSON.stringify(bad)}`,
    );
  assert.equal(await insert("send", "a".repeat(64)), null);
  assert.equal(await insert("send", "detail_ok", "あ".repeat(300)), null);
  assert.match(
    (await insert("send", "detail_long", "あ".repeat(301)))?.message ?? "",
    /check/,
  );
  assert.equal(await insert("precheck", "detail_null"), null);
});

test("hq の読み方: 理由と job を並べ、再承認より前の行に before_reapproval が付く", async () => {
  await db.exec("DELETE FROM public.sns_send_events");
  const old = await newJob();
  const fresh = await newJob();
  await db.query(
    "INSERT INTO public.sns_send_events(job_id,stage,reason,at) VALUES($1,'precheck','source_changed',now()-interval '2 hours'),($2,'send','public_component_missing',now()-interval '1 minute')",
    [old, fresh],
  );
  // old は1時間前に再承認された（177 の ON CONFLICT(draft_id) DO UPDATE が approved_at を進める）
  await db.query(
    "UPDATE public.sns_x_send_jobs SET approved_at=now()-interval '1 hour' WHERE id=$1",
    [old],
  );
  await db.query(
    "UPDATE public.sns_x_send_jobs SET approved_at=now()-interval '3 hours' WHERE id=$1",
    [fresh],
  );
  const rows = (await db.query(headerBlock("hq の読み方"))).rows;
  assert.deepEqual(
    rows.map((r) => [r.job_id, r.stage, r.reason, r.before_reapproval]),
    [
      [fresh, "send", "public_component_missing", false],
      [old, "precheck", "source_changed", true],
    ],
  );
});

test("戻し方: 表を消せる（sns_x_send_jobs は残る）", async () => {
  await db.exec(headerBlock("戻し方"));
  assert.equal(
    (await one("SELECT to_regclass('public.sns_send_events') r")).r,
    null,
  );
  assert.ok(
    (await one("SELECT to_regclass('public.sns_x_send_jobs') r")).r !== null,
  );
});
