/**
 * verify-ro-query.js - 読み取り専用ロール claude_ro（マイグレーション 166、ADR-0096）と scripts/db/ro-query.js の検証。
 * 本番 DB には接続しない。インメモリの Postgres（PGlite）に Supabase と同じ形のロールの縮約版を作り、166 を適用する。
 *
 * 確認すること:
 *   (a) 受け付ける文: 1文だけ、先頭が SELECT / WITH / TABLE / VALUES / EXPLAIN / SHOW
 *   (b) 接続文字列のユーザーが claude_ro でなければ接続しない。--limit の範囲
 *   (c) 166 の適用後、claude_ro は RLS の付いた表を（ポリシーが無くても）全行読める。0行に化けない
 *   (d) claude_ro は READ ONLY を外しても書けない（表の INSERT・SECURITY DEFINER の書き込み関数・public への CREATE）
 *   (e) sns_oauth_tokens は読めない。166 の後に postgres が作る表は読める（既定権限）
 *   (f) runReadOnlyQuery: 上限＋1行で打ち切りを判定、失敗しても必ず ROLLBACK、ロールが違えば実行しない、
 *       書き込みの CTE・READ ONLY を外す set_config は失敗する
 *   (g) 166 の末尾の検査: claude_ro が呼べる SECURITY DEFINER 関数（STABLE でも）・列単位の書き込みの GRANT・
 *       public 以外のスキーマの書き込みと CREATE・秘密らしい名前のデータベースの設定があれば例外で全体を戻す
 *   (h) SCRAM の検証子: pg のクライアント（lib/crypto/sasl.js）の証明を、検証子だけで検証できる
 *   (i) ro-setup.js の .env.local の書き換え: 既にあれば --force なしで止まる
 *
 * 実行: npm run verify:ro-query（@electric-sql/pglite・pg は devDependency）
 */
import fs from "node:fs";
import path from "node:path";
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import {
  checkReadStatement,
  checkRoUrl,
  parseRowLimit,
  runReadOnlyQuery,
  MAX_ROW_LIMIT,
} from "../lib/roQuery.js";
import { scramSha256Verifier } from "../lib/scramVerifier.js";
import { upsertEnvLine } from "../db/ro-setup.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION = fs.readFileSync(
  path.join(
    __dirname,
    "../../docs/db-migration/166_claude_ro_readonly_role.sql",
  ),
  "utf8",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? ` (${detail})` : ""}`);
  }
}

async function rejects(fn) {
  try {
    await fn();
    return { rejected: false };
  } catch (e) {
    return { rejected: true, code: e.code, message: e.message };
  }
}

// ---------------------------------------------------------------------------
// (a)(b) 純粋関数
// ---------------------------------------------------------------------------
for (const sql of [
  "SELECT 1",
  "  select count(*) from races;  ",
  "WITH x AS (SELECT 1) SELECT * FROM x",
  "TABLE races",
  "VALUES (1)",
  "EXPLAIN SELECT 1",
  "SHOW statement_timeout",
  "SELECT ';' AS semi -- 末尾のコメント",
]) {
  check(`受け付ける: ${sql.trim()}`, checkReadStatement(sql).ok);
}
for (const sql of [
  "INSERT INTO races VALUES (1)",
  "SELECT 1; SELECT 2",
  "SELECT 1; DELETE FROM races",
  "BEGIN",
  "COMMIT",
  "SET default_transaction_read_only = off",
  "COPY races TO STDOUT",
  "DO $$ BEGIN END $$",
  "\\! ls",
  "",
  "SELECT 'unterminated",
]) {
  check(`拒否する: ${JSON.stringify(sql)}`, !checkReadStatement(sql).ok);
}

check(
  "URL: claude_ro.<ref> を受け付け、sslmode を外す",
  checkRoUrl(
    "postgresql://claude_ro.abcdefghijklmnopqrst:pw@aws-0-x.pooler.supabase.com:5432/postgres?sslmode=require",
  ) ===
    "postgresql://claude_ro.abcdefghijklmnopqrst:pw@aws-0-x.pooler.supabase.com:5432/postgres",
);
for (const bad of [
  "postgresql://postgres.abcdefghijklmnopqrst:pw@h:5432/postgres",
  "postgresql://claude_rox:pw@h:5432/postgres",
  "postgresql://claude_ro.abcdefghijklmnopqrst:pw@h:5432/postgres?user=postgres",
  "postgresql://claude_ro.abcdefghijklmnopqrst:pw@h:5432/postgres?options=-c%20role%3Dpostgres",
  "not a url",
  undefined,
]) {
  check(
    `URL: 拒否する ${String(bad).replace(/:pw@/, ":***@")}`,
    (await rejects(() => checkRoUrl(bad))).rejected,
  );
}
check("--limit 既定 200", parseRowLimit(undefined) === 200);
check("--limit 50", parseRowLimit("50") === 50);
for (const bad of ["0", "-1", "1.5", "abc", String(MAX_ROW_LIMIT + 1)]) {
  check(
    `--limit ${bad} は拒否`,
    (await rejects(() => parseRowLimit(bad))).rejected,
  );
}

// ---------------------------------------------------------------------------
// (c)〜(g) PGlite に 166 を適用する
// ---------------------------------------------------------------------------
const FIXTURE_SQL = `
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- 076・113 の後の Supabase と同じ: postgres の新規の表・関数に anon / PUBLIC の権限を付けない
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE public.races (race_id text PRIMARY KEY, note text);
ALTER TABLE public.races ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.sns_oauth_tokens (provider text PRIMARY KEY, ciphertext text);
ALTER TABLE public.sns_oauth_tokens ENABLE ROW LEVEL SECURITY;
CREATE VIEW public.races_view WITH (security_invoker = true) AS SELECT race_id FROM public.races;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
INSERT INTO public.races VALUES ('R1', 'a'), ('R2', 'b'), ('R3', 'c');
INSERT INTO public.sns_oauth_tokens VALUES ('x', 'secret');

