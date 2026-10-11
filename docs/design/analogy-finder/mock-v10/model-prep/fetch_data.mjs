/**
 * BOA-271 model-prep: 本番の版のモデルと学習データ（test 期間の特徴量を作る元）を読み取り専用で取得する。
 * - Storage `analogy/{version}/model_*.txt.gz`・train_meta.json.gz 等: download のみ
 * - 長期（kb_*）: Storage `analogy/source/v1/{table}/{YYYY-MM}.csv.gz` を download のみ（無ければ失敗。DB から取り直さない・upload しない）
 * - 本体（2025-12〜）: DB を SELECT（export_pool.js と同じ列・同じ範囲・同じ並び）
 * export_pool.js と違い、Storage への upload・createBucket は一切しない。
 *
 * 使い方: node fetch_data.mjs [models|kb|main|all]
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { supabase } from "../master-src/scripts/lib/supabaseClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, "data");
const MODELS = path.join(__dirname, "models");
const BUCKET = "analogy";
const KB_CACHE_VERSION = "v1"; // export_pool.js と同じ
const PAGE = 1000;
const CONCURRENCY = 3; // 開発機の負荷を見て export_pool.js（6）より控えめ
const MAIN_TO = "2026-10"; // 版の test の終わり（2026-10-02）を含む月まで

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

async function download(key) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) throw new Error(`${key}: ${error.message || JSON.stringify(error)}`);
  return Buffer.from(await data.arrayBuffer());
}

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
      if (attempt >= 5) throw new Error(`${table} ${lo} offset=${from}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const KB_MONTHS = months("2019-04", "2025-12");
const MAIN_MONTHS = months("2025-12", MAIN_TO);
// export_pool.js の TABLES をそのまま写す
const TABLES = [
  { name: "kb_boats", table: "kb_archive_boats", cols: "race_id, boat_number, racer_id, class, age, branch, weight, national_win_rate, national_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, exhibition_time, start_timing, is_flying, is_late_start, finish_raw, finish_rank", order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: KB_MONTHS, kb: true },
  { name: "kb_races", table: "kb_archive_races", cols: "race_id, venue_day_id, race_date, venue_code, race_number, stage_kind, weather, wind_direction, wind_speed, wave_height, has_result", order: ["race_id"], rangeCol: "race_id", ranges: KB_MONTHS, kb: true },
  { name: "kb_venue_days", table: "kb_archive_venue_days", cols: "venue_day_id, race_date, venue_code, series_day, is_final_day, race_grade", order: ["venue_day_id"], rangeCol: "venue_day_id", ranges: KB_MONTHS, kb: true },
  { name: "race_series", table: "race_series", cols: "venue_code, start_date, end_date, grade", order: ["venue_code", "start_date"], rangeCol: null, ranges: [[null, null]] },
  { name: "races", table: "races", cols: "race_id, race_date, venue_code, race_number, race_grade, cancellation_status", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_MONTHS },
  { name: "entries", table: "race_entries", cols: "race_id, boat_number, racer_id, grade, age, win_rate, global_2rate, local_win_rate, local_2rate, motor_2rate, boat_2rate, weight_kg, branch, is_absent", order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: MAIN_MONTHS },
  { name: "exhibition", table: "exhibition_data", cols: "race_id, boat_number, exhibition_time, is_absent", order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: MAIN_MONTHS },
  { name: "conditions", table: "race_conditions", cols: "race_id, weather, wind_direction, wind_speed, wave_height, series_day, is_final_day, race_stage", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_MONTHS },
  { name: "results", table: "race_results", cols: "race_id, rank1, rank2, rank3, rank4, rank5, rank6, is_cancelled, is_no_race", order: ["race_id"], rangeCol: "race_id", ranges: MAIN_MONTHS },
  { name: "start_timings", table: "race_start_timings", cols: "race_id, boat_number, start_timing, is_flying, is_late_start", order: ["race_id", "boat_number"], rangeCol: "race_id", ranges: MAIN_MONTHS },
];

async function kbMonth(t, lo) {
  const key = `source/${KB_CACHE_VERSION}/${t.name}/${lo}.csv.gz`;
  const csv = zlib.gunzipSync(await download(key)).toString();
  const header = csv.slice(0, csv.indexOf("\n"));
  if (header !== t.colList.join(",")) throw new Error(`${key}: 列が違う ${header}`);
  const nl = csv.indexOf("\n");
  return nl === -1 ? "" : csv.slice(nl + 1);
}

async function exportTable(t) {
  t.colList = t.cols.split(",").map((s) => s.trim());
  const chunks = new Array(t.ranges.length);
  let next = 0;
  async function worker() {
    while (next < t.ranges.length) {
      const i = next++;
      const [lo, hi] = t.ranges[i];
      chunks[i] = t.kb ? await kbMonth(t, lo) : toCsv(t.colList, await fetchRange(t.table, t.cols, t.order, t.rangeCol, lo, hi));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const body = chunks.filter((c) => c.length > 0).join("\n");
  const n = body ? body.split("\n").length : 0;
  if (n === 0) throw new Error(`${t.name}: 0行`);
  fs.writeFileSync(path.join(DATA, `${t.name}.csv`), `${t.colList.join(",")}\n${body}\n`);
  console.log(`${t.name}.csv ${n}行`);
  return { rows: n, sha256: crypto.createHash("sha256").update(body).digest("hex") };
}

async function models(version) {
  fs.mkdirSync(path.join(MODELS, version), { recursive: true });
  const { data: list, error } = await supabase.storage.from(BUCKET).list(version, { limit: 100 });
  if (error) throw new Error(`list ${version}: ${error.message}`);
  const names = list.map((e) => e.name);
  console.log(`${version}/: ${names.join(", ")}`);
  for (const n of names.filter((x) => x.endsWith(".gz"))) {
    const buf = zlib.gunzipSync(await download(`${version}/${n}`));
    fs.writeFileSync(path.join(MODELS, version, n.replace(/\.gz$/, "")), buf);
    console.log(`  ${n} -> ${buf.length}B`);
  }
  return names;
}

async function main() {
  const cmd = process.argv[2] || "all";
  fs.mkdirSync(DATA, { recursive: true });
  const { data: act, error } = await supabase.from("analogy_models").select("model_version").eq("is_active", true);
  if (error) throw new Error(error.message);
  const version = act[0].model_version;
  console.log(`active version: ${version}`);
  const manifestPath = path.join(DATA, "fetch_manifest.json");
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : { tables: {} };
  manifest.version = version;
  if (cmd === "models" || cmd === "all") manifest.storage_files = await models(version);
  for (const t of TABLES) {
    if (cmd === "kb" && !t.kb) continue;
    if (cmd === "main" && t.kb) continue;
    if (cmd === "models") continue;
    const t0 = Date.now();
    manifest.tables[t.name] = { ...(await exportTable(t)), fetchedAt: new Date().toISOString() };
    console.log(`  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

main().catch((e) => {
  console.error("ERR", e.message || e);
  process.exit(1);
});
