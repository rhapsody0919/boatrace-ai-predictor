/**
 * inspect-new-articles.js - 公開から D+1・D+3・D+7 の記事の索引の状態を URL Inspection で確かめ、growth_url_inspection へ書く
 * （SEO データの輪 PR5。実行は窓口。作り手は本番に繋がない）。
 *
 * 記事の一覧は JSON ファイル（[{ "url": "https://www.boat-ai.jp/blog/…", "publishDate": "YYYY-MM-DD" }]）で渡す。
 * 一覧を作るのは窓口（「SEO:」票の記事・public/blog の公開日から）。確認が済んだ (url, 確認の日) は飛ばすので、毎日回してよい。
 * 公開してよい出力は URL と状態の名前と件数だけ。
 *
 * 使い方: node scripts/maintenance/inspect-new-articles.js --articles <file.json> [--max 100] [--dry-run]
 * 環境変数: SEARCH_CONSOLE_SITE_URL・GOOGLE_SERVICE_ACCOUNT_KEY_PATH・（--dry-run 以外）SUPABASE_URL・SUPABASE_SERVICE_KEY
 * 終了コード: 0 済み、1 設定の誤り・表が無い・検査か書き込みの失敗
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import { ptToday } from "../lib/growth/gscDaily.js";
import {
  INSPECTION_LIMITS,
  assertInspectionTableExists,
  inspectUrl,
  pendingInspections,
  readDoneInspections,
  toInspectionRow,
  writeInspections,
} from "../lib/growth/urlInspection.js";

function parseArgs(argv) {
  const o = { articles: null, max: INSPECTION_LIMITS.defaultMax, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dry-run") o.dryRun = true;
    else if (argv[i] === "--articles") o.articles = argv[++i];
    else if (argv[i] === "--max") o.max = Number(argv[++i]);
    else throw new Error(`知らない引数: ${argv[i]}（--articles <file>・--max N・--dry-run）`);
  }
  if (!o.articles) throw new Error("--articles <file.json> が要る（[{ url, publishDate }] の一覧）");
  if (!Number.isInteger(o.max) || o.max < 1 || o.max > INSPECTION_LIMITS.perDay) {
    throw new Error(`--max は 1〜${INSPECTION_LIMITS.perDay} の整数`);
  }
  return o;
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) throw new Error(`環境変数が無い: ${missing.join("・")}（鍵は窓口が用意する）`);
}

/** todo の URL を順に検査して行にする。1件が落ちても他は取り、落ちた URL を返す */
async function inspectAll(todo, today) {
  const searchconsole = google.searchconsole({
    version: "v1",
    auth: getGoogleAuthClient(["https://www.googleapis.com/auth/webmasters.readonly"]),
  });
  const rows = [];
  const failed = [];
  for (const t of todo) {
    try {
      const result = await inspectUrl(searchconsole, process.env.SEARCH_CONSOLE_SITE_URL, t.url);
      const row = toInspectionRow({ ...t, inspectedOn: today, result, fetchedAt: new Date().toISOString() });
      rows.push(row);
      console.log(`${t.checkpoint} ${t.url}: ${row.verdict ?? "不明"}${row.canonical_ok === false ? "・canonical が別" : ""}`);
    } catch (err) {
      failed.push(t.url);
      console.error(`${t.url}: 検査の失敗 ${err?.code ?? err?.status ?? "unknown"}`);
    }
  }
  return { rows, failed };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  requireEnv(opts.dryRun ? ["SEARCH_CONSOLE_SITE_URL"] : ["SEARCH_CONSOLE_SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
  const articles = JSON.parse(fs.readFileSync(opts.articles, "utf8"));
  const db = opts.dryRun
    ? null
    : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  if (db) await assertInspectionTableExists(db);
  const done = db ? await readDoneInspections(db, articles.map((a) => a.url)) : [];
  const today = ptToday(new Date());
  const todo = pendingInspections(articles, done, today).slice(0, opts.max);
  console.log(`検査: 一覧${articles.length}件のうち${todo.length}件${opts.dryRun ? "（dry-run）" : ""}`);
  const { rows, failed } = await inspectAll(todo, today);
  if (db) await writeInspections(db, rows);
  if (failed.length > 0) throw new Error(`${failed.length}件の検査が落ちた。回し直せば済みの分は飛ばす`);
}

main().catch((err) => {
  console.error(`inspect-new-articles: ${err.message}`);
  process.exit(1);
});
