#!/usr/bin/env node
// 公式の期別の進入コース別の進入数（racer_period_stats.c{N}_entries）を読み取りだけで取る（イン屋の指標 B の照合用）
//   node --env-file=.env.local scripts/analysis/inya-racer/fetch-period-entries.mjs [--out data/analysis/inya-racer/work]
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { checkRoUrl, RO_ROLE } from "../../lib/roQuery.js";
const args = process.argv.slice(2);
const OUT = args.includes("--out") ? args[args.indexOf("--out") + 1] : "data/analysis/inya-racer/work";
const c = new pg.Client({ connectionString: checkRoUrl(process.env.SUPABASE_RO_DB_URL), ssl: { rejectUnauthorized: false }, application_name: "inya-racer" });
await c.connect();
let rows;
try {
  await c.query("BEGIN READ ONLY");
  const who = (await c.query("select current_user u")).rows[0].u;
  if (who !== RO_ROLE) throw new Error(`接続ロールが ${who}（${RO_ROLE} でない）`);
  rows = (await c.query(`select racer_id::int id, period_year y, period_no p, calc_from::text f, calc_to::text t, grade g,
    c1_entries e1, c2_entries e2, c3_entries e3, c4_entries e4, c5_entries e5, c6_entries e6 from racer_period_stats order by 1,2,3`)).rows;
} finally { await c.query("ROLLBACK").catch(() => {}); await c.end(); }
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "period-entries.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), rows }));
console.log(rows.length);
