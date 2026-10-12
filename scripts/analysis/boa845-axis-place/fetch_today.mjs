/**
 * BOA-845 見せる側のレース（既定 2026-10-08〜10-11）の級・会場・節と結果を取得する（読み取りのみ）
 *
 * 出力: data/analysis/boa845-axis-place/work/today.json（gitignore 対象。BOA845_WORK_DIR で変更可）
 * 使い方: node scripts/analysis/boa845-axis-place/fetch_today.mjs
 * 期間: 環境変数 BOA845_FROM（既定 2026-10-08）〜 BOA845_TO（既定 2026-10-11）、両端を含む
 * 接続: scripts/lib/supabaseClient.js（.env.local の SUPABASE_URL / SUPABASE_SERVICE_KEY）。select のみで書き込みはしない
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase as sb } from "../../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORK_DIR =
  process.env.BOA845_WORK_DIR ||
  path.join(__dirname, "../../../data/analysis/boa845-axis-place/work");
const FROM = process.env.BOA845_FROM || "2026-10-08";
const TO = process.env.BOA845_TO || "2026-10-11";

async function all(table, cols, f) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await f(sb.from(table).select(cols).order("race_id").range(i, i + 999));
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const races = await all("races", "race_id, race_date, venue_code, race_number, race_grade, cancellation_status", (q) =>
  q.gte("race_date", FROM).lte("race_date", TO),
);
const ids = races.map((r) => r.race_id);
const chunk = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const entries = [], conds = [], results = [];
for (const c of chunk(ids, 150)) {
  entries.push(...(await all("race_entries", "race_id, boat_number, grade, is_absent", (q) => q.in("race_id", c))));
  conds.push(...(await all("race_conditions", "race_id, race_stage", (q) => q.in("race_id", c))));
  results.push(
    ...(await all("race_results", "race_id, rank1, rank2, rank3, is_cancelled, is_no_race, race_status, refund_boats", (q) =>
      q.in("race_id", c),
    )),
  );
}
fs.mkdirSync(WORK_DIR, { recursive: true });
const fetched_at = new Date().toISOString();
fs.writeFileSync(path.join(WORK_DIR, "today.json"), JSON.stringify({ from: FROM, to: TO, fetched_at, races, entries, conds, results }));
console.log({ from: FROM, to: TO, fetched_at, races: races.length, entries: entries.length, conds: conds.length, results: results.length });
