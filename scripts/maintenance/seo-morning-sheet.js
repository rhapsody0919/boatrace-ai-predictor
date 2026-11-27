/**
 * seo-morning-sheet.js - SEO の朝の1枚を作って標準出力に出す（SEO データの輪 PR6。実行は窓口。作り手は本番に繋がない）。
 *
 * 見張り（growth 表の最新の日と行数）が緑のときだけ、察知（seoDetect）と効き（seoEffect）を出す。
 * 出力は語・順位の帯・表示の桁だけで、正確な数字は出さない。出力を repo・Actions のログ・PR 本文・Linear の票本文に貼らない
 * （--tickets N は「SEO:」票の雛形。語・帯・桁だけで数字は無い）。ファイルには書かない。
 *
 * 使い方: node scripts/maintenance/seo-morning-sheet.js [--articles a.json] [--changes c.json] [--core-updates u.json] [--tickets N]
 *          [--local-dir <dir> [--series s.json]]
 *   --local-dir: Supabase を読まず、<dir>/gsc_daily.json・gsc_page_daily.json（google-detail-collect.js の日別の出力）を読む（鍵が要らない）。
 *     見張りはファイルの最新の date から同じ規則で出す。URL 検査は <dir>/url_inspection.json（無ければ空）。
 *   --series s.json: [{ venue_code, start_date, end_date, title, grade }]（race_series の代わり。--local-dir のときだけ。無ければ空）
 *   a.json: [{ id, url, publishDate, measuredAt?, editDate?, mergedAt? }]（editDate がある物は改稿の判定に使う）
 *   c.json: [{ id, mergedAt, pages: [正規化した page], siteWide }]（同じ反映の枠の変更。git のマージ時刻から窓口が組む）
 *   u.json: [{ from, to }]（コアアップデートの期間の台帳。無ければ空）
 * 環境変数: SUPABASE_URL・SUPABASE_SERVICE_KEY（読むだけ。--local-dir のときは要らない）
 * 終了コード: 0 出せた（見張りが赤でも出せた）、1 設定の誤り・読みの失敗
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { ptToday, safeError } from "../lib/growth/gscDaily.js";
import { isMissingTable } from "../lib/growth/gscPageDaily.js";
import { buildSignals, freshnessReport, isGreen, articleLines, renderSheet, rewriteLine, ticketTemplate } from "../lib/growth/morningSheet.js";
import { canonicalMismatches } from "../lib/growth/localInspection.js";
import { localSource } from "../lib/growth/localSheetSource.js";
import { detectMovers, normalizePage, windows } from "../lib/growth/seoDetect.js";

const PAGE = 1000;
const DAY = 86400000;
const TABLES = [
  { table: "growth_gsc_daily", required: true },
  { table: "growth_gsc_page_daily", required: false }, // 新しい表（適用前は missing で必須でない）
  { table: "growth_url_inspection", required: false },
];

function parseArgs(argv) {
  const o = { articles: null, changes: null, coreUpdates: null, tickets: 0, localDir: null, series: null };
  const keys = { "--articles": "articles", "--changes": "changes", "--core-updates": "coreUpdates", "--tickets": "tickets", "--local-dir": "localDir", "--series": "series" };
  for (let i = 0; i < argv.length; i++) {
    const k = keys[argv[i]];
    if (!k) throw new Error(`知らない引数: ${argv[i]}`);
    o[k] = k === "tickets" ? Number(argv[++i]) : argv[++i];
  }
  if (!Number.isInteger(o.tickets) || o.tickets < 0) throw new Error("--tickets は 0 以上の整数");
  if (o.series && !o.localDir) throw new Error("--series は --local-dir と一緒に使う（Supabase の版は race_series を読む）");
  return o;
}

const readJson = (p) => (p ? JSON.parse(fs.readFileSync(p, "utf8")) : []);
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/** .range() の輪で全部読む（1000行で黙って切れない）。表が無ければ null */
async function readAll(db, table, columns, build) {
  const rows = [];
  for (;;) {
    const { data, error } = await build(db.from(table).select(columns)).range(rows.length, rows.length + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return null;
      throw new Error(`${table} の読みの失敗: ${safeError(error)}`);
    }
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function tableStats(db, { table, required }) {
  const latest = await db.from(table).select("*", { count: "exact", head: true });
  if (latest.error) {
    if (isMissingTable(latest.error)) return { table, required, missing: true };
    throw new Error(`${table} の確認の失敗: ${safeError(latest.error)}`);
  }
  const col = table === "growth_url_inspection" ? "inspected_on" : "date";
  const { data, error } = await db.from(table).select(col).order(col, { ascending: false }).limit(1);
  if (error) throw new Error(`${table} の最新の日の読みの失敗: ${safeError(error)}`);
  return { table, required, rowCount: latest.count, maxDate: data[0]?.[col] ?? null };
}

/** Supabase の読み口。口は localSource と同じ（tableStats・daily・series・inspections・pageDaily） */
function supabaseSource(db) {
  return {
    tableStats: (t) => tableStats(db, t),
    daily: (from, to) =>
      readAll(db, "growth_gsc_daily", "date,query,page,clicks,impressions,position", (q) =>
        q.gte("date", from).lte("date", to).order("date").order("query").order("page")),
    series: (from, to) =>
      readAll(db, "race_series", "venue_code,start_date,end_date,title,grade", (q) =>
        q.lte("start_date", to).gte("end_date", from).order("venue_code").order("start_date")),
    inspections: async () =>
      (await readAll(db, "growth_url_inspection", "url,inspected_on,canonical_ok,verdict,coverage_state,google_canonical,user_canonical", (q) => q.order("url").order("inspected_on"))) ?? [],
    pageDaily: async (from) =>
      (await readAll(db, "growth_gsc_page_daily", "date,page,clicks,impressions", (q) => q.gte("date", from).order("date").order("page"))) ?? [],
  };
}

async function loadSignals(src, today) {
  const w = windows(today);
  const rows = await src.daily(w.prev.from, today);
  const series = await src.series(w.prev.from, today);
  const insp = await src.inspections();
  const latest = {};
  for (const r of insp) latest[r.url] = r; // inspected_on の昇順なので最後が最新
  const inspections = Object.fromEntries(Object.values(latest).map((r) => [normalizePage(r.url), r.canonical_ok]));
  const signals = buildSignals(rows, today, { series: series ?? [], inspections });
  const falling = detectMovers(rows, today, { series: series ?? [] }).filter((m) => m.kind === "falling").length;
  return { signals, falling, inspectionRows: latest };
}

async function loadArticleLines(src, today, articles, args, inspectionRows) {
  if (articles.length === 0) return [];
  const from = isoDay(Math.min(...articles.map((a) => Date.parse(`${a.editDate ?? a.publishDate}T00:00:00Z`) - 28 * DAY)));
  const pageDaily = await src.pageDaily(from);
  const totals = {};
  for (const r of pageDaily) {
    const k = normalizePage(r.page);
    totals[k] ??= { impressions: 0, clicks: 0 };
    totals[k].impressions += r.impressions;
    totals[k].clicks += r.clicks;
  }
  const lines = articleLines(articles, today, { totals, inspectionRows });
  const opts = { changes: readJson(args.changes), coreUpdates: readJson(args.coreUpdates) };
  for (const a of articles.filter((x) => x.editDate)) {
    lines.push(rewriteLine({ id: a.id ?? a.url, page: normalizePage(a.url), editDate: a.editDate, mergedAt: a.mergedAt }, pageDaily, today, opts));
  }
  return lines;
}

/** 察知の窓の終わり。今日でなく growth_gsc_daily の最新の日にする（GSC は約3日遅れ、今日で切ると直近の窓の日が欠け、伸びた語が出にくく落ちた語が出やすい）。最新の日が無ければ今日 */
export function signalWindowEnd(freshness, today) {
  const d = freshness.find((t) => t.table === "growth_gsc_daily")?.maxDate;
  return d && d < today ? d : today;
}

/** Google が別の正規ページを選んだ URL の節（URL と状態の名前だけ。数字は件数だけ）。検査の行が無ければ出さない */
export function canonicalLines(latestRows) {
  if (latestRows.length === 0) return [];
  const list = canonicalMismatches(latestRows);
  const head = `\n[正規ページ: Google が別のページを選んだ URL（検査した ${latestRows.length} URL の最新の結果のうち ${list.length}）]`;
  const byTarget = new Map();
  for (const m of list) byTarget.set(normalizePage(m.googleCanonical), (byTarget.get(normalizePage(m.googleCanonical)) ?? 0) + 1);
  // 同じ型のページが1ページに集まっていたら、Googlebot が同じ中身（読み込み中・エラー）を見た印（docs/knowledge/seo.md、2026-10-28 の選手ページ）
  const piles = [...byTarget].filter(([, n]) => n >= 2).map(([page, n]) => `- 集まり: ${page} に ${n} URL（描画の失敗を疑う）`);
  return [head, ...piles, ...list.map((m) => `- ${m.url} → Google: ${m.googleCanonical}（指定: ${m.userCanonical ?? "なし"}・${m.coverageState ?? "状態不明"}・${m.inspectedOn}）`)];
}

/** 読み口から1枚（と票の雛形）を組む。出力は行の配列 */
export async function buildSheetLines(src, args, today, articles = readJson(args.articles)) {
  const freshness = freshnessReport(await Promise.all(TABLES.map((t) => src.tableStats(t))), today);
  const green = isGreen(freshness);
  const dataEnd = signalWindowEnd(freshness, today);
  const loaded = green ? await loadSignals(src, dataEnd) : { signals: [], falling: 0, inspectionRows: {} };
  const articleLinesOut = green ? await loadArticleLines(src, today, articles, args, loaded.inspectionRows) : [];
  const out = [renderSheet({ today, freshness, signals: loaded.signals, articleLinesOut, fallingCount: loaded.falling })];
  if (green) out.push(`察知の窓の終わり: ${dataEnd}（growth_gsc_daily の最新の日。GSC の遅れで欠けた日を窓に入れない）`);
  if (green) out.push(...canonicalLines(Object.values(loaded.inspectionRows)));
  for (const s of loaded.signals.slice(0, args.tickets)) out.push(`\n--- 「SEO:」票の雛形 ---\n${ticketTemplate(s, today)}`);
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let src;
  if (args.localDir) {
    src = localSource(args.localDir, args.series);
  } else {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error("環境変数が無い: SUPABASE_URL・SUPABASE_SERVICE_KEY（読むだけ。鍵が無ければ --local-dir <dir> で手元の JSON を読む。作り手は本番に繋がない）");
    }
    src = supabaseSource(createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }));
  }
  for (const line of await buildSheetLines(src, args, ptToday(new Date()))) console.log(line);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(`seo-morning-sheet: ${err.message}`);
    process.exit(1);
  });
}