-- 書き込みをする SECURITY DEFINER 関数（113 の後の書き方: PUBLIC から外し service_role にだけ付ける）
CREATE FUNCTION public.writer() RETURNS void LANGUAGE sql SECURITY DEFINER
  AS $$ INSERT INTO public.races VALUES ('W', 'w') $$;
REVOKE ALL ON FUNCTION public.writer() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.writer() TO service_role;
`;

async function freshDb(extraSql = "") {
  const db = new PGlite();
  await db.exec(FIXTURE_SQL + extraSql);
  return db;
}

async function asRole(db, role, fn) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec("RESET ROLE");
  }
}

{
  const db = await freshDb();
  await db.exec(MIGRATION);

  const roleRow = (
    await db.query(
      "SELECT rolbypassrls, rolsuper, rolconnlimit, rolconfig FROM pg_roles WHERE rolname='claude_ro'",
    )
  ).rows[0];
  check(
    "166: claude_ro を作る（BYPASSRLS・superuser でない・接続2）",
    roleRow?.rolbypassrls === true &&
      roleRow?.rolsuper === false &&
      roleRow?.rolconnlimit === 2,
  );
  check(
    "166: statement_timeout と default_transaction_read_only を付ける",
    (roleRow?.rolconfig ?? []).includes("statement_timeout=30s") &&
      (roleRow?.rolconfig ?? []).includes("default_transaction_read_only=on"),
  );

  // (c) RLS の付いた表（ポリシー無し）を全行読める
  const all = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SELECT race_id FROM races ORDER BY race_id"),
  );
  check(
    "RLS の付いた表を全行読める（0行に化けない）",
    all.rows.length === 3,
    `${all.rows.length}行`,
  );
  const viaView = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SELECT count(*)::int AS n FROM races_view"),
  );
  check("security_invoker のビューも全行読める", viaView.rows[0]?.n === 3);

  // (d) READ ONLY を外しても書けない（ro-query.js を通さない直の接続を想定）
  const direct = (sql) =>
    asRole(db, "claude_ro", () =>
      rejects(async () => {
        await db.exec("SET default_transaction_read_only = off");
        await db.query(sql);
      }),
    );
  for (const [label, sql] of [
    ["表の INSERT", "INSERT INTO races VALUES ('X', 'x')"],
    ["表の UPDATE", "UPDATE races SET note = 'z'"],
    ["表の DELETE", "DELETE FROM races"],
    ["表の TRUNCATE", "TRUNCATE races"],
    ["SECURITY DEFINER の書き込み関数", "SELECT writer()"],
    ["public への CREATE TABLE", "CREATE TABLE public.junk (x int)"],
    ["sns_oauth_tokens の SELECT", "SELECT * FROM sns_oauth_tokens"],
  ]) {
    const r = await direct(sql);
    check(
      `READ ONLY を外しても拒否: ${label}`,
      r.rejected && r.code === "42501",
      r.code ?? "通った",
    );
  }
  check(
    "書き込みは1件も入っていない",
    (await db.query("SELECT count(*)::int AS n FROM races")).rows[0].n === 3,
  );

  // (e) 166 の後に postgres が作る表は読める
  await db.exec(
    "CREATE TABLE public.later (x int); INSERT INTO public.later VALUES (1);",
  );
  const later = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SELECT x FROM later"),
  );
  check("166 の後に作った表も読める（既定権限）", later.rows.length === 1);

  // (f) runReadOnlyQuery
  const capped = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SELECT g FROM generate_series(1, 10) g", {
      limit: 3,
    }),
  );
  check(
    "上限で打ち切る",
    capped.rows.length === 3 && capped.truncated === true,
  );
  const exact = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SELECT g FROM generate_series(1, 3) g", { limit: 3 }),
  );
  check(
    "ちょうど上限なら打ち切りにしない",
    exact.rows.length === 3 && exact.truncated === false,
  );
  const show = await asRole(db, "claude_ro", () =>
    runReadOnlyQuery(db, "SHOW transaction_read_only"),
  );
  check(
    "SHOW は READ ONLY のトランザクションの中で動く",
    show.rows[0]?.transaction_read_only === "on",
  );

  for (const [label, sql] of [
    [
      "書き込みの CTE",
      "WITH d AS (DELETE FROM races RETURNING 1) SELECT * FROM d",
    ],
    [
      "READ ONLY を外す set_config",
      "SELECT set_config('transaction_read_only', 'off', true)",
    ],
  ]) {
    const r = await asRole(db, "claude_ro", () =>
      rejects(() => runReadOnlyQuery(db, sql)),
    );
    check(`runReadOnlyQuery で失敗する: ${label}`, r.rejected, "通った");
  }
  const afterError = await asRole(db, "claude_ro", () =>
    db.query("SELECT current_setting('transaction_isolation') AS t"),
  );
  check(
    "失敗の後もトランザクションが残っていない（ROLLBACK 済み）",
    afterError.rows.length === 1,
  );

  const wrongRole = await rejects(() => runReadOnlyQuery(db, "SELECT 1"));
  check(
    "接続したロールが claude_ro でなければ実行しない",
    wrongRole.rejected && /claude_ro でない/.test(wrongRole.message),
    wrongRole.message,
  );
  await db.close();
}

// (f2) ROLLBACK も失敗したとき、元のエラーを返す
{
  const fake = {
    query: async (text) => {
      if (text.startsWith("SELECT current_user")) return { rows: [{ role: "claude_ro", ro: "on" }] };
      if (text.startsWith("DECLARE")) throw new Error("canceling statement due to statement timeout");
      if (text === "ROLLBACK") throw new Error("Client was closed and is not queryable");
      return { rows: [] };
    },
  };
  const origError = console.error;
  console.error = () => {};
  const r = await rejects(() => runReadOnlyQuery(fake, "SELECT 1"));
  console.error = origError;
  check("ROLLBACK の失敗で元のエラーを上書きしない", /statement timeout/.test(r.message ?? ""), r.message);
}

// (g) 166 の末尾の検査。どれも例外になり、claude_ro は作られない（全体が戻る）
for (const [label, extraSql, pattern] of [
  [
    "PUBLIC が呼べる VOLATILE な SECURITY DEFINER 関数",
    `CREATE FUNCTION public.legacy_writer() RETURNS void LANGUAGE sql SECURITY DEFINER
       AS $$ DELETE FROM public.races $$;
     GRANT EXECUTE ON FUNCTION public.legacy_writer() TO PUBLIC;`,
    /legacy_writer/,
  ],
  [
    "STABLE な SECURITY DEFINER 関数（中で VOLATILE な関数を呼べば書ける）",
    `CREATE FUNCTION public.vw() RETURNS int LANGUAGE sql VOLATILE
       AS $$ INSERT INTO public.races VALUES ('LEAK', 'x') RETURNING 1 $$;
     REVOKE ALL ON FUNCTION public.vw() FROM PUBLIC;
     CREATE FUNCTION public.st() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER
       AS $$ SELECT public.vw() $$;
     GRANT EXECUTE ON FUNCTION public.st() TO PUBLIC;`,
    /public\.st\(\)|st\(\)/,
  ],
  [
    "列単位の UPDATE の GRANT",
    "GRANT UPDATE (note) ON public.races TO PUBLIC;",
    /races\(UPDATE\)/,
  ],
  [
    "public 以外のスキーマの表への書き込み",
    `CREATE SCHEMA ext; GRANT USAGE ON SCHEMA ext TO PUBLIC;
     CREATE TABLE ext.t (x int); GRANT INSERT ON ext.t TO PUBLIC;`,
    /ext\.t\(INSERT\)/,
  ],
  [
    "public 以外のスキーマへの CREATE",
    "CREATE SCHEMA ext2; GRANT USAGE, CREATE ON SCHEMA ext2 TO PUBLIC;",
    /CREATE できるスキーマがある: ext2/,
  ],
  [
    "シーケンスの USAGE",
    "CREATE SEQUENCE public.s1; GRANT USAGE ON SEQUENCE public.s1 TO PUBLIC;",
    /シーケンス/,
  ],
  [
    "データベースの設定の秘密（値は出さない）",
    "ALTER DATABASE postgres SET app.settings.jwt_secret = 'super-secret-value';",
    /app\.settings\.jwt_secret/,
  ],
]) {
  const db = await freshDb(extraSql);
  const r = await rejects(() => db.exec(MIGRATION));
  check(`166: 例外になる: ${label}`, r.rejected && pattern.test(r.message), r.message ?? "通った");
  if (/jwt_secret/.test(extraSql)) {
    check("166: 秘密の設定の値はエラーの文に出さない", !/super-secret-value/.test(r.message ?? ""));
  }
  await db.exec("ROLLBACK").catch(() => {});
  const exists = (
    await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='claude_ro'")
  ).rows[0].n;
  check(`166: 例外のとき claude_ro は作られない: ${label}`, exists === 0);
  await db.close();
}
{
  const db = await freshDb("GRANT CREATE ON SCHEMA public TO PUBLIC;");
  const r = await rejects(() => db.exec(MIGRATION));
  check(
    "166: PUBLIC が public に CREATE できれば例外",
    r.rejected && /CREATE できる/.test(r.message),
    r.message,
  );
  await db.close();
}

// ---------------------------------------------------------------------------
// (h) SCRAM の検証子を、pg のクライアントの証明で検証する（サーバー側の手順を再現）
// ---------------------------------------------------------------------------
{
  const require = createRequire(import.meta.url);
  const sasl = require("pg/lib/crypto/sasl.js");
  const password = "0123456789abcdef0123456789abcdef0123456789abcdef";
  const verifier = scramSha256Verifier(password);
  const m = /^SCRAM-SHA-256\$(\d+):([^$]+)\$([^:]+):(.+)$/.exec(verifier);
  check(
    "SCRAM: 検証子の形",
    m !== null && m[1] === "4096",
    verifier.slice(0, 20),
  );
  const [, iterations, saltB64, storedB64, serverB64] = m;

  const session = sasl.startSession(["SCRAM-SHA-256"]);
  const clientNonce = /r=([^,]+)/.exec(session.response)[1];
  const serverFirst = `r=${clientNonce}srvnonce,s=${saltB64},i=${iterations}`;
  await sasl.continueSession(session, password, serverFirst);
  const clientFinal = session.response;
  const proof = Buffer.from(/,p=(.+)$/.exec(clientFinal)[1], "base64");
  const clientFirstBare = `n=*,r=${clientNonce}`;
  const authMessage = `${clientFirstBare},${serverFirst},${clientFinal.replace(/,p=.+$/, "")}`;
  const storedKey = Buffer.from(storedB64, "base64");
  const clientSignature = createHmac("sha256", storedKey)
    .update(authMessage)
    .digest();
  const clientKey = Buffer.from(proof.map((b, i) => b ^ clientSignature[i]));
  check(
    "SCRAM: pg のクライアントの証明を StoredKey で検証できる",
    createHash("sha256").update(clientKey).digest().equals(storedKey),
  );
  const serverSignature = createHmac("sha256", Buffer.from(serverB64, "base64"))
    .update(authMessage)
    .digest("base64");
  check(
    "SCRAM: ServerKey の署名を pg のクライアントが受け入れる",
    !(
      await rejects(() => sasl.finalizeSession(session, `v=${serverSignature}`))
    ).rejected,
  );
  const wrong = scramSha256Verifier("another-password");
  check(
    "SCRAM: 塩は毎回変わる",
    wrong.split("$")[1] !== verifier.split("$")[1],
  );
  check(
    "SCRAM: 空白を含むパスワードは拒否",
    (await rejects(() => scramSha256Verifier("a b"))).rejected,
  );
}

// ---------------------------------------------------------------------------
// (i) .env.local の書き換え
// ---------------------------------------------------------------------------
check(
  "env: 無ければ末尾に足す",
  upsertEnvLine("A=1\n", "SUPABASE_RO_DB_URL=u", false) ===
    "A=1\nSUPABASE_RO_DB_URL=u\n",
);
check(
  "env: 改行の無い末尾にも足す",
  upsertEnvLine("A=1", "SUPABASE_RO_DB_URL=u", false) ===
    "A=1\nSUPABASE_RO_DB_URL=u\n",
);
check(
  "env: 既にあれば --force なしで止まる",
  upsertEnvLine("SUPABASE_RO_DB_URL=old\n", "SUPABASE_RO_DB_URL=u", false) ===
    null,
);
check(
  "env: --force なら置き換える",
  upsertEnvLine(
    "A=1\nSUPABASE_RO_DB_URL=old\nB=2\n",
    "SUPABASE_RO_DB_URL=u",
    true,
  ) === "A=1\nSUPABASE_RO_DB_URL=u\nB=2\n",
);

if (failures > 0) {
  console.error(`\n${failures}件失敗`);
  process.exit(1);
}
console.log("\n全件OK");
