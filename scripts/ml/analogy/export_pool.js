/**
 * BOA-271 アナロジー・ファインダー: 学習データの書き出し（DB は読み取りのみ）
 *
 * 長期（kb_archive_*、2019-04〜2025-12-02）と本体テーブル（2025-12-03〜）を、テーブルごとに
 * CSV へ書き出す。結合・特徴量化は features.py が行う。
 * Phase M の scripts/analysis/analogy-finder-phase-m/export-data.js を土台に、寄与度の学習に
 * 要るテーブルだけに絞った。
 *
 * 長期分は過去のアーカイブで変わらないので、月ごとの CSV（gzip）を Supabase Storage の
 * `analogy/source/{KB_CACHE_VERSION}/{テーブル}/{YYYY-MM}.csv.gz` に置き、2回目以降は DB を読まない
 * （Disk IO の節約。plan「Disk IO の見積り」）。長期分を補完・訂正したときは KB_CACHE_VERSION を上げる
 * （古いキャッシュを読まなくなる）か、--refresh-kb で取り直す。本体分（2025-12〜）は補完・訂正で値が変わるので毎回 DB から読む
 * （約10か月分で、長期の約1/8）。
 *
 * 出力: data/ml/analogy/*.csv（ANALOGY_DATA_DIR で変更可、gitignore 対象）
 * 使い方:
 *   node scripts/ml/analogy/export_pool.js            # CI（長期分は Storage を使う）
 *   node scripts/ml/analogy/export_pool.js --no-cache # 手元（Storage を読み書きしない）
 *   node scripts/ml/analogy/export_pool.js --refresh-kb # 長期分を DB から取り直して Storage を上書き
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { supabase } from "../../lib/supabaseClient.js";
import { BUCKET, ensureBucket } from "./storage.js";
import { assertCachedHeader } from "./storageRules.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR =
  process.env.ANALOGY_DATA_DIR ||
  path.join(__dirname, "../../../data/ml/analogy");
const PAGE = 1000;
const KB_CACHE_VERSION = "v1";
const CONCURRENCY = 6;

const args = new Set(process.argv.slice(2));
const USE_CACHE = !args.has("--no-cache");
const REFRESH_KB = args.has("--refresh-kb");

const csvCell = (v) => {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (cols, rows) =>
  rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");

const ym = (y, m) => `${y}-${String(m).padStart(2, "0")}`;
function months(from, to) {
  const out = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    const next = m === 12 ? ym(y + 1, 1) : ym(y, m + 1);
    out.push([ym(y, m), next]);
    [y, m] = next.split("-").map(Number);
  }
  return out;
}
const thisMonth = () => new Date().toISOString().slice(0, 7);

async function fetchRange(table, cols, orderCols, rangeCol, lo, hi) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    for (let attempt = 1; ; attempt++) {
      let q = supabase.from(table).select(cols);
      if (rangeCol) q = q.gte(rangeCol, lo).lt(rangeCol, hi);
      for (const c of orderCols) q = q.order(c);
      const { data, error } = await q.range(from, from + PAGE - 1);
      if (!error) {
        rows.push(...data);
        if (data.length < PAGE) return rows;
        break;
      }
      if (attempt >= 5)
        throw new Error(`${table} ${lo} offset=${from}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** 長期分の1か月: Storage にあればそれを、無ければ DB から読んで Storage に置く */
async function kbMonth(t, lo, hi) {
  const key = `source/${KB_CACHE_VERSION}/${t.name}/${lo}.csv.gz`;
  if (USE_CACHE && !REFRESH_KB) {
    const { data, error } = await supabase.storage.from(BUCKET).download(key);
    if (!error) {
      // キャッシュは先頭行に列名を持つ。列が今のコードと違えば黙って読まずに失敗する
      const csv = zlib
        .gunzipSync(Buffer.from(await data.arrayBuffer()))
        .toString();
      assertCachedHeader(csv, t.colList, key);
      const nl = csv.indexOf("
");
      return nl === -1 ? "" : csv.slice(nl + 1);
    }
  }
  const rows = await fetchRange(t.table, t.cols, t.order, t.rangeCol, lo, hi);
  // 長期のアーカイブに空の月は無い。0行を置くと以後ずっと空のまま読まれるので失敗にする
  if (rows.length === 0) throw new Error(`${t.table} ${lo}: 0行（キャッシュしない）`);
  const body = toCsv(t.colList, rows);
  if (USE_CACHE) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(key, zlib.gzipSync(`${t.colList.join(",")}
${body}`), {
        upsert: true,
        contentType: "application/gzip",
      });
    if (error) throw new Error(`${key} の保存に失敗: ${error.message}`);
  }
  return body;
}

