/**
 * backfill-gsc-daily.js - Search Console を 2025-12-21 から日ごとに取り直し、growth_gsc_daily（date × query × page）と
 * growth_gsc_page_daily（date × page）へ upsert する（SEO データの輪 PR2。実行は窓口。作り手は本番に繋がない）。
 *
 * 日ごとの upsert なので、途中で止まっても同じ範囲を何度回しても二重にならない。公開してよい出力は日付と行数だけ。
 * growth_gsc_page_daily が無い間は、--tables page を含む実行を最初に意味のある文で止める（query だけなら回せる）。
 *
 * 使い方: node scripts/maintenance/backfill-gsc-daily.js [--from 2025-12-21] [--to YYYY-MM-DD] [--tables query,page] [--dry-run]
 * 環境変数: SEARCH_CONSOLE_SITE_URL・GOOGLE_SERVICE_ACCOUNT_KEY_PATH・（--dry-run 以外）SUPABASE_URL・SUPABASE_SERVICE_KEY
 * 終了コード: 0 済み、1 設定の誤り・取得・書き込みの失敗・取った全日が0行
 */
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import { canPrune, chunk, fetchDay, logLine, ptToday, safeError, toRows } from "../lib/growth/gscDaily.js";
import {
  allDaysEmpty,
  assertPageTableExists,
  dateRange,
  fetchPageDay,
  parseBackfillArgs,
  toPageRows,
  writePageDay,
} from "../lib/growth/gscPageDaily.js";

const QUERY_TABLE = "growth_gsc_daily";
const DAY_MS = 24 * 60 * 60 * 1000;

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`環境変数が無い: ${missing.join("・")}（鍵は窓口が用意する。作り手は本番に繋がない）`);
  }
}

async function writeQueryDay(db, date, rows, fetchedAt) {
  for (const part of chunk(rows, 1000)) {
    const { error } = await db.from(QUERY_TABLE).upsert(part, { onConflict: "date,query,page" });
    if (error) throw new Error(`upsert の失敗（${date}）: ${safeError(error)}`);
  }
  if (!canPrune(rows.length)) return false;
  const { error } = await db.from(QUERY_TABLE).delete().eq("date", date).lt("fetched_at", fetchedAt);
  if (error) throw new Error(`古い行の削除の失敗（${date}）: ${safeError(error)}`);
  return true;
}

/** 1日ぶんを、選んだ表へ取って書く。dry-run（db が null）は取るだけ。返すのはその日の API の行数の合計 */
async function backfillDay(ctx, date) {
  const { db, opts, searchconsole, siteUrl, fetchedAt } = ctx;
  let total = 0;
  if (opts.tables.includes("query")) {
    const api = await fetchDay(searchconsole, siteUrl, date);
    total += api.length;
    const pruned = db ? await writeQueryDay(db, date, toRows(api, fetchedAt), fetchedAt) : false;
    console.log(`query ${logLine(date, api.length, pruned)}`);
  }
  if (opts.tables.includes("page")) {
    const api = await fetchPageDay(searchconsole, siteUrl, date);
    total += api.length;
    const pruned = db ? await writePageDay(db, date, toPageRows(api, fetchedAt), fetchedAt) : false;
    console.log(`page ${logLine(date, api.length, pruned)}`);
  }
  return total;
}

/** 失敗の文。成功なら null */
function failureMessage(failed, counts) {
  const problems = [];
  if (failed.length > 0) {
    const shown = failed.slice(0, 10).join("・") + (failed.length > 10 ? "…" : "");
    problems.push(`${failed.length}日が落ちた（${shown}）。同じ範囲を回し直せば埋まる`);
  }
  if (allDaysEmpty(counts)) {
    problems.push("取った全日が0行。サービスアカウントの閲覧権限と SEARCH_CONSOLE_SITE_URL の形を確かめる");
  }
  return problems.length > 0 ? problems.join(" / ") : null;
}

async function setup() {
  const yesterdayPt = new Date(Date.parse(`${ptToday(new Date())}T00:00:00Z`) - DAY_MS)
    .toISOString()
    .slice(0, 10);
  const opts = parseBackfillArgs(process.argv.slice(2), yesterdayPt);
  const dates = dateRange(opts.from, opts.to);
  if (dates.length === 0) throw new Error(`範囲が空（from=${opts.from} が to=${opts.to} より後）`);
  requireEnv(
    opts.dryRun
      ? ["SEARCH_CONSOLE_SITE_URL"]
      : ["SEARCH_CONSOLE_SITE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"],
  );
  const db = opts.dryRun
    ? null
    : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  // 表が無いなら、1日も取る前に止める
  if (db && opts.tables.includes("page")) await assertPageTableExists(db);
  const searchconsole = google.searchconsole({
    version: "v1",
    auth: getGoogleAuthClient(["https://www.googleapis.com/auth/webmasters.readonly"]),
  });
  const ctx = {
    db,
    opts,
    searchconsole,
    siteUrl: process.env.SEARCH_CONSOLE_SITE_URL,
    fetchedAt: new Date().toISOString(),
  };
  return { ctx, dates };
}

async function main() {
  const { ctx, dates } = await setup();
  console.log(
    `補充: ${dates[0]}〜${dates.at(-1)}（${dates.length}日）tables=${ctx.opts.tables.join(",")}${ctx.opts.dryRun ? "（dry-run）" : ""}`,
  );
  const failed = [];
  const counts = [];
  for (const date of dates) {
    try {
      counts.push(await backfillDay(ctx, date));
    } catch (err) {
      failed.push(date);
      console.error(`${date}: ${err.message}`);
    }
  }
  const message = failureMessage(failed, counts);
  if (message) throw new Error(message);
}

main().catch((err) => {
  console.error(`backfill-gsc-daily: ${err.message}`);
  process.exit(1);
});
