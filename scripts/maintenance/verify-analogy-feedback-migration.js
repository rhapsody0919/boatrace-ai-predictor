/**
 * verify-analogy-feedback-migration.js - マイグレーション143（龍神ソナーの画面の中の声: analogy_feedback）の検証。
 * インメモリの Postgres（PGlite）に本番と同じロール・076 の既定権限・races の縮約版を作り、
 * docs/db-migration/143_analogy_feedback.sql を適用して次を確かめる。本番 DB には接続しない。
 *
 *   (a) RLS が有効で、ポリシーは INSERT の1本だけ
 *   (b) anon は INSERT できる（フロントと同じ列だけを渡す）。SELECT・UPDATE・DELETE はできない
 *   (c) 同じ client_key・race_id・kind は2行目を拒否する（vote と detail は別に1行ずつ書ける）
 *   (d) CHECK: 列挙値・一言の長さ・理由の部分集合・理由と一言の置き場所
 *   (e) races に無い race_id は書けない（外部キー）
 *   (f) created_at は送った値でなく now() になる（制限の窓を外せない）
 *   (g) 連投の制限: 同じ client_key は24時間で40行まで
 *   (h) 2回適用しても失敗しない（冪等）
 *   (i) ロールバック SQL（末尾のコメント）で表と関数が消える
 *
 * 実行: node scripts/maintenance/verify-analogy-feedback-migration.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = path.join(
  __dirname,
  "../../docs/db-migration/143_analogy_feedback.sql",
);
const sql = fs.readFileSync(MIGRATION, "utf8");

const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- 076: postgres が作る新規テーブルに anon・authenticated の権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
CREATE TABLE public.races (race_id varchar PRIMARY KEY);
INSERT INTO public.races VALUES ('2026-10-08-01-12'), ('2026-10-08-01-11');
`;

const KEY = "00000000-0000-4000-8000-000000000001";
const COLS =
  "(kind, race_id, verdict, reasons, comment, analogy_stage, analogy_tab, lang, client_key)";
const row = ({
  kind = "vote",
  race = "2026-10-08-01-12",
  verdict = "useful",
  reasons = "NULL",
  comment = "NULL",
  stage = "exhibition",
  tab = "facts",
  lang = "ja",
  key = KEY,
} = {}) =>
  `INSERT INTO public.analogy_feedback ${COLS} VALUES ('${kind}', '${race}', '${verdict}', ${reasons}, ${comment}, '${stage}', '${tab}', '${lang}', '${key}')`;

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

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

const rollbackSql = sql
  .match(/-- ROLLBACK-BEGIN\n([\s\S]*?)-- ROLLBACK-END/)?.[1]
  .split("\n")
  .map((l) => l.replace(/^-- ?/, ""))
  .join("\n");

const db = new PGlite();
await db.exec(FIXTURE_SQL);
await db.exec(sql);

// (a)
const rls = await db.query(
  "SELECT relrowsecurity FROM pg_class WHERE oid = 'public.analogy_feedback'::regclass",
);
check("(a) RLS が有効", rls.rows[0]?.relrowsecurity === true);
const pol = await db.query(
  "SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public.analogy_feedback'::regclass",
);
check(
  "(a) ポリシーは INSERT の1本だけ",
  pol.rows.length === 1 && pol.rows[0].polcmd === "a",
  JSON.stringify(pol.rows),
);

// (b)
check(
  "(b) anon は vote を INSERT できる",
  (await asRole(db, "anon", row())) === null,
);
check(
  "(b) anon は detail（理由・一言つき）を INSERT できる",
  (await asRole(
    db,
    "anon",
    row({
      kind: "detail",
      verdict: "lacking",
      reasons: "ARRAY['few_races','other']",
      comment: "'風向きと水位もそろえて数えてほしい'",
    }),
  )) === null,
);
for (const [op, q] of [
  ["SELECT", "SELECT * FROM public.analogy_feedback"],
  ["UPDATE", "UPDATE public.analogy_feedback SET verdict = 'useful'"],
  ["DELETE", "DELETE FROM public.analogy_feedback"],
]) {
  const err = await asRole(db, "anon", q);
  check(
    `(b) anon は ${op} できない`,
    err !== null && /permission denied/.test(err.message),
    err?.message ?? "成功してしまった",
  );
}

// (c)
const dup = await asRole(db, "anon", row({ verdict: "lacking" }));
check(
  "(c) 同じブラウザ・同じレースの vote は2行目を拒否する",
  dup !== null && /analogy_feedback_once|duplicate/.test(dup.message),
  dup?.message ?? "成功してしまった",
);

// (d)
const bad = [
  ["未知の kind", row({ kind: "other", race: "2026-10-08-01-11" })],
  ["未知の verdict", row({ verdict: "bad", race: "2026-10-08-01-11" })],
  ["未知の stage", row({ stage: "result", race: "2026-10-08-01-11" })],
  ["未知の tab", row({ tab: "x", race: "2026-10-08-01-11" })],
  ["未知の lang", row({ lang: "fr", race: "2026-10-08-01-11" })],
  [
    "一言が201文字",
    row({
      kind: "detail",
      race: "2026-10-08-01-11",
      comment: `'${"あ".repeat(201)}'`,
    }),
  ],
  [
    "一言が空文字",
    row({ kind: "detail", race: "2026-10-08-01-11", comment: "''" }),
  ],
  ["vote に一言", row({ race: "2026-10-08-01-11", comment: "'ひとこと'" })],
  [
    "vote に理由",
    row({
      race: "2026-10-08-01-11",
      verdict: "lacking",
      reasons: "ARRAY['few_races']",
    }),
  ],
  [
    "useful に理由",
    row({
      kind: "detail",
      race: "2026-10-08-01-11",
      reasons: "ARRAY['few_races']",
    }),
  ],
  [
    "決まっていない理由",
    row({
      kind: "detail",
      race: "2026-10-08-01-11",
      verdict: "lacking",
      reasons: "ARRAY['spam']",
    }),
  ],
  [
    "空の理由配列",
    row({
      kind: "detail",
      race: "2026-10-08-01-11",
      verdict: "lacking",
      reasons: "ARRAY[]::text[]",
    }),
  ],
];
for (const [label, q] of bad) {
  check(`(d) CHECK で拒否: ${label}`, (await asRole(db, "anon", q)) !== null);
}
check(
  "(d) 一言は200文字なら書ける",
  (await asRole(
    db,
    "anon",
    row({
      kind: "detail",
      race: "2026-10-08-01-11",
      comment: `'${"あ".repeat(200)}'`,
    }),
  )) === null,
);

// (e)
check(
  "(e) races に無い race_id は書けない",
  (await asRole(db, "anon", row({ race: "2099-01-01-01-01" }))) !== null,
);

// (f)
const KEY2 = "00000000-0000-4000-8000-000000000002";
await asRole(
  db,
  "anon",
  `INSERT INTO public.analogy_feedback ${COLS.replace("(kind", "(created_at, kind")} VALUES ('2000-01-01', 'vote', '2026-10-08-01-12', 'useful', NULL, NULL, 'racecard', 'facts', 'en', '${KEY2}')`,
);
const ts = await db.query(
  `SELECT created_at > now() - interval '1 minute' AS fresh FROM public.analogy_feedback WHERE client_key = '${KEY2}'`,
);
check(
  "(f) 送った created_at は now() に置き換わる",
  ts.rows[0]?.fresh === true,
);

// (g) 同じ client_key で40行まで（レースを足して別の行にする）
const KEY3 = "00000000-0000-4000-8000-000000000003";
const extra = Array.from(
  { length: 41 },
  (_, i) => `('2026-10-09-02-${String(i).padStart(2, "0")}')`,
).join(",");
await db.exec(`INSERT INTO public.races VALUES ${extra}`);
let lastErr = null;
let ok = 0;
for (let i = 0; i < 41; i++) {
  lastErr = await asRole(
    db,
    "anon",
    row({ key: KEY3, race: `2026-10-09-02-${String(i).padStart(2, "0")}` }),
  );
  if (lastErr === null) ok++;
}
check(
  "(g) 同じブラウザは24時間で40行まで（41行目を拒否）",
  ok === 40 && /too many from this client/.test(lastErr?.message ?? ""),
  `${ok}行 ${lastErr?.message ?? ""}`,
);

// (h)
let reapply = null;
try {
  await db.exec(sql);
} catch (e) {
  reapply = e;
}
check("(h) 2回適用しても失敗しない", reapply === null, reapply?.message);

// (i)
await db.exec(rollbackSql);
const gone = await db.query(
  "SELECT to_regclass('public.analogy_feedback') AS t, to_regproc('public.analogy_feedback_guard') AS f",
);
check(
  "(i) ロールバックで表と関数が消える",
  gone.rows[0].t === null && gone.rows[0].f === null,
);

if (failures) {
  console.error(`\n${failures} 件の検査が失敗`);
  process.exit(1);
}
console.log("\nすべての検査が通った");