async function exportTable(t) {
  t.colList = t.cols.split(",").map((s) => s.trim());
  const chunks = new Array(t.ranges.length);
  let next = 0;
  async function worker() {
    while (next < t.ranges.length) {
      const i = next++;
      const [lo, hi] = t.ranges[i];
      chunks[i] = t.kb
        ? await kbMonth(t, lo, hi)
        : toCsv(
            t.colList,
            await fetchRange(t.table, t.cols, t.order, t.rangeCol, lo, hi),
          );
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const body = chunks.filter((c) => c.length > 0).join("\n");
  const n = body ? body.split("\n").length : 0;
  if (n === 0) throw new Error(`${t.name}: 0行（期待は1行以上）`);
  fs.writeFileSync(
    path.join(OUT_DIR, `${t.name}.csv`),
    `${t.colList.join(",")}\n${body}\n`,
  );
  console.log(`✅ ${t.name}.csv ${n.toLocaleString()}行`);
}

const KB_MONTHS = months("2019-04", "2025-12");
const MAIN_MONTHS = months("2025-12", thisMonth());

const TABLES = [
  {
    name: "kb_boats",
    table: "kb_archive_boats",
    cols: "race_id, boat_number, racer_id, class, age, branch, weight, national_win_rate, national_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, exhibition_time, start_timing, is_flying, is_late_start, finish_raw, finish_rank",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: KB_MONTHS,
    kb: true,
  },
  {
    name: "kb_races",
    table: "kb_archive_races",
    cols: "race_id, venue_day_id, race_date, venue_code, race_number, stage_kind, weather, wind_direction, wind_speed, wave_height, has_result",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: KB_MONTHS,
    kb: true,
  },
  {
    name: "kb_venue_days",
    table: "kb_archive_venue_days",
    cols: "venue_day_id, race_date, venue_code, series_day, is_final_day, race_grade",
    order: ["venue_day_id"],
    rangeCol: "venue_day_id",
    ranges: KB_MONTHS,
    kb: true,
  },
  {
    name: "race_series",
    table: "race_series",
    cols: "venue_code, start_date, end_date, grade",
    order: ["venue_code", "start_date"],
    rangeCol: null,
    ranges: [[null, null]],
  },
  {
    name: "races",
    table: "races",
    cols: "race_id, race_date, venue_code, race_number, race_grade, cancellation_status",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "entries",
    table: "race_entries",
    cols: "race_id, boat_number, racer_id, grade, age, win_rate, global_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, weight_kg, branch, is_absent",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "exhibition",
    table: "exhibition_data",
    cols: "race_id, boat_number, exhibition_time, is_absent",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "conditions",
    table: "race_conditions",
    cols: "race_id, weather, wind_direction, wind_speed, wave_height, series_day, is_final_day, race_stage",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "results",
    table: "race_results",
    cols: "race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race",
    order: ["race_id"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
  {
    name: "start_timings",
    table: "race_start_timings",
    cols: "race_id, boat_number, start_timing, is_flying, is_late_start",
    order: ["race_id", "boat_number"],
    rangeCol: "race_id",
    ranges: MAIN_MONTHS,
  },
];

async function main() {
  if (!supabase) throw new Error("Supabase 環境変数が未設定（.env.local）");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  if (USE_CACHE) await ensureBucket();
  for (const t of TABLES) {
    const t0 = Date.now();
    await exportTable(t);
    console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}

main().catch((e) => {
  console.error("❌", e.message || e);
  process.exit(1);
});
