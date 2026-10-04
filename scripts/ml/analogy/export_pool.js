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
 * （古いキャッシュを読まなくなる。古い版の Storage の物は自動では消えないので、手で消す）か、--refresh-kb で取り直す。本体分（2025-12〜）は補完・訂正で値が変わるので毎回 DB から読む
 * （約10か月分で、長期の約1/8）。
 *
 * 出力: data/ml/analogy/*.csv（ANALOGY_DATA_DIR で変更可、gitignore 対象）と export_manifest.json
 *   （テーブルごとの行数・先頭列の最大値・内容の SHA-256。train.py が版のメトリクスに残し、後から
 *   どのデータで学習した版かを確かめられるようにする）
 * 使い方:
 *   node scripts/ml/analogy/export_pool.js            # CI（長期分は Storage を使う）
 *   node scripts/ml/analogy/export_pool.js --no-cache # 手元（Storage を読み書きしない）
 *   node scripts/ml/analogy/export_pool.js --no-cache races results # 指定したテーブルだけ（動作確認用）
 *   node scripts/ml/analogy/export_pool.js --refresh-kb # 長期分を DB から取り直して Storage を上書き
 *   node scripts/ml/analogy/export_pool.js --daily      # 日次の特徴量ジョブ（BOA-271 B、daily_features.py の前）
 *
 * 日次（--daily）: DB から読むのは本体分の前月と当月（JST）だけ。それより前の本体分は、週次の学習が置いた
 * `analogy/source/main/{テーブル}/{YYYY-MM}.csv.gz`、長期分は `analogy/source/{KB_CACHE_VERSION}/` から読む。
 * Storage には書かない（読み取りだけ）。キャッシュの月が1つでも欠けていれば失敗する（欠けた月を飛ばすと
 * 選手の過去30走が黙って短くなるため）。DB は7日ずつに分けて読む（深い OFFSET を避ける）。
 * 週次（--daily でなく Storage を使うとき）: 本体分の当月より前の月を `source/main/` に上書きで置く。
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { supabase } from "../../lib/supabaseClient.js";
import { BUCKET, ensureBucket } from "./storage.js";
import { assertCachedHeader } from "./storageRules.js";
import { weekRanges } from "./week-ranges.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR =
  process.env.ANALOGY_DATA_DIR ||
  path.join(__dirname, "../../../data/ml/analogy");
const PAGE = 1000;
// v2: BOA-696（kb_archive_venue_days.is_final_day を race_series の終了日で補う）の後。v1 は最終日が全件 false
const KB_CACHE_VERSION = "v2";
const CONCURRENCY = 6;

const args = new Set(process.argv.slice(2));
const USE_CACHE = !args.has("--no-cache");
const REFRESH_KB = args.has("--refresh-kb");
const DAILY = args.has("--daily");
if (DAILY && !USE_CACHE)
  throw new Error(
    "--daily は Storage のキャッシュを読む（--no-cache と同時に使えない）",
  );
const ONLY = [...args].filter((a) => !a.startsWith("--"));

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
// 月の境目は JST で決める（UTC だと毎月1日の JST 0:00〜9:00 に当月を取りこぼす。race_id の日付は JST）
const thisMonth = () =>
  new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 7);
const prevMonth = (m) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 1 ? ym(y - 1, 12) : ym(y, mo - 1);
};

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

/** Storage のキャッシュ（先頭行が列名の CSV.gz）の本体。無ければ null */
async function readCache(t, key) {
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error) return null;
  // キャッシュは先頭行に列名を持つ。列が今のコードと違えば黙って読まずに失敗する
  const csv = zlib.gunzipSync(Buffer.from(await data.arrayBuffer())).toString();
  assertCachedHeader(csv, t.colList, key);
  const nl = csv.indexOf("\n");
  return nl === -1 ? "" : csv.slice(nl + 1);
}

async function writeCache(t, key, body) {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, zlib.gzipSync(`${t.colList.join(",")}\n${body}`), {
      upsert: true,
      contentType: "application/gzip",
    });
  if (error) throw new Error(`${key} の保存に失敗: ${error.message}`);
}

const mainCacheKey = (t, lo) => `source/main/${t.name}/${lo}.csv.gz`;

/** 本体分の1か月。日次は前月より前を Storage から（無ければ失敗）、前月・当月は DB から7日ずつ読む。
 * 週次は DB から読み、当月より前の月を Storage に置く（前月も置く。月が替わった直後の日次は、前々月を
 * キャッシュから読むため。前月は補完で変わりうるが、日次は前月を DB から読むので古い値は使わない） */
async function mainMonth(t, lo, hi) {
  const month = thisMonth();
  if (DAILY && lo < prevMonth(month)) {
    const body = await readCache(t, mainCacheKey(t, lo));
    if (body === null)
      throw new Error(
        `${mainCacheKey(t, lo)} がありません（週次の学習が置く。日次は DB から読み直さない）`,
      );
    return body;
  }
  const ranges = DAILY ? weekRanges(lo, hi) : [[lo, hi]];
  const rows = [];
  for (const [a, b] of ranges)
    rows.push(
      ...(await fetchRange(t.table, t.cols, t.order, t.rangeCol, a, b)),
    );
  const body = toCsv(t.colList, rows);
  if (USE_CACHE && !DAILY && lo < month)
    await writeCache(t, mainCacheKey(t, lo), body);
  return body;
}

/** 長期分の1か月: Storage にあればそれを、無ければ DB から読んで Storage に置く（日次は無ければ失敗） */
async function kbMonth(t, lo, hi) {
  const key = `source/${KB_CACHE_VERSION}/${t.name}/${lo}.csv.gz`;
  if (USE_CACHE && !REFRESH_KB) {
    const body = await readCache(t, key);
    if (body !== null) return body;
    if (DAILY)
      throw new Error(
        `${key} がありません（日次は DB から長期分を読み直さない）`,
      );
  }
  const rows = await fetchRange(t.table, t.cols, t.order, t.rangeCol, lo, hi);
  // 長期のアーカイブに空の月は無い。0行を置くと以後ずっと空のまま読まれるので失敗にする
  if (rows.length === 0)
    throw new Error(`${t.table} ${lo}: 0行（キャッシュしない）`);
  const body = toCsv(t.colList, rows);
  if (USE_CACHE) await writeCache(t, key, body);
  return body;
}

const lastFirstColumn = (body) => {
  const line = body.slice(body.lastIndexOf("\n") + 1);
  return line.slice(0, line.indexOf(","));
};

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
        : t.rangeCol
          ? await mainMonth(t, lo, hi)
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
  return {
    rows: n,
    // 先頭列（race_id・venue_day_id 等）の最大値＝最新のデータがいつまで入っていたか。
    // 月ごとの範囲は昇順に並び、範囲の中も先頭列の昇順なので、最後の行の先頭列が最大
    maxKey: lastFirstColumn(body),
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
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
  if (USE_CACHE && !DAILY) await ensureBucket();
  // テーブルを指定して書き出したときは、前回の manifest に上書きで足す（指定しなかったテーブルの記録を消さない）
  const manifestPath = path.join(OUT_DIR, "export_manifest.json");
  const previous =
    ONLY.length && fs.existsSync(manifestPath)
      ? JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      : { tables: {} };
  const manifest = {
    exportedAt: new Date().toISOString(),
    tables: { ...previous.tables },
  };
  for (const t of TABLES) {
    if (ONLY.length && !ONLY.includes(t.name)) continue;
    const t0 = Date.now();
    manifest.tables[t.name] = await exportTable(t);
    console.log(`   (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error("❌", e.message || e);
    process.exit(1);
  });
}
