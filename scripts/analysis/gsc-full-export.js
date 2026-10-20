/**
 * Search Console の全明細を、期間・条件を固定してファイルに書き出す
 *
 * search-console-report.js は「直近N日（3日前まで）」の上位を見る定点観測用で、
 * 期間を指定できず、行の上限で切れても気づけない。原因調査で別の期間と突き合わせる
 * ときは、期間・searchType・dataState・フィルタを固定した全明細が要るので、こちらを使う。
 *
 * 使い方:
 *   node scripts/analysis/gsc-full-export.js --start=2026-09-19 --end=2026-10-17 --out=data/analysis/xxx/gsc-latest
 *     [--dims=date,query,page,query+page,device,country] [--dataState=final|all]
 *
 * 条件: searchType=web、国・端末のフィルタなし（全世界・全端末）。
 * 出力: {out}/{dims}.json（rows と meta）、{out}/meta.json（全体の条件と行数）
 * 必要な設定は search-console-report.js と共通（SEARCH_CONSOLE_SITE_URL、サービスアカウント）。
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

// API の1回の上限。これより少なく返ったら最後のページ
const PAGE_SIZE = 25000;
// API が1日・1検索タイプあたりに返す行の上限（公式ドキュメントの記載）。ここに達したら打ち切りの可能性
const API_ROW_CAP = 50000;

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const START = arg("start");
const END = arg("end");
const OUT = arg("out");
const DATA_STATE = arg("dataState", "final");
const DIM_SETS = arg("dims", "date,query,page,query+page,device,country")
  .split(",")
  .map((s) => s.split("+"));
const SITE_URL = process.env.SEARCH_CONSOLE_SITE_URL;

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
if (!isDate(START) || !isDate(END) || !OUT) {
  console.error(
    "❌ --start=YYYY-MM-DD --end=YYYY-MM-DD --out=出力先 を指定してください",
  );
  process.exit(1);
}
if (!["final", "all"].includes(DATA_STATE)) {
  console.error(`❌ --dataState は final か all: ${DATA_STATE}`);
  process.exit(1);
}
if (!SITE_URL) {
  console.error(
    "❌ SEARCH_CONSOLE_SITE_URL が設定されていません（.env.local）",
  );
  process.exit(1);
}

const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/webmasters.readonly",
]);
const searchconsole = google.searchconsole({ version: "v1", auth });

async function fetchAll(dimensions) {
  const rows = [];
  let pages = 0;
  for (;;) {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: SITE_URL,
      requestBody: {
        startDate: START,
        endDate: END,
        dimensions,
        type: "web",
        dataState: DATA_STATE,
        rowLimit: PAGE_SIZE,
        startRow: rows.length,
      },
    });
    const batch = res.data.rows ?? [];
    pages += 1;
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      return {
        rows,
        pages,
        responseAggregationType: res.data.responseAggregationType ?? null,
      };
    }
  }
}

const sum = (rows, key) => rows.reduce((s, r) => s + r[key], 0);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  for (const dims of DIM_SETS) {
    const name = dims.join("+");
    const { rows, pages, responseAggregationType } = await fetchAll(dims);
    const dates = dims[0] === "date" ? rows.map((r) => r.keys[0]).sort() : [];
    const meta = {
      dimensions: dims,
      rowCount: rows.length,
      apiPages: pages,
      possiblyTruncated: rows.length >= API_ROW_CAP,
      responseAggregationType,
      totalClicks: sum(rows, "clicks"),
      totalImpressions: sum(rows, "impressions"),
      ...(dates.length > 0 && {
        firstDate: dates[0],
        lastDate: dates.at(-1),
        dayCount: dates.length,
      }),
    };
    fs.writeFileSync(
      path.join(OUT, `${name}.json`),
      JSON.stringify({ meta, rows }, null, 1),
    );
    files.push({ file: `${name}.json`, ...meta });
    console.log(
      `${name}: ${rows.length}行（${pages}ページ） clicks=${meta.totalClicks} impressions=${meta.totalImpressions}${meta.possiblyTruncated ? " ⚠️上限到達" : ""}`,
    );
  }
  const meta = {
    generatedAt: new Date().toISOString(),
    siteUrl: SITE_URL,
    startDate: START,
    endDate: END,
    searchType: "web",
    dataState: DATA_STATE,
    filters: "なし（全世界・全端末）",
    timezone: "Search Console の日付は太平洋時間（PT）",
    note: "query を含む集計は匿名化クエリを除くため、date のみの合計より小さい。page を含む集計は byPage 集計で、サイト合計（byProperty）と表示回数が一致しない",
    files,
  };
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
}

main().catch((err) => {
  console.error("❌ Search Console 取得エラー:", err.message);
  process.exit(1);
});
