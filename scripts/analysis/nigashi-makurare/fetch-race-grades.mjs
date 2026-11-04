#!/usr/bin/env node
/**
 * BOA-1280 追加: 本体の races の race_grade（098 の基準はグレード込み）を読み取りだけで取る（claude_ro、READ ONLY、最後に ROLLBACK）。
 *
 *   node --env-file=.env.local scripts/analysis/nigashi-makurare/fetch-race-grades.mjs [--out data/analysis/nigashi-makurare/work]
 *
 * 出力 <out>/race-grades.tsv（race_id, grade）。grade は 098 と同じ COALESCE(race_grade, 'ippan')。kb_archive にはグレードの列が無い
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../../lib/roQuery.js";

const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data/analysis/nigashi-makurare/work";
const client = new pg.Client({ connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL), ssl: { rejectUnauthorized: false }, application_name: "boa1280-grades" });
await client.connect();
let rows;
try {
  await client.query("BEGIN READ ONLY");
  const who = (await client.query("select current_user u")).rows[0].u;
  if (who !== RO_ROLE) throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
  rows = (await client.query("select race_id, coalesce(race_grade, 'ippan') grade from races where race_date >= '2025-12-02'")).rows;
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "race-grades.tsv"), "race_id\tgrade\n" + rows.map((r) => `${r.race_id}\t${r.grade}`).join("\n") + "\n");
console.error(`wrote ${rows.length} rows`);
