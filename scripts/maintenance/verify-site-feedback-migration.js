/**
 * verify-site-feedback-migration.js - マイグレーション205（サイト全体のご意見ボックス: site_feedback）の検証。
 * インメモリの Postgres（PGlite）に本番と同じロール・076 と 166 の既定権限を作り、
 * docs/db-migration/205_site_feedback.sql を適用して次を確かめる。本番 DB には接続しない。
 *
 *   (a) RLS が有効で、ポリシーは INSERT の1本だけ
 *   (b) anon は INSERT できる。SELECT・UPDATE・DELETE はできない。claude_ro は読めない（オーナー 2026-11-23）
 *   (c) 画面が送る列挙値（種類・ページの種類・言語・満足度 1〜5）は全部入る。種類・満足度は NULL でも入る
 *   (d) CHECK: 列挙の外・空・空白だけ・501文字・満足度 0 と 6 は入らない。500文字は入る
 *   (e) created_at は送った値でなく now() になる（制限の窓を外せない）
 *   (f) 連投の制限: 同じ client_key は24時間で10行まで、全体は10分で30行まで
 *   (g) 2回適用しても失敗しない（冪等）
 *   (h) ロールバック SQL（末尾のコメント）で表と関数が消える
 *
 * 画面の列挙（src/pure/siteFeedback.js）との突き合わせは、画面の PR の verify-site-feedback.js が行う
 * （この PR は画面より先に当てるので、画面のファイルをまだ持たない）。ここに書く列挙は画面の決まりの写し。
 *
 * 実行: node scripts/maintenance/verify-site-feedback-migration.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/205_site_feedback.sql",
);
const sql = fs.readFileSync(MIGRATION, "utf8");
const rollbackSql = sql
  .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
  .split("\n")
  .map((l) => l.replace(/^-- ?/, ""))
  .join("\n");

// 画面の決まり（src/pure/siteFeedback.js）の写し
const KINDS = ["feature", "usability", "data", "other"];
const PAGE_TYPES = [
  "home",
  "today",
  "race",
  "racer",
  "venue",
  "analysis",
  "blog",
  "guide",
  "other",
];
const LANGS = ["ja", "en", "zh-TW", "ko"];
const MAX_COMMENT = 500;

const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE claude_ro NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, claude_ro;
-- 076: postgres が作る新規テーブルに anon・authenticated の権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
-- Supabase の既定: service_role は新しい表を全部使える
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
-- 166: claude_ro は新しい public の表を既定で読める（この表では 205 が外す）
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO claude_ro;
`;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const lit = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const key = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const BASE = {
  kind: "feature",
  comment: "モーターの成績も見たい",
  rating: 4,
  page_type: "race",
  lang: "ja",
  client_key: key(1),
};
const insert = (row) =>
  `INSERT INTO public.site_feedback (kind, comment, rating, page_type, lang, client_key) VALUES (${lit(row.kind)}, ${lit(row.comment)}, ${row.rating ?? "NULL"}, ${lit(row.page_type)}, ${lit(row.lang)}, ${lit(row.client_key)})`;

async function asRole(db, role, query) {
  await db.exec(`SET ROLE ${role}`);
  try {
    await db.query(query);
    return null;
  } catch (e) {
    return e;
  } finally {
    await db.exec("RESET ROLE");
  }
}
const count = async (db) =>
  Number(
    (await db.query("SELECT count(*) AS n FROM public.site_feedback")).rows[0]
      .n,
  );

const db = new PGlite();
await db.exec(FIXTURE_SQL);
await db.exec(sql);

// (a)
const rls = await db.query(
  "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_feedback'::regclass",
);
check("(a) RLS が有効", rls.rows[0]?.relrowsecurity === true);
const pol = await db.query(
  "SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.site_feedback'::regclass",
);
check(
  "(a) ポリシーは INSERT の1本だけ",
  pol.rows.length === 1 && pol.rows[0].polcmd === "a",
  JSON.stringify(pol.rows),
);

// (b)
check(
  "(b) anon は画面と同じ列の1行を INSERT できる",
  (await asRole(db, "anon", insert(BASE))) === null,
);
for (const [op, q] of [
  ["SELECT", "SELECT * FROM public.site_feedback"],
  ["UPDATE", "UPDATE public.site_feedback SET comment = 'x'"],
  ["DELETE", "DELETE FROM public.site_feedback"],
]) {
  const err = await asRole(db, "anon", q);
  check(
    `(b) anon は ${op} できない`,
    err !== null && /permission denied/.test(err.message),
    err?.message ?? "成功してしまった",
  );
}
const privs = await db.query(`SELECT
  has_table_privilege('claude_ro', 'public.site_feedback', 'SELECT') AS claude_ro_select,
  has_table_privilege('service_role', 'public.site_feedback', 'SELECT') AS service_select,
  has_table_privilege('service_role', 'public.site_feedback', 'DELETE') AS service_delete`);
check(
  "(b) claude_ro は読めない（既定の権限を 205 が外す）",
  privs.rows[0].claude_ro_select === false,
);
{
  const err = await asRole(
    db,
    "claude_ro",
    "SELECT * FROM public.site_feedback",
  );
  check(
    "(b) claude_ro の SELECT は拒否される",
    err !== null && /permission denied/.test(err.message),
    err?.message ?? "読めてしまった",
  );
}
check(
  "(b) service_role は読めて、荒らしの行を消せる",
  privs.rows[0].service_select === true &&
    privs.rows[0].service_delete === true,
);

// (c) 列挙値は全部入る（制限に当たらないよう client_key を1行ごとに変え、created_at を過去へずらす）
let seq = 100;
const insertFresh = async (row) => {
  const err = await asRole(
    db,
    "anon",
    insert({ ...row, client_key: key(seq++) }),
  );
  await db.exec(
    "UPDATE public.site_feedback SET created_at = now() - interval '2 days'",
  );
  return err;
};
for (const k of [...KINDS, null]) {
  const err = await insertFresh({ ...BASE, kind: k });
  check(`(c) 種類 ${k} は入る`, err === null, err?.message);
}
for (const p of PAGE_TYPES) {
  const err = await insertFresh({ ...BASE, page_type: p });
  check(`(c) ページの種類 ${p} は入る`, err === null, err?.message);
}
for (const l of LANGS) {
  const err = await insertFresh({ ...BASE, lang: l });
  check(`(c) 言語 ${l} は入る`, err === null, err?.message);
}
for (const r of [null, 1, 2, 3, 4, 5]) {
  const err = await insertFresh({ ...BASE, rating: r });
  check(`(c) 満足度 ${r} は入る`, err === null, err?.message);
}
{
  const err = await insertFresh({ ...BASE, comment: "あ".repeat(MAX_COMMENT) });
  check("(c) 500文字の内容は入る", err === null, err?.message);
}

// (d)
for (const [label, bad, constraint] of [
  ["決まりに無い種類", { kind: "bug" }, "site_feedback_kind"],
  ["空の内容", { comment: "" }, "site_feedback_comment"],
  ["空白だけの内容", { comment: "  \n\t " }, "site_feedback_comment"],
  ["全角の空白だけの内容", { comment: "　　" }, "site_feedback_comment"],
  [
    "501文字の内容",
    { comment: "あ".repeat(MAX_COMMENT + 1) },
    "site_feedback_comment",
  ],
  ["満足度 0", { rating: 0 }, "site_feedback_rating"],
  ["満足度 6", { rating: 6 }, "site_feedback_rating"],
  [
    "決まりに無いページの種類",
    { page_type: "admin" },
    "site_feedback_page_type",
  ],
  ["決まりに無い言語", { lang: "fr" }, "site_feedback_lang"],
]) {
  const err = await insertFresh({ ...BASE, ...bad });
  check(
    `(d) ${label} は入らない（制約 ${constraint}）`,
    err !== null && err.message.includes(constraint),
    err?.message ?? "成功してしまった",
  );
}
{
  const err = await asRole(
    db,
    "anon",
    insert({ ...BASE, client_key: "not-a-uuid" }),
  );
  check(
    "(d) uuid の形でない識別番号は入らない",
    err !== null && /uuid/.test(err.message),
    err?.message ?? "成功してしまった",
  );
}

// (e)
await db.exec("DELETE FROM public.site_feedback");
await asRole(
  db,
  "anon",
  `INSERT INTO public.site_feedback (created_at, comment, page_type, lang, client_key) VALUES ('2000-01-01', 'x', 'home', 'ja', '${key(1)}')`,
);
const ts = await db.query(
  "SELECT created_at > now() - interval '1 minute' AS fresh FROM public.site_feedback",
);
check("(e) created_at は now() に上書きされる", ts.rows[0]?.fresh === true);

// (f) 同じ client_key は24時間で10行まで
await db.exec("DELETE FROM public.site_feedback");
let perClientErr = null;
for (let i = 0; i < 10; i++)
  perClientErr ??= await asRole(
    db,
    "anon",
    insert({ ...BASE, client_key: key(2) }),
  );
check(
  "(f) 同じブラウザの10行目までは入る",
  perClientErr === null,
  perClientErr?.message,
);
const eleventh = await asRole(
  db,
  "anon",
  insert({ ...BASE, client_key: key(2) }),
);
check(
  "(f) 同じブラウザの11行目は拒否する",
  eleventh !== null && /too many from this client/.test(eleventh.message),
  eleventh?.message ?? "成功してしまった",
);
await db.exec(
  "UPDATE public.site_feedback SET created_at = now() - interval '25 hours'",
);
check(
  "(f) 24時間より前の行は数に入れない",
  (await asRole(db, "anon", insert({ ...BASE, client_key: key(2) }))) === null,
);

// (f) 全体は10分で30行まで（client_key を毎回変えても止まる）
await db.exec("DELETE FROM public.site_feedback");
let overallErr = null;
for (let i = 0; i < 30; i++)
  overallErr ??= await asRole(
    db,
    "anon",
    insert({ ...BASE, client_key: key(1000 + i) }),
  );
check("(f) 全体の30行目までは入る", overallErr === null, overallErr?.message);
const thirtyFirst = await asRole(
  db,
  "anon",
  insert({ ...BASE, client_key: key(2000) }),
);
check(
  "(f) 全体の31行目は拒否する",
  thirtyFirst !== null && /too many overall/.test(thirtyFirst.message),
  thirtyFirst?.message ?? "成功してしまった",
);
check("(f) 拒否した行は入っていない", (await count(db)) === 30);
await db.exec(
  "UPDATE public.site_feedback SET created_at = now() - interval '11 minutes'",
);
check(
  "(f) 10分より前の行は全体の数に入れない",
  (await asRole(db, "anon", insert({ ...BASE, client_key: key(3000) }))) ===
    null,
);

// (g)
const before = await count(db);
let twice = null;
try {
  await db.exec(sql);
} catch (e) {
  twice = e;
}
check("(g) 2回適用しても失敗しない", twice === null, twice?.message);
check("(g) 2回目の適用で行は消えない", (await count(db)) === before);
check(
  "(g) 2回目の適用の後も claude_ro は読めない",
  (
    await db.query(
      "SELECT has_table_privilege('claude_ro', 'public.site_feedback', 'SELECT') AS s",
    )
  ).rows[0].s === false,
);

// (h)
check("(h) ロールバック SQL がある", !!rollbackSql?.includes("DROP TABLE"));
await db.exec(rollbackSql);
const gone = await db.query(
  "SELECT to_regclass('public.site_feedback') AS t, to_regprocedure('public.site_feedback_guard()') AS f",
);
check(
  "(h) ロールバックで表と関数が消える",
  gone.rows[0].t === null && gone.rows[0].f === null,
  JSON.stringify(gone.rows[0]),
);

await db.close();
if (failures > 0) {
  console.error(`\nverify-site-feedback-migration: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback-migration: OK");
