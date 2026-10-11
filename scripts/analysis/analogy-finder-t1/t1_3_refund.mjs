/**
 * BOA-271 v16 T1-3（事前登録 docs/design/analogy-finder/analysis/t1/preregistration-t1.md、コミット 238e0bb5a）
 * model-prep/data の CSV に無い列だけを本番 DB から SELECT する（読み取りのみ。書き込みはしない）。
 * - 長期 kb_archive_boats: race_id, boat_number, course（実際の進入コース）
 * - 本体 race_results: 進入（actual_course_1..6）・返還（refund_boats）・race_status ほか
 * - 本体 race_start_timings: finish_mark・official_finish_code（返還の判定）と ST・F/L
 * 出力: $ANALOGY_SCRATCH/t1/t1_3_{kb_course,main_results,main_st}.csv と t1_3_fetch_manifest.json（行数・sha256・取得時刻）
 *
 * 使い方: ANALOGY_SCRATCH=~/boatrace-data-archive/boa271-fr2-scratch-2026-10-04 node scripts/analysis/analogy-finder-t1/t1_3_refund.mjs [kb|main|all]
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { supabase } from "../../lib/supabaseClient.js";

const SCRATCH = process.env.ANALOGY_SCRATCH;
if (!SCRATCH) throw new Error("ANALOGY_SCRATCH が未設定");
if (!supabase) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY が未設定（.env.local）");
const OUT = path.join(SCRATCH, "t1");
fs.mkdirSync(OUT, { recursive: true });
const PAGE = 1000;
const CONCURRENCY = 6;

const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
const months = (from, to) => {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const next = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
    out.push([ym(y, m), next]);
    [y, m] = next.split("-").map(Number);
  }
  return out;
};
const csvCell = (v) => {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function fetchRange(table, cols, order, lo, hi) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    for (let attempt = 1; ; attempt++) {
      let q = supabase.from(table).select(cols).gte("race_id", lo).lt("race_id", hi);
      for (const c of order) q = q.order(c);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (!error) {
        rows.push(...data);
        if (data.length < PAGE) return rows;
        break;
      }
      if (attempt >= 5) throw new Error(`${table} ${lo} offset=${from}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const TABLES = {
  kb_course: { table: "kb_archive_boats", cols: "race_id,boat_number,course", order: ["race_id", "boat_number"], ranges: months("2019-04", "2025-12") },
  main_results: {
    table: "race_results",
    cols: "race_id,rank1,rank2,rank3,rank4,rank5,rank6,is_cancelled,is_no_race,race_status,refund_boats,actual_course_1,actual_course_2,actual_course_3,actual_course_4,actual_course_5,actual_course_6",
    order: ["race_id"],
    ranges: months("2025-12", "2026-09"),
  },
  main_st: {
    table: "race_start_timings",
    cols: "race_id,boat_number,start_timing,is_flying,is_late_start,finish_mark,official_finish_code",
    order: ["race_id", "boat_number"],
    ranges: months("2025-12", "2026-09"),
  },
};

async function exportTable(name) {
  const t = TABLES[name];
  const colList = t.cols.split(",");
  const chunks = new Array(t.ranges.length);
  let next = 0;
  const t0 = Date.now();
  async function worker() {
    while (next < t.ranges.length) {
      const i = next++;
      const [lo, hi] = t.ranges[i];
      const rows = await fetchRange(t.table, t.cols, t.order, lo, hi);
      chunks[i] = rows.map((r) => colList.map((c) => csvCell(r[c])).join(",")).join("\n");
      process.stdout.write(`${name} ${lo} ${rows.length}行\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const body = chunks.filter((c) => c.length > 0).join("\n");
  const n = body ? body.split("\n").length : 0;
  if (n === 0) throw new Error(`${name}: 0行`);
  fs.writeFileSync(path.join(OUT, `t1_3_${name}.csv`), `${colList.join(",")}\n${body}\n`);
  console.log(`${name} ${n}行 (${Math.round((Date.now() - t0) / 1000)}s)`);
  return { table: t.table, cols: t.cols, rows: n, sha256: crypto.createHash("sha256").update(body).digest("hex"), fetchedAt: new Date().toISOString() };
}

const which = process.argv[2] || "all";
const names = which === "all" ? Object.keys(TABLES) : which === "kb" ? ["kb_course"] : ["main_results", "main_st"];
const mfPath = path.join(OUT, "t1_3_fetch_manifest.json");
const manifest = fs.existsSync(mfPath) ? JSON.parse(fs.readFileSync(mfPath, "utf8")) : {};
for (const n of names) {
  manifest[n] = await exportTable(n);
  fs.writeFileSync(mfPath, JSON.stringify(manifest, null, 1));
}
