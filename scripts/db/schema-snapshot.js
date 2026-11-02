#!/usr/bin/env node
/**
 * schema-snapshot.js - 本番 DB（public）のスキーマの写し docs/reference/schema-snapshot.json を取り直す（ADR-0102）。
 *
 *   node --env-file=.env.local scripts/db/schema-snapshot.js
 *   node --env-file=.env.local scripts/db/schema-snapshot.js --dry-run   # 書かずに件数だけ出す
 *   node --env-file=.env.local scripts/db/schema-snapshot.js --ledger-ref=HEAD   # 台帳を読む ref（既定 origin/master）
 *
 * 新しい接続の口は作らない。scripts/db/schema-snapshot/{name}.sql を1本ずつ
 * scripts/db/ro-query.js --file … --json --limit 5000 に渡して順に呼ぶだけ（claude_ro、ADR-0096）。
 * 組み立ては DB に触れない scripts/lib/schemaSnapshot.js。1本でも打ち切り（truncated）なら書かずに失敗する。
 * 接続の文字列（SUPABASE_RO_DB_URL）は子のプロセスに env で渡るだけで、ここでは読まない・出さない。
 * 台帳（APPLIED.md）は手元の作業ツリーではなく --ledger-ref（既定 origin/master）のものを読む。先に git fetch する
 * （手元の枝が db-apply の台帳の記録より前だと、本番に当たったファイルを未適用として持ってしまう）。
 */
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_ROW_LIMIT } from "../lib/roQuery.js";
import {
  LEDGER_FILE,
  SNAPSHOT_FILE,
  SNAPSHOT_QUERIES,
  buildSnapshot,
  serializeSnapshot,
} from "../lib/schemaSnapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const RO_QUERY = path.join(__dirname, "ro-query.js");
const QUERY_DIR = path.join(__dirname, "schema-snapshot");
const SNAPSHOT_PATH = path.join(ROOT, SNAPSHOT_FILE);

function runQuery(name) {
  const file = path.join(QUERY_DIR, `${name}.sql`);
  let out;
  try {
    out = execFileSync(
      process.execPath,
      [RO_QUERY, "--file", file, "--json", "--limit", String(MAX_ROW_LIMIT)],
      {
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "inherit"],
      },
    );
  } catch (e) {
    throw new Error(
      `問い合わせ ${name} が失敗した（ro-query.js の終了コード ${e.status ?? "?"}）`,
    );
  }
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`問い合わせ ${name} の出力が JSON として読めない`);
  }
}

function readLedger(ref) {
  try {
    return execFileSync("git", ["show", `${ref}:${LEDGER_FILE}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    throw new Error(
      `${ref} の台帳（${LEDGER_FILE}）を読めない。git fetch origin master をしてから実行する（${String(e.stderr ?? e.message).trim()}）`,
    );
  }
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const refArg = process.argv.find((a) => a.startsWith("--ledger-ref="));
  const ledgerRef = refArg
    ? refArg.slice("--ledger-ref=".length)
    : "origin/master";
  const raw = {};
  for (const name of SNAPSHOT_QUERIES) {
    raw[name] = runQuery(name);
    console.error(
      `schema-snapshot: ${name} ${raw[name].rows?.length ?? "?"} 行`,
    );
  }
  const snapshot = buildSnapshot(raw, {
    capturedAt: new Date().toISOString(),
    ledger: readLedger(ledgerRef),
  });
  console.log(
    JSON.stringify({
      appliedThrough: snapshot.appliedThrough,
      counts: snapshot.counts,
    }),
  );
  if (dryRun) return;
  writeFileSync(SNAPSHOT_PATH, serializeSnapshot(snapshot));
  console.error(
    `schema-snapshot: ${path.relative(ROOT, SNAPSHOT_PATH)} に書いた`,
  );
}

try {
  main();
} catch (e) {
  console.error(`schema-snapshot: ${e.message}`);
  process.exit(1);
}
