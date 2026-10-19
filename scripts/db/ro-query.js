#!/usr/bin/env node
/**
 * ro-query.js - 本番 DB を読み取り専用ロール claude_ro で読む（ADR-0096、マイグレーション 166）。
 *
 *   node --env-file=.env.local scripts/db/ro-query.js "SELECT count(*) FROM races"
 *   node --env-file=.env.local scripts/db/ro-query.js --limit 50 "SELECT …"
 *   node --env-file=.env.local scripts/db/ro-query.js --json "SELECT …"
 *   node --env-file=.env.local scripts/db/ro-query.js --file path/to/query.sql
 *
 * 1文だけ・READ ONLY のトランザクション・最後は ROLLBACK・行は --limit（既定 200、最大 5000）まで。
 * 接続は env SUPABASE_RO_DB_URL（Session pooler、ユーザー名 claude_ro.<project-ref>）。初回設定は 166-runbook.md。
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import {
  checkRoUrl,
  formatResult,
  parseRowLimit,
  runReadOnlyQuery,
} from "../lib/roQuery.js";

function parseArgs(argv) {
  const opts = { json: false, limit: undefined, file: undefined, sql: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (a === "--limit") opts.limit = argv[++i];
    else if (a === "--file") opts.file = argv[++i];
    else opts.sql.push(a);
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const limit = parseRowLimit(opts.limit);
  const sql = opts.file ? readFileSync(opts.file, "utf8") : opts.sql.join(" ");
  if (sql.trim() === "") {
    throw new Error('SQL を引数か --file で渡す（例: ro-query.js "SELECT 1"）');
  }
  const connectionString = checkRoUrl(process.env.SUPABASE_RO_DB_URL);

  // 暗号化はするが証明書は検証しない（libpq の sslmode=require と同じ。Supabase の CA は公開の CA でない）
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    application_name: "claude-ro-query",
  });
  await client.connect();
  try {
    // 拡張問い合わせのプロトコルにすると、サーバーの側でも1つの問い合わせに1文しか通らない
    const extended = {
      query: (text) => client.query({ text, queryMode: "extended" }),
    };
    const result = await runReadOnlyQuery(extended, sql, { limit });
    console.log(
      opts.json ? JSON.stringify(result, null, 2) : formatResult(result),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(`ro-query: ${e.message}`);
  process.exit(1);
});
