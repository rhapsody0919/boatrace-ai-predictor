// GitHub Actions用スクレイピングスクリプト
// data/races.json にレース情報を保存
//
// 取得の本体（getTodayVenues / scrapeVenue / scrapeRacesData）は、ファイルへ書かず、メモリ上のデータを返す
// 関数として export している（WS4b T4b-07-1）。CLI の main() は、それを呼んで data/races.json へ書く。
// Vercel Function（api/cron/races-init.js。scripts/lib/racesInit/）は、fetchHtml（politeFetch）と strict を
// 指定して同じ関数を呼ぶ（fs・execSync に依存しない）。
//   fetchHtml  URL → HTML の関数。既定は fetch（GitHub Actions・CLI と同じ）。!ok は例外を投げる
//   strict     false（既定・従来どおり）: 取得に失敗したページは、ログだけ出して null・{}・[] にする
//              true: 失敗を例外として投げる（取得の失敗が「開催なし」「選手なし」に化けて、初期化の完了と
//              誤認されるのを避ける。Vercel 側が指定する）

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getTodayDateJST } from "./lib/dateUtils.js";
import { getTodayVenues, scrapeVenue } from "./lib/scrapeToJson.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// レース場マッピング
const VENUES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

/**
 * 複数会場のレースデータを取得して、data/races.json と同じ形のオブジェクトを返す（ファイルには書かない）。
 * 会場は順次処理し、会場の間に venueDelayMs（既定1秒。レート制限対策）待つ。
 *
 * @param {string} date YYYY-MM-DD
 * @param {number[]} placeCds
 * @param {Object} [options] scrapeVenue のオプション + venueDelayMs
 */
export async function scrapeRacesData(
  date,
  placeCds,
  { venueDelayMs = 1000, ...venueOptions } = {},
) {
  const allRaces = [];

  console.log(`Processing ${placeCds.length} venues...`);

  // 全会場のレースを順次取得（会場ごとに並列）
  for (const placeCd of placeCds) {
    console.log(`Processing venue: ${VENUES[placeCd] || placeCd}`);
    const venue = await scrapeVenue(date, placeCd, venueOptions);

    // 会場間の遅延（既定1秒）- レート制限対策
    await new Promise((resolve) => setTimeout(resolve, venueDelayMs));

    if (venue) {
      allRaces.push(venue);
      console.log(`✓ ${venue.placeName}: ${venue.races.length} races`);
    }
  }

  console.log(`Successfully scraped ${allRaces.length} venues with race data`);

  return {
    success: true,
    date,
    data: allRaces,
    scrapedAt: new Date().toISOString(),
  };
}

// メイン処理
async function main() {
  try {
    console.log("Starting race data scraping...");
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const date = getTodayDateJST();
    console.log(`Date: ${date}`);

    // --venues=8,9,10,18 が指定されていれば、その会場のみをスクレイプ対象にする
    // （新節初日の会場がトップページのロールオーバー境界で取り漏れた場合の追加取得用）
    const venuesArg = process.argv.find((arg) => arg.startsWith("--venues="));
    const todayVenues = venuesArg
      ? venuesArg
          .replace("--venues=", "")
          .split(",")
          .map((v) => parseInt(v.trim(), 10))
          .filter((v) => !isNaN(v))
      : await getTodayVenues(date);

    if (todayVenues.length === 0) {
      console.log("No venues found for today");

      // 空のデータを保存
      const outputData = {
        success: true,
        date: getTodayDateJST(),
        data: [],
        scrapedAt: new Date().toISOString(),
        message: "No races today",
      };

      const outputPath = path.join(__dirname, "..", "data", "races.json");
      await fs.writeFile(
        outputPath,
        JSON.stringify(outputData, null, 2),
        "utf-8",
      );
      console.log(`Saved empty data to ${outputPath}`);
      return;
    }

    // 開催中のレース場のみ取得（メモリ上のデータとして取得し、ここでファイルへ書く）
    const outputData = await scrapeRacesData(date, todayVenues);
    // 従来どおり、日付は書き込み時点の JST の日付
    outputData.date = getTodayDateJST();

    const outputPath = path.join(__dirname, "..", "data", "races.json");
    await fs.writeFile(
      outputPath,
      JSON.stringify(outputData, null, 2),
      "utf-8",
    );
    console.log(`Saved data to ${outputPath}`);

    console.log("Scraping completed successfully!");
  } catch (error) {
    console.error("Error in scraping:", error);
    process.exit(1);
  }
}

// スクリプト実行（他スクリプトから getTodayVenues のみ import された場合は実行しない）
if (process.argv[1] === __filename) {
  main();
}

export {
  defaultFetchHtml,
  getTodayVenues,
  scrapeVenue,
} from "./lib/scrapeToJson.js";
