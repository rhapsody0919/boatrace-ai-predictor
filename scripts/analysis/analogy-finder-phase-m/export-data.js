/**
 * BOA-271 Phase M: モデル設計・検証用のデータ書き出し（読み取りのみ）
 *
 * 長期（kb_archive_*、2019-04〜2025-12-02）と本体テーブル（2025-12-03〜）を
 * テーブルごとに CSV へ書き出す。結合・特徴量化は build_dataset.py が行う。
 *
 * 出力: data/ml/analogy/*.csv（gitignore 対象）
 * 使い方: node scripts/analysis/analogy-finder-phase-m/export-data.js [table ...]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { supabase } from "../../lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "../../../data/ml/analogy");
const PAGE = 1000;
const CONCURRENCY = 6;

const csvCell = (v) => {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** YYYY-MM の列（race_id の先頭で範囲を切るため） */
function months(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
const nextMonth = (ym) => {
  let [y, m] = ym.split("-").map(Number);
  m++;
  if (m > 12) {
    m = 1;
    y++;
  }
  return `${y}-${String(m).padStart(2, "0")}`;
};

async function fetchRange(table, cols, orderCols, rangeCol, lo, hi, extra) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let attempt = 0;
    for (;;) {
      let q = supabase.from(table).select(cols);
      if (rangeCol) q = q.gte(rangeCol, lo).lt(rangeCol, hi);
      if (extra) q = extra(q);
      for (const c of orderCols) q = q.order(c);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (error) {
        attempt++;
        if (attempt > 5)
          throw new Error(`${table} ${lo} offset=${from}: ${error.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      rows.push(...data);
      if (data.length < PAGE) return rows;
      break;
    }
  }
}

async function exportTable({
  name,
  table,
  cols,
  order,
  rangeCol,
  ranges,
  extra,
}) {
  const file = path.join(OUT_DIR, `${name}.csv`);
  const colList = cols.split(",").map((s) => s.trim());
  const chunks = new Array(ranges.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < ranges.length) {
      const i = next++;
      const [lo, hi] = ranges[i];
      chunks[i] = await fetchRange(table, cols, order, rangeCol, lo, hi, extra);
      done++;
      if (done % 10 === 0 || done === ranges.length)
        process.stdout.write(`  ${name}: ${done}/${ranges.length}\n`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const ws = fs.createWriteStream(file);
  ws.write(colList.join(",") + "\n");
  let n = 0;
  for (const rows of chunks)
    for (const r of rows) {
      ws.write(colList.map((c) => csvCell(r[c])).join(",") + "\n");
      n++;
    }
  await new Promise((res) => ws.end(res));
  console.log(`✅ ${name}.csv ${n.toLocaleString()}行`);
}

const KB_MONTHS = months("2019-04", "2025-12").map((m) => [m, nextMonth(m)]);
const MAIN_MONTHS = months("2025-12", "2026-10").map((m) => [m, nextMonth(m)]);
// 2026-04 以降だけ（オッズ等）。日単位で切って1チャンクを小さくする
const DAYS_FROM = (from) => {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date("2026-10-02T00:00:00Z");
  while (d < end) {
    const a = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    out.push([a, d.toISOString().slice(0, 10)]);
  }
  return out;
};

const TABLES = [
  {
    name: "kb_boats",
    table: "kb_archive_boats",
    cols: "race_id, boat_number, racer_id, class, age, branch, weight, national_win_rate, national_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, exhibition_time, course, start_timing, is_flying, is_late_start, finish_raw, finish_rank",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: KB_MONTHS,
  },
  {
    name: "kb_races",
    table: "kb_archive_races",
    cols: "race_id, venue_day_id, race_date, venue_code, race_number, stage, stage_kind, deadline_time, weather, wind_direction, wind_speed, wave_height, technique, has_result",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: KB_MONTHS,
  },
  {
    name: "kb_venue_days",
    table: "kb_archive_venue_days",
    cols: "venue_day_id, race_date, venue_code, title, series_day, is_final_day, race_grade",
    order: ["venue_day_id"],
    rangeCol: "venue_day_id",
    ranges: KB_MONTHS,
  },
  {
    name: "race_series",
    table: "race_series",
    cols: "venue_code, start_date, end_date, total_days, title, grade, kind",
    order: ["venue_code", "start_date"],
    rangeCol: null,
    ranges: [[null, null]],
  },
  {
    name: "races",
    table: "races",
    cols: "race_id, race_date, venue_code, race_number, start_time, race_grade, cancellation_status",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "entries",
    table: "race_entries",
    cols: "race_id, boat_number, racer_id, grade, age, win_rate, global_2rate, global_3rate, local_win_rate, local_2rate, local_3rate, motor_2rate, motor_3rate, boat_2rate, boat_3rate, weight_kg, branch, f_count, l_count, is_absent",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "exhibition",
    table: "exhibition_data",
    cols: "race_id, boat_number, exhibition_time, start_timing, exhibition_course, tilt, is_absent",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "conditions",
    table: "race_conditions",
    cols: "race_id, weather, wind_direction, wind_speed, wave_height, temperature, water_temperature, series_day, is_final_day, race_stage",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "results",
    table: "race_results",
    cols: "race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race, winning_technique, race_status",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "start_timings",
    table: "race_start_timings",
    cols: "race_id, boat_number, start_timing, is_flying, is_late_start, entry_course",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "odds",
    table: "race_odds",
    cols: "race_id, captured_at, source, window_min, odds_win_1, odds_win_2, odds_win_3, odds_win_4, odds_win_5, odds_win_6",
    order: ["race_id", "captured_at"],
    rangeCol: "race_id",
    ranges: DAYS_FROM("2026-04-01"),
  },
  {
    name: "official_pred",
    table: "external_predictions",
    cols: "race_date, venue_code, race_no, payload, scraped_at, race_start_at",
    order: ["race_date", "venue_code", "race_no"],
    rangeCol: "race_date",
    ranges: DAYS_FROM("2026-05-20"),
    extra: (q) => q.eq("source", "pcexpect_official"),
  },
  {
    name: "orig_exhibition",
    table: "race_original_exhibition_values",
    cols: "race_id, boat_number, kind, value",
    order: ["race_id", "boat_number", "kind"],
    rangeCol: null,
    ranges: [[null, null]],
  },
];

async function main() {
  if (!supabase) throw new Error("Supabase 環境変数が未設定（.env.local）");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const only = process.argv.slice(2);
  for (const t of TABLES) {
    if (only.length && !only.includes(t.name)) continue;
    const t0 = Date.now();
    await exportTable(t);
    console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
