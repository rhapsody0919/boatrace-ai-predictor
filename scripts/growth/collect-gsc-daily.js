/**
 * collect-gsc-daily.js - Search Console の query × page × date を直近7日ぶん取り直し、growth_gsc_daily へ upsert する
 * （BOA-1706、hq 閉鎖 R2。前は非公開の hq が Mac の launchd で取っていた）。
 *
 * 毎回直近7日を取り直すので、定時が1日抜けても次の回で埋まる。全部を取り切れた日だけ、その日の古い行
 * （今回の取得に無い組）を消す。公開のリポジトリの Actions で動くので、数字をログに出さない（日付と行数だけ）。
 *
 * 使い方: node scripts/growth/collect-gsc-daily.js
 * 環境変数: SEARCH_CONSOLE_SITE_URL・GOOGLE_SERVICE_ACCOUNT_KEY_PATH・SUPABASE_URL・SUPABASE_SERVICE_KEY
 * 終了コード: 0 済み、1 設定の誤りか取得・書き込みの失敗（job-watch が拾う）
 */
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import {
  canPrune,
  chunk,
  fetchDay,
  logLine,
  safeError,
  toRows,
  windowDates,
} from "../lib/growth/gscDaily.js";

const TABLE = "growth_gsc_daily";
// 1回の upsert の行数（目安・根拠なし）。要求の数を抑えつつ、1要求を大きくしすぎない
const UPSERT_CHUNK = 1000;

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`環境変数が無い: ${missing.join("・")}`);
  }
}

async function writeDay(db, date, rows, fetchedAt) {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await db
      .from(TABLE)
      .upsert(part, { onConflict: "date,query,page" });
    if (error) throw new Error(`upsert の失敗（${date}）: ${safeError(error)}`);
  }
  if (!canPrune(rows.length)) return false;
  const { error } = await db
    .from(TABLE)
    .delete()
    .eq("date", date)
    .lt("fetched_at", fetchedAt);
  if (error) throw new Error(`古い行の削除の失敗（${date}）: ${safeError(error)}`);
  return true;
}

async function main() {
  requireEnv([
    "SEARCH_CONSOLE_SITE_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
  ]);
  const searchconsole = google.searchconsole({
    version: "v1",
    auth: getGoogleAuthClient([
      "https://www.googleapis.com/auth/webmasters.readonly",
    ]),
  });
  const db = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } },
  );
  const fetchedAt = new Date().toISOString();
  for (const date of windowDates(new Date())) {
    let apiRows;
    try {
      apiRows = await fetchDay(
        searchconsole,
        process.env.SEARCH_CONSOLE_SITE_URL,
        date,
      );
    } catch (err) {
      throw new Error(`Search Console の取得の失敗（${date}）: ${safeError(err)}`);
    }
    const pruned = await writeDay(db, date, toRows(apiRows, fetchedAt), fetchedAt);
    console.log(logLine(date, apiRows.length, pruned));
  }
}

main().catch((err) => {
  console.error(`collect-gsc-daily: ${err.message}`);
  process.exit(1);
});
