/**
 * BOA-635 T0-1 の確認（事前登録 docs/design/past-rate-check/analysis/label-threshold-prereg.md）。読み取りだけ。
 *  1. export の欠けの照合: 2025-12-03〜2026-09-30 の日ごとの races・race_results・race_start_timings の行数を
 *     本番の DB と export の CSV で比べる
 *  2. race_entries.win_rate の上書きの確認: updated_at・created_at の入り方と、レース日・期の切り替わり（5/1・11/1）との前後
 *  3. 固定データの検査用に、本番の layer ファイル（2026-10-06 以降）を API から取る
 *
 * 実行: node --env-file=.env.local scripts/analysis/past-rate-check/label-threshold-checks.mjs
 *   環境変数 ANALOGY_DATA_DIR（export の場所）、LT_WORK（出力先。既定 data/analysis/past-rate-check/work）
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = process.env.REPO_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { supabase } = await import(path.join(ROOT, "scripts/lib/supabaseClient.js"));
const SRC = process.env.ANALOGY_DATA_DIR || path.join(ROOT, "data/ml/analogy");
const WORK = process.env.LT_WORK || path.join(ROOT, "data/analysis/past-rate-check/work");
const API = "https://www.boat-ai.jp/api/analogy/layer/";
const FROM = "2025-12-03", TO = "2026-09-30";
fs.mkdirSync(WORK, { recursive: true });

const days = [];
for (let d = new Date(FROM + "T00:00:00Z"); d <= new Date(TO + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1))
  days.push(d.toISOString().slice(0, 10));
const next = (s) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function csvCounts(name) {
  const counts = {};
  const text = fs.readFileSync(path.join(SRC, `${name}.csv`), "utf8");
  for (const line of text.split("\n").slice(1)) {
    if (!line) continue;
    const day = line.slice(0, 10);
    counts[day] = (counts[day] || 0) + 1;
  }
  return counts;
}

async function dbCount(table, day) {
  for (let t = 0; t < 3; t++) {
    const { count, error } = await supabase.from(table).select("race_id", { count: "exact", head: true })
      .gte("race_id", day).lt("race_id", next(day));
    if (!error) return count;
    if (t === 2) throw new Error(`${table} ${day}: ${error.message}`);
  }
}

async function exportGap() {
  const tables = [["races", "races"], ["race_results", "results"], ["race_start_timings", "start_timings"]];
  const out = {};
  for (const [table, csv] of tables) {
    const ex = csvCounts(csv);
    const rows = [];
    for (const day of days) {
      const db = await dbCount(table, day);
      const e = ex[day] || 0;
      rows.push({ day, db, export: e, diff: e - db, rel: db ? (e - db) / db : (e ? 1 : 0) });
    }
    out[table] = {
      days: rows.length, db_total: rows.reduce((s, r) => s + r.db, 0), export_total: rows.reduce((s, r) => s + r.export, 0),
      over_1pct: rows.filter((r) => Math.abs(r.rel) > 0.01),
    };
    console.log(table, out[table].db_total, out[table].export_total, "差が1%超の日", out[table].over_1pct.length);
  }
  return out;
}

async function fetchAll(q) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function winRate() {
  // 月ごと: 行数・updated_at／created_at の非 null 件数、updated_at（JST の日付）がレース日より後の件数、
  // 期の切り替わり（5/1・11/1）をまたいで更新された件数
  const out = [], all = [];
  const months = ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
  for (const m of months) {
    const [y, mo] = m.split("-").map(Number);
    const lo = `${m}-01`, hiFix = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
    const { count: n } = await supabase.from("race_entries").select("race_id", { count: "exact", head: true }).gte("race_id", lo).lt("race_id", hiFix);
    const rows = await fetchAll(() => supabase.from("race_entries").select("race_id, boat_number, created_at, updated_at")
      .gte("race_id", lo).lt("race_id", hiFix).not("updated_at", "is", null).order("race_id").order("boat_number"));
    all.push(...rows);
    const jst = (s) => new Date(new Date(s).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    let after = 0, crossTerm = 0, updNeCreated = 0, maxLagDays = 0;
    for (const r of rows) {
      const day = r.race_id.slice(0, 10), u = jst(r.updated_at);
      if (u > day) {
        after++;
        maxLagDays = Math.max(maxLagDays, (new Date(u) - new Date(day)) / 864e5);
        const y = Number(day.slice(0, 4));
        const terms = [`${y}-05-01`, `${y}-11-01`, `${y + 1}-05-01`];
        if (terms.some((t) => day < t && u >= t)) crossTerm++;
      }
      if (r.created_at && r.created_at !== r.updated_at) updNeCreated++;
    }
    out.push({ month: m, rows: n, updated_at_set: rows.length, updated_after_race_day: after,
      updated_across_term_switch: crossTerm, updated_ne_created: updNeCreated, max_lag_days: maxLagDays });
    console.log(out.at(-1));
  }
  fs.writeFileSync(path.join(WORK, "entries_updated.csv"), "race_id,boat_number,created_at,updated_at\n"
    + all.map((r) => [r.race_id, r.boat_number, r.created_at ?? "", r.updated_at].join(",")).join("\n"));
  return out;
}

async function prodLayers() {
  // 2026-10-06〜10-12 の各日、会場ごとに 1R・6R・12R から取れたもの（status=ok）を最大5レース
  const got = [];
  for (const day of ["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12"]) {
    let k = 0;
    for (let v = 1; v <= 24 && k < 5; v++) {
      for (const r of [1, 6, 12]) {
        if (k >= 5) break;
        const rid = `${day}-${String(v).padStart(2, "0")}-${String(r).padStart(2, "0")}`;
        const res = await fetch(API + rid);
        if (!res.ok) continue;
        const j = await res.json();
        if (j.status !== "ok") continue;
        got.push(j);
        k++;
      }
    }
  }
  fs.writeFileSync(path.join(WORK, "prod_layers.json"), JSON.stringify(got));
  console.log("prod layers", got.length);
  return got.map((j) => ({ race_id: j.race_id, run_id: j.run_id, n_total: j.n_total, pool_cutoff: j.pool_cutoff }));
}

const result = { generated_at: new Date().toISOString(), export_dir: SRC, export_gap: await exportGap(),
  win_rate_updates: await winRate(), prod_layers: await prodLayers() };
fs.writeFileSync(path.join(WORK, "checks.json"), JSON.stringify(result, null, 1));
