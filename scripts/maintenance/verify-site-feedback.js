/**
 * verify-site-feedback.js - サイト全体のご意見ボックス（src/pure/siteFeedback.js と表の案）の検証。
 *
 * 1. 画面の決まり（src/pure/siteFeedback.js）: ページの種類・出さない画面・送る1行の形
 * 2. 表の案（docs/design/site-feedback-box/db-draft.md の SQL）をインメモリの Postgres（PGlite）に当て、
 *    画面が作る値が全部入り、決まりの外は入らないことを確かめる。本番 DB には接続しない。
 *    (a) RLS が有効で、ポリシーは INSERT の1本だけ
 *    (b) anon は INSERT できる。SELECT・UPDATE・DELETE はできない
 *    (c) 画面の列挙値（種類・ページの種類・言語・満足度 1〜5）は全部入る。種類・満足度は NULL でも入る
 *    (d) CHECK: 列挙の外・空の内容・501文字・満足度 0 と 6 は入らない。500文字は入る
 *    (e) created_at は送った値でなく now() になる（制限の窓を外せない）
 *    (f) 連投の制限: 同じ client_key は24時間で10行まで、全体は10分で30行まで
 *    (g) 2回適用しても失敗しない（冪等）
 *    (h) 戻しの SQL で表と関数が消える
 *
 * 実行: node scripts/maintenance/verify-site-feedback.js（@electric-sql/pglite は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  FEEDBACK_KINDS,
  FEEDBACK_LANGS,
  FEEDBACK_MAX_COMMENT,
  FEEDBACK_MAX_RATING,
  FEEDBACK_PAGE_TYPES,
  buildSiteFeedbackRow,
  canSendFeedback,
  feedbackPageType,
  isFeedbackHiddenPath,
} from "../../src/pure/siteFeedback.js";
import { newUuidV4, readOrCreateClientKey } from "../../src/pure/clientKey.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFT = path.join(
  __dirname,
  "../../docs/design/site-feedback-box/db-draft.md",
);
const draft = fs.readFileSync(DRAFT, "utf8");
const between = (name) => {
  const m = draft.match(
    new RegExp(`-- ${name}-begin\\n([\\s\\S]*?)-- ${name}-end`),
  );
  if (!m) throw new Error(`db-draft.md に ${name} の SQL が無い`);
  return m[1];
};
const sql = between("site-feedback-draft");
const rollbackSql = between("site-feedback-rollback");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}
const throws = (fn) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

// ---- 1. 画面の決まり ----
const PAGE_CASES = [
  ["/", "home"],
  ["/en/", "home"],
  ["/en", "home"],
  ["/today", "today"],
  ["/race/2026-11-23-01-03", "race"],
  ["/zh-TW/race/2026-11-23-01-03", "race"],
  ["/races/2026-11-23", "race"],
  ["/racer/4444", "racer"],
  ["/racers", "racer"],
  ["/venue/12", "venue"],
  ["/en/venues/kiryu", "venue"],
  ["/winning-technique", "analysis"],
  ["/outcome-distribution", "analysis"],
  ["/accuracy/history", "analysis"],
  ["/hit-races", "analysis"],
  ["/blog/odds-expected-value-guide", "blog"],
  ["/ko/blog", "blog"],
  ["/guide", "guide"],
  ["/how-to-use", "guide"],
  ["/faq", "guide"],
  ["/privacy", "other"],
  ["/contact", "other"],
  ["/constructor", "other"],
  ["", "home"],
];
for (const [p, want] of PAGE_CASES)
  check(
    `ページの種類: ${p || "(空)"} → ${want}`,
    feedbackPageType(p) === want,
    feedbackPageType(p),
  );
check(
  "ページの種類は決まりの値だけを返す",
  PAGE_CASES.every(([p]) => FEEDBACK_PAGE_TYPES.includes(feedbackPageType(p))),
);

const HIDDEN_CASES = [
  ["/admin/rules", true],
  ["/admin", true],
  ["/share/today-sheet", true],
  ["/race/2026-11-23-01-03/assist", true],
  ["/en/race/2026-11-23-01-03/assist", true],
  ["/race/2026-11-23-01-03", false],
  ["/", false],
  ["/administrator", false],
  ["/blog/share-tips", false],
];
for (const [p, want] of HIDDEN_CASES)
  check(
    `出さない画面: ${p} → ${want}`,
    isFeedbackHiddenPath(p) === want,
    String(isFeedbackHiddenPath(p)),
  );

check(
  "空・空白だけは送れない",
  !canSendFeedback("") && !canSendFeedback("  \n "),
);
check("1文字は送れる", canSendFeedback("a"));
check(
  "500文字は送れ、501文字は送れない",
  canSendFeedback("あ".repeat(FEEDBACK_MAX_COMMENT)) &&
    !canSendFeedback("あ".repeat(FEEDBACK_MAX_COMMENT + 1)),
);

const KEY = "00000000-0000-4000-8000-000000000001";
const base = {
  kind: "feature",
  comment: "  モーターの成績も見たい  ",
  rating: 4,
  pathname: "/en/race/2026-11-23-01-03",
  lang: "en",
  clientKey: KEY,
};
const built = buildSiteFeedbackRow(base);
check(
  "送る1行: 前後の空白を除き、URL でなくページの種類を入れる",
  JSON.stringify(built) ===
    JSON.stringify({
      kind: "feature",
      comment: "モーターの成績も見たい",
      rating: 4,
      page_type: "race",
      lang: "en",
      client_key: KEY,
    }),
  JSON.stringify(built),
);
const bare = buildSiteFeedbackRow({ ...base, kind: null, rating: null });
check(
  "送る1行: 種類・満足度を選ばなければ null",
  bare.kind === null && bare.rating === null,
);
check(
  "送る1行: 決まりに無い言語は ja にする",
  buildSiteFeedbackRow({ ...base, lang: "fr" }).lang === "ja",
);
for (const [label, bad] of [
  ["空の内容", { comment: "   " }],
  ["決まりに無い種類", { kind: "bug" }],
  ["満足度 0", { rating: 0 }],
  ["満足度 6", { rating: 6 }],
  ["満足度が小数", { rating: 2.5 }],
  ["識別番号なし", { clientKey: "" }],
])
  check(
    `送る1行: ${label} は投げる`,
    throws(() => buildSiteFeedbackRow({ ...base, ...bad })),
  );

// ---- 1b. ブラウザごとの識別番号（src/pure/clientKey.js。龍神ソナーの声と共通） ----
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
check("識別番号: uuid v4 の形", UUID_V4.test(newUuidV4()));
{
  // crypto.randomUUID が無い古いブラウザの道（getRandomValues から作る）
  const original = crypto.randomUUID;
  crypto.randomUUID = undefined;
  let made;
  try {
    made = [newUuidV4(), newUuidV4()];
  } finally {
    crypto.randomUUID = original;
  }
  check(
    "識別番号: randomUUID が無くても uuid v4 の形で、毎回違う",
    made.every((u) => UUID_V4.test(u)) && made[0] !== made[1],
    made.join(" "),
  );
}
{
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
  };
  const first = readOrCreateClientKey("boatai-user:x", () => storage);
  check(
    "識別番号: 無ければ作って保存し、2回目は同じ値を返す",
    UUID_V4.test(first) &&
      map.get("boatai-user:x") === first &&
      readOrCreateClientKey("boatai-user:x", () => storage) === first,
  );
  check(
    "識別番号: 保存の鍵が違えば別の値",
    readOrCreateClientKey("boatai-user:y", () => storage) !== first,
  );
  const broken = () => {
    throw new Error("SecurityError");
  };
  check(
    "識別番号: 保存できない環境でも投げず、uuid v4 を返す",
    UUID_V4.test(readOrCreateClientKey("boatai-user:x", broken)) &&
      UUID_V4.test(
        readOrCreateClientKey("boatai-user:x", () => ({
          getItem: () => null,
          setItem: broken,
        })),
      ),
  );
}

// ---- 2. 表の案 ----
const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- 076: postgres が作る新規テーブルに anon・authenticated の権限を付けない
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
`;
const lit = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const insert = (row) =>
  `INSERT INTO public.site_feedback (kind, comment, rating, page_type, lang, client_key) VALUES (${lit(row.kind)}, ${lit(row.comment)}, ${row.rating ?? "NULL"}, ${lit(row.page_type)}, ${lit(row.lang)}, ${lit(row.client_key)})`;
const key = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

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
  "(b) anon は画面が作った1行を INSERT できる",
  (await asRole(db, "anon", insert(built))) === null,
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

// (c) 画面の列挙値は全部入る（制限に当たらないよう client_key を1行ごとに変え、created_at を過去へずらす）
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
const okRow = { ...built };
for (const k of [...FEEDBACK_KINDS, null]) {
  const err = await insertFresh({ ...okRow, kind: k });
  check(`(c) 種類 ${k} は入る`, err === null, err?.message);
}
for (const p of FEEDBACK_PAGE_TYPES) {
  const err = await insertFresh({ ...okRow, page_type: p });
  check(`(c) ページの種類 ${p} は入る`, err === null, err?.message);
}
for (const l of FEEDBACK_LANGS) {
  const err = await insertFresh({ ...okRow, lang: l });
  check(`(c) 言語 ${l} は入る`, err === null, err?.message);
}
for (const r of [
  null,
  ...Array.from({ length: FEEDBACK_MAX_RATING }, (_, i) => i + 1),
]) {
  const err = await insertFresh({ ...okRow, rating: r });
  check(`(c) 満足度 ${r} は入る`, err === null, err?.message);
}
{
  const err = await insertFresh({
    ...okRow,
    comment: "あ".repeat(FEEDBACK_MAX_COMMENT),
  });
  check("(c) 500文字の内容は入る", err === null, err?.message);
}

// (d)
for (const [label, bad] of [
  ["決まりに無い種類", { kind: "bug" }],
  ["空の内容", { comment: "" }],
  ["501文字の内容", { comment: "あ".repeat(FEEDBACK_MAX_COMMENT + 1) }],
  ["満足度 0", { rating: 0 }],
  ["満足度 6", { rating: 6 }],
  ["決まりに無いページの種類", { page_type: "admin" }],
  ["決まりに無い言語", { lang: "fr" }],
]) {
  const err = await insertFresh({ ...okRow, ...bad });
  check(
    `(d) ${label} は入らない`,
    err !== null && /check constraint/.test(err.message),
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
    insert({ ...okRow, client_key: key(2) }),
  );
check(
  "(f) 同じブラウザの10行目までは入る",
  perClientErr === null,
  perClientErr?.message,
);
const eleventh = await asRole(
  db,
  "anon",
  insert({ ...okRow, client_key: key(2) }),
);
check(
  "(f) 同じブラウザの11行目は拒否する",
  eleventh !== null && /too many from this client/.test(eleventh.message),
  eleventh?.message ?? "成功してしまった",
);
// 25時間前の行は数えない
await db.exec(
  "UPDATE public.site_feedback SET created_at = now() - interval '25 hours'",
);
check(
  "(f) 24時間より前の行は数えない",
  (await asRole(db, "anon", insert({ ...okRow, client_key: key(2) }))) === null,
);

// (f) 全体は10分で30行まで（client_key を毎回変えても止まる）
await db.exec("DELETE FROM public.site_feedback");
let overallErr = null;
for (let i = 0; i < 30; i++)
  overallErr ??= await asRole(
    db,
    "anon",
    insert({ ...okRow, client_key: key(1000 + i) }),
  );
check("(f) 全体の30行目までは入る", overallErr === null, overallErr?.message);
const thirtyFirst = await asRole(
  db,
  "anon",
  insert({ ...okRow, client_key: key(2000) }),
);
check(
  "(f) 全体の31行目は拒否する",
  thirtyFirst !== null && /too many overall/.test(thirtyFirst.message),
  thirtyFirst?.message ?? "成功してしまった",
);
check("(f) 拒否した行は入っていない", (await count(db)) === 30);

// (g)
let twice = null;
try {
  await db.exec(sql);
} catch (e) {
  twice = e;
}
check("(g) 2回適用しても失敗しない", twice === null, twice?.message);
check("(g) 2回目の適用で行は消えない", (await count(db)) === 30);

// (h)
await db.exec(rollbackSql);
const gone = await db.query(
  "SELECT to_regclass('public.site_feedback') AS t, to_regprocedure('public.site_feedback_guard()') AS f",
);
check(
  "(h) 戻しの SQL で表と関数が消える",
  gone.rows[0].t === null && gone.rows[0].f === null,
  JSON.stringify(gone.rows[0]),
);

await db.close();
if (failures > 0) {
  console.error(`\nverify-site-feedback: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback: OK");
