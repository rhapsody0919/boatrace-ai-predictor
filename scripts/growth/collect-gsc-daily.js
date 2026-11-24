/**
 * collect-gsc-daily.js - Search Console の query × page × date を直近7日ぶん取り直し、growth_gsc_daily へ upsert する
 * （BOA-1706、hq 閉鎖 R2。前は非公開の hq が Mac の launchd で取っていた）。
 *
 * 毎回直近7日を取り直すので、定時が1日抜けても次の回で埋まる。変わらない行は書かない。全部を取り切れた日だけ、
 * その日の古い行（今回の取得に無い組）を主キーで消す。取った窓の全日が0行なら失敗（exit 1）にする。
 * 公開のリポジトリの Actions で動くので、数字をログに出さない（日付と行数だけ）。
 *
 * 使い方: node scripts/growth/collect-gsc-daily.js
 * 環境変数: SEARCH_CONSOLE_SITE_URL・GOOGLE_SERVICE_ACCOUNT_KEY_PATH・SUPABASE_URL・SUPABASE_SERVICE_KEY
 * 終了コード: 0 済み、1 設定の誤りか取得・書き込みの失敗（job-watch が拾う）
 */
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import {
  KEY_COLUMNS,
  chunk,
  collectWindow,
  fetchDay,
  safeError,
  windowDates,
  windowFailure,
} from "../lib/growth/gscDaily.js";

const TABLE = "growth_gsc_daily";
// 1回の upsert の行数（目安・根拠なし）。要求の数を抑えつつ、1要求を大きくしすぎない
const UPSERT_CHUNK = 1000;
// PostgREST の既定の上限（1000行）。これで区切って .range() で全部読む
const READ_PAGE = 1000;

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    throw new Error(`環境変数が無い: ${missing.join("・")}`);
  }
}

/** その日の既存の行（主キーと比べる値だけ）を .range() の輪で全部読む。黙って1000行で切れない */
async function readExisting(db, date) {
  const rows = [];
  for (;;) {
    const { data, error } = await db
      .from(TABLE)
      .select("date,query,page,clicks,impressions,position")
      .eq("date", date)
      .order("query")
      .order("page")
      .range(rows.length, rows.length + READ_PAGE - 1);
    if (error) throw new Error(`既存の行の読みの失敗（${date}）: ${safeError(error)}`);
    rows.push(...data);
    if (data.length < READ_PAGE) return rows;
  }
}

async function upsert(db, date, rows) {
  for (const part of chunk(rows, UPSERT_CHUNK)) {
    const { error } = await db
      .from(TABLE)
      .upsert(part, { onConflict: KEY_COLUMNS.join(",") });
    if (error) throw new Error(`upsert の失敗（${date}）: ${safeError(error)}`);
  }
}

async function deleteRows(db, date, keys) {
  for (const k of keys) {
    const { error } = await db
      .from(TABLE)
      .delete()
      .eq("date", k.date)
      .eq("query", k.query)
      .eq("page", k.page);
    if (error) throw new Error(`古い行の削除の失敗（${date}）: ${safeError(error)}`);
  }
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
  const dates = windowDates(new Date());
  // 1日が落ちても他の日は取る。落ちた日・全日が0行のときは最後にまとめて失敗にする（job-watch が拾う）
  const result = await collectWindow({
    dates,
    fetchedAt: new Date().toISOString(),
    fetchRows: (date) =>
      fetchDay(searchconsole, process.env.SEARCH_CONSOLE_SITE_URL, date).catch((err) => {
        throw new Error(`Search Console の取得の失敗: ${safeError(err)}`);
      }),
    readExisting: (date) => readExisting(db, date),
    upsert: (date, rows) => upsert(db, date, rows),
    deleteRows: (date, keys) => deleteRows(db, date, keys),
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  });
  const failure = windowFailure(dates, result);
  if (failure) throw new Error(failure);
}

main().catch((err) => {
  console.error(`collect-gsc-daily: ${err.message}`);
  process.exit(1);
});
