#!/usr/bin/env node
/**
 * Claude が SUPABASE_RO_DB_URL を設定して実行する読み取り専用 CLI。
 * node scripts/analysis/scraping-load-budget/daily-fetch-counts.js YYYY-MM-DD
 * --input FILE で同じ列のローカルJSON配列を検証できる。秘密ファイルは読み込まない。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dailyFetchCounts, FETCH_COUNT_NOTES, validateTargetDate } from "../../lib/scrapeJobs/fetchCounts.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import { checkRoUrl, runReadOnlyQuery } from "../../lib/roQuery.js";

/** 日の約9,000スロットをSQL側で先に合算。PostgRESTの1,000行上限を通さない。 */
export function dailyCountsSql(date) {
  validateTargetDate(date);
  return `SELECT job, status, outcome, race_date::text AS target_date,
    SUM(attempts)::text AS attempts FROM scrape_slots
    WHERE race_date = '${date}'::date
    GROUP BY job, status, outcome, race_date ORDER BY job, status, outcome`;
}

export async function readDailyCounts(client, date) {
  const result = await runReadOnlyQuery(client, dailyCountsSql(date), { limit: 5000 });
  if (result.truncated) throw new Error("集計結果が上限を超えました。出力を中止します");
  return dailyFetchCounts(result.rows, SCRAPE_JOBS, date);
}

async function main(args) {
  const [date, flag, file, ...rest] = args;
  validateTargetDate(date);
  if (rest.length || (flag !== undefined && (flag !== "--input" || !file))) {
    throw new Error("使い方: daily-fetch-counts.js YYYY-MM-DD [--input FILE]");
  }
  let counts;
  if (flag === "--input") {
    counts = dailyFetchCounts(JSON.parse(readFileSync(file, "utf8")), SCRAPE_JOBS, date);
  } else {
    const connectionString = checkRoUrl(process.env.SUPABASE_RO_DB_URL);
    const { default: pg } = await import("pg");
    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false },
      application_name: "claude-ro-daily-fetch-counts" });
    await client.connect();
    try {
      counts = await readDailyCounts({ query: (text) => client.query({ text, queryMode: "extended" }) }, date);
    } finally {
      await client.end();
    }
  }
  console.log(JSON.stringify({ target_date: date, approximate: true, notes: FETCH_COUNT_NOTES, counts }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(() => {
    // 接続文字列を含む可能性のある生の例外は出力しない。
    console.error("日次取得数を出力できませんでした。引数・入力列・読み取り専用接続設定を確認してください。");
    process.exitCode = 1;
  });
}
