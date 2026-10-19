#!/usr/bin/env node
/**
 * materials.js - AI の PR の審査の材料（ADR-0096 の追記）。SQL の PR で触る表について、本番の定義と行数の目安を
 * claude_ro（読み取り専用）で取る。返すのは定義と件数だけで、行の中身は返さない。
 *
 * env: CLAUDE_RO_DB_URL（Environment db-readonly）・TABLES（gate の sql_tables、JSON の配列）
 * 出力: materials（JSON、1行）
 *
 * 表の名前は gate が識別子の形を検査したものだけを受け取り、さらにここでも検査して psql の変数（:'tbl'）で渡す。
 * SQL の本文は組み立てない。接続できなければ失敗にする（材料の無いまま承認しない）。
 */
import { execFileSync } from "node:child_process";
import { fail, requireEnv, setOutput } from "./common.js";

const SAFE_TABLE = /^[a-z_][a-z0-9_]{0,62}$/;

const QUERY = `\\set ON_ERROR_STOP on
BEGIN TRANSACTION READ ONLY;
SELECT current_user = 'claude_ro' AS is_ro \\gset
\\if :is_ro
\\else
SELECT 1/0;
\\endif
SELECT json_build_object(
  'table', :'tbl',
  'exists', to_regclass('public.' || quote_ident(:'tbl')) IS NOT NULL,
  'estimated_rows', (SELECT c.reltuples::bigint FROM pg_class c WHERE c.oid = to_regclass('public.' || quote_ident(:'tbl'))),
  'columns', (SELECT json_agg(json_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) ORDER BY ordinal_position)
              FROM information_schema.columns WHERE table_schema = 'public' AND table_name = :'tbl'),
  'indexes', (SELECT json_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'public' AND tablename = :'tbl'),
  'policies', (SELECT json_agg(json_build_object('name', policyname, 'cmd', cmd, 'roles', roles) ORDER BY policyname)
               FROM pg_policies WHERE schemaname = 'public' AND tablename = :'tbl'),
  'rls', (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = to_regclass('public.' || quote_ident(:'tbl')))
);
ROLLBACK;
`;

function pgEnv(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("CLAUDE_RO_DB_URL が URL として読めない");
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!/^claude_ro(\.|$)/.test(user))
    fail("CLAUDE_RO_DB_URL のユーザーが claude_ro でない");
  // psql の stderr に出るユーザー名（claude_ro.<project-ref>）も隠す
  for (const secret of new Set([password, url.hostname, user]))
    console.log(`::add-mask::${secret}`);
  return {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: user,
    PGPASSWORD: password,
    PGDATABASE:
      decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres",
    PGSSLMODE: "require",
    PGAPPNAME: "ai-review-materials",
    PGOPTIONS: "-c statement_timeout=20s",
  };
}

function main() {
  const env = pgEnv(requireEnv("CLAUDE_RO_DB_URL"));
  let tables;
  try {
    tables = JSON.parse(requireEnv("TABLES"));
  } catch {
    fail("TABLES が JSON として読めない");
  }
  if (
    !Array.isArray(tables) ||
    !tables.every((t) => typeof t === "string" && SAFE_TABLE.test(t))
  ) {
    fail("TABLES に識別子の形でない値がある");
  }
  const result = tables.map((tbl) => {
    const out = execFileSync(
      "psql",
      ["-X", "-A", "-t", "-q", "-v", `tbl=${tbl}`],
      {
        input: QUERY,
        env: { ...process.env, ...env },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    const line = out.split("\n").find((l) => l.startsWith("{"));
    if (!line) fail(`${tbl} の定義を読めなかった`);
    return JSON.parse(line);
  });
  setOutput("materials", JSON.stringify(result));
  console.log(`OK: ${result.length} 表`);
}

main();
