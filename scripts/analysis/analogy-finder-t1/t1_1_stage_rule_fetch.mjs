/**
 * BOA-271 T1-1（優勝戦・準優勝戦の判定を広げる）の入力を本番 DB から読み取りのみで取得する。
 * 事前登録: docs/design/analogy-finder/analysis/t1/preregistration-t1.md「共通」「T1-1」（コミット 238e0bb5a）
 *
 * 期間 2019-04-01〜2026-10-03。長期（kb_archive_*）は 2025-12-02 まで、本体（races 等）は 2025-12-03 から。
 * 6艇ともA1 の判定用に、級別が A1 の艇の行だけを取る（A1 の艇が6艇＝6艇ともA1）。
 *
 * 使い方: ANALOGY_SCRATCH=... node --env-file=.env.local scripts/analysis/analogy-finder-t1/t1_1_stage_rule_fetch.mjs
 * 出力: $ANALOGY_SCRATCH/t1/t1_1_raw/{name}.csv と t1_1_fetch_manifest.json（行数・最大日・sha256・取得時刻）
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { supabase } from "../../lib/supabaseClient.js";

const SCRATCH = process.env.ANALOGY_SCRATCH;
if (!SCRATCH) throw new Error("ANALOGY_SCRATCH が未設定");
const OUT = path.join(SCRATCH, "t1", "t1_1_raw");
const PAGE = 1000;
const CONCURRENCY = 4;
const KB_FROM = "2019-04-01";
const KB_TO = "2025-12-02";
const MAIN_FROM = "2025-12-03";
const MAIN_TO = "2026-10-03";

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// race_id / venue_day_id は "YYYY-MM-DD-..." なので、日付の範囲を文字列の範囲で切れる
function dayRanges(from, to, stepDays) {
  const out = [];
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    const n = new Date(d.getTime() + stepDays * 86400000);
    const hi = n > end ? new Date(end.getTime() + 86400000) : n;
    out.push([d.toISOString().slice(0, 10), hi.toISOString().slice(0, 10)]);
    d = n;
  }
  return out;
}

async function fetchRange(t, lo, hi) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    for (let attempt = 1; ; attempt++) {
      let q = supabase.from(t.table).select(t.cols);
      if (t.rangeCol) q = q.gte(t.rangeCol, lo).lt(t.rangeCol, hi);
      for (const [c, v] of t.eq ?? []) q = q.eq(c, v);
      for (const c of t.order) q = q.order(c);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (!error) {
        rows.push(...data);
        if (data.length < PAGE) return rows;
        break;
      }
      if (attempt >= 5)
        throw new Error(`${t.table} ${lo} offset=${from}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const KB_R = dayRanges(KB_FROM, KB_TO, 30);
const MAIN_R = dayRanges(MAIN_FROM, MAIN_TO, 30);
const TABLES = [
  { name: "kb_races", table: "kb_archive_races", cols: "race_id, venue_day_id, race_date, venue_code, race_number, stage, stage_kind, has_result", order: ["race_id"], rangeCol: "race_id", ranges: KB_R, dateCol: "race_date" },
  { name: "kb_venue_days", table: "kb_archive_venue_days", cols: "venue_day_id, race_date, venue_code, series_day, is_final_day, title", order: ["venue_day_id"], rangeCol: "venue_day_id", ranges: KB_R, dateCol: "race_date" },
  { name: "kb_boats_a1", table: "kb_archive_boats", cols: "race_id, boat_number, class", eq: [["class", "A1"]], order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: KB_R },
  { name: "race_series", table: "race_series", cols: "venue_code, start_date, end_date, grade, title", order: ["venue_code", "start_date"], rangeCol: null, ranges: [[null, null]], dateCol: "end_date" },
  { name: "races", table: "races", cols: "race_id, race_date, venue_code, race_number, cancellation_status", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_R, dateCol: "race_date" },
  { name: "conditions", table: "race_conditions", cols: "race_id, race_stage, is_final_day, series_day, race_title", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_R },
  { name: "results", table: "race_results", cols: "race_id, rank1, is_cancelled, is_no_race, race_status", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_R },
  { name: "entries_a1", table: "race_entries", cols: "race_id, boat_number, grade", eq: [["grade", "A1"]], order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: MAIN_R },
];

async function exportTable(t) {
  const colList = t.cols.split(",").map((s) => s.trim());
  const chunks = new Array(t.ranges.length);
  let next = 0;
  async function worker() {
    while (next < t.ranges.length) {
      const i = next++;
      const [lo, hi] = t.ranges[i];
      chunks[i] = await fetchRange(t, lo, hi);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const rows = chunks.flat();
  if (rows.length === 0) throw new Error(`${t.name}: 0行`);
  const body = rows.map((r) => colList.map((c) => csvCell(r[c])).join(",")).join("\n");
  fs.writeFileSync(path.join(OUT, `${t.name}.csv`), `${colList.join(",")}\n${body}\n`);
  const maxDate = t.dateCol
    ? rows.reduce((m, r) => (r[t.dateCol] > m ? r[t.dateCol] : m), "")
    : rows.reduce((m, r) => (r.race_id > m ? r.race_id : m), "").slice(0, 10);
  return {
    table: t.table,
    filter: t.eq ? Object.fromEntries(t.eq) : null,
    rows: rows.length,
    max_date: maxDate,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
    fetched_at: new Date().toISOString(),
  };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { period: { kb: [KB_FROM, KB_TO], main: [MAIN_FROM, MAIN_TO] }, tables: {} };
  for (const t of TABLES) {
    const t0 = Date.now();
    manifest.tables[t.name] = await exportTable(t);
    console.log(`${t.name}: ${manifest.tables[t.name].rows}行 (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync(path.join(SCRATCH, "t1", "t1_1_fetch_manifest.json"), JSON.stringify(manifest, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
