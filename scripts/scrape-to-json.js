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

import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getTodayDateJST } from "./lib/dateUtils.js";
import { scrapeRaceStage } from "./lib/raceStageParser.js";
import { mapWithConcurrency } from "./lib/scrapeJobs/concurrency.js";

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

const FETCH_HEADERS = {
  "User-Agent":
    "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

/** 既定の取得（GitHub Actions・CLI）。HTTP エラーは例外にする */
export async function defaultFetchHtml(url) {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
  }
  return response.text();
}

const DEFAULT_IO = Object.freeze({ fetchHtml: defaultFetchHtml, strict: false });

// URLを生成する関数
function getUrl(date, placeCd, raceNo, content) {
  const urlBase = "https://www.boatrace.jp/owpc/pc/race/";
  const ymd = date.replace(/-/g, "");
  const jcd = placeCd < 10 ? `0${placeCd}` : `${placeCd}`;
  const url = `${urlBase}${content}?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  return url;
}

// 展示データ（展示タイム・展示ST）を取得する関数
function scrapeExhibitionData($) {
  const exhibitionData = [];

  // beforeinfoページの構造:
  //   table[1] (選手テーブル): 6つのtbody、各4行
  //     tbody[n]/tr[0] = 選手情報行 (td[0]=枠番, td[4]=展示タイム)
  //   table[2] (スタート展示テーブル): .table1_boatImage1 でコース順のST
  const tables = $(".table1");
  if (tables.length < 2) return null;

  // 展示タイムを各選手から取得（table[1]）
  const exTable = tables.eq(1);
  const tbodies = exTable.find("tbody");

  tbodies.each((i, tbody) => {
    if (i >= 6) return;
    const rows = $(tbody).find("tr");
    if (rows.length < 1) return;

    const mainCells = rows.eq(0).find("td");
    const boatNumber = parseInt(mainCells.eq(0).text().trim());
    const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());

    if (boatNumber >= 1 && boatNumber <= 6) {
      exhibitionData.push({
        boatNumber,
        exhibitionTime:
          !isNaN(exhibitionTime) && exhibitionTime > 0 ? exhibitionTime : null,
        startTiming: null,
      });
    }
  });

  // 展示ST（スタート展示テーブル table[2]）
  if (tables.length >= 3) {
    const startTable = tables.eq(2);
    startTable.find(".table1_boatImage1").each((i, el) => {
      // 艇番（画像またはテキストから取得）
      const boatText =
        $(el).find(".table1_boatImage1Number").text().trim() ||
        $(el).text().trim().split("\n")[0].trim();
      const boatNum = parseInt(boatText);

      // ST値（.table1_boatImage1Time）
      const stText = $(el).find(".table1_boatImage1Time").text().trim();
      const isFlying = stText.includes("F");
      const numMatch = stText.match(/[FL]?\.(\d+)/);
      const stValue = numMatch ? parseFloat("0." + numMatch[1]) : null;

      if (boatNum >= 1 && boatNum <= 6 && stValue !== null) {
        const entry = exhibitionData.find((e) => e.boatNumber === boatNum);
        if (entry) {
          entry.startTiming = stValue;
          entry.isFlying = isFlying;
        }
      }
    });
  }

  const hasData = exhibitionData.some(
    (e) => e.exhibitionTime !== null || e.startTiming !== null,
  );
  return hasData ? exhibitionData : null;
}

// 直前情報を取得する関数
async function getBeforeinfo(date, placeCd, raceNo, io = DEFAULT_IO) {
  try {
    const url = getUrl(date, placeCd, raceNo, "beforeinfo");

    const html = await io.fetchHtml(url);
    const $ = cheerio.load(html);

    // 天候情報を取得
    const weatherData = [];
    $(".weather1_bodyUnitLabelData").each((i, elem) => {
      weatherData.push($(elem).text().trim());
    });

    // 天気を取得
    let weather = "";
    $(".weather1_bodyUnitLabelTitle").each((i, elem) => {
      if (i === 1) {
        weather = $(elem).text().trim();
      }
    });

    // 風向を取得
    let windDirection = 0;
    const windElem = $('p[class*="is-wind"]');
    if (windElem.length > 0) {
      const classes = windElem.attr("class");
      const windClass = classes.split(" ").find((c) => c.startsWith("is-wind"));
      if (windClass) {
        windDirection = parseInt(windClass.replace("is-wind", ""));
      }
    }

    // 展示データを取得
    const exhibitionData = scrapeExhibitionData($);

    // データを統合
    const result = {
      date: date,
      placeCd: placeCd,
      raceNo: raceNo,
      weather: weather,
      airTemp: weatherData[0]
        ? parseFloat(weatherData[0].replace("℃", ""))
        : null,
      windDirection: windDirection,
      windVelocity: weatherData[1]
        ? parseFloat(weatherData[1].replace("m", ""))
        : null,
      waterTemp: weatherData[2]
        ? parseFloat(weatherData[2].replace("℃", ""))
        : null,
      waveHeight: weatherData[3]
        ? parseFloat(weatherData[3].replace("cm", ""))
        : null,
      exhibitionData: exhibitionData,
    };

    return result;
  } catch (error) {
    if (io.strict) {
      throw new Error(
        `beforeinfo の取得に失敗（会場${placeCd} ${raceNo}R）: ${error.message}`,
        { cause: error },
      );
    }
    console.error(
      `Error fetching beforeinfo for place ${placeCd}, race ${raceNo}:`,
      error.message,
    );
    return null;
  }
}

// レース場の全レース締切予定時刻を取得する関数
async function getRaceStartTimes(date, placeCd, io = DEFAULT_IO) {
  try {
    const ymd = date.replace(/-/g, "");
    const jcd = placeCd < 10 ? `0${placeCd}` : `${placeCd}`;
    const url = `https://www.boatrace.jp/owpc/pc/race/raceindex?jcd=${jcd}&hd=${ymd}`;

    const html = await io.fetchHtml(url);
    const $ = cheerio.load(html);

    const startTimes = {};

    // 時刻パターンに一致するtd要素を探す
    let raceNo = 1;
    $("td").each((index, td) => {
      const time = $(td).text().trim();
      if (time.match(/^\d{1,2}:\d{2}$/)) {
        // 時刻形式にマッチしたらレース番号に対応付け
        startTimes[raceNo] = time;
        raceNo++;

        // 最大12レースまで
        if (raceNo > 12) return false;
      }
    });

    return startTimes;
  } catch (error) {
    if (io.strict) {
      throw new Error(
        `発走時刻の取得に失敗（会場${placeCd}）: ${error.message}`,
        { cause: error },
      );
    }
    console.error(
      `Error fetching race start times for place ${placeCd}:`,
      error.message,
    );
    return {};
  }
}

// レースグレードを取得する関数
function scrapeRaceGrade($) {
  const classAttr = ($(".heading2_title").attr("class") || "").toLowerCase();
  if (classAttr.includes("is-sg")) return "SG";
  if (classAttr.includes("is-g1")) return "G1";
  if (classAttr.includes("is-g2")) return "G2";
  if (classAttr.includes("is-g3")) return "G3";
  return "ippan";
}

// レースタイトルを取得する関数
function scrapeRaceTitle($) {
  return $(".heading2_titleName").text().trim() || null;
}

// 出走表から選手情報を取得する関数
async function getRacelist(date, placeCd, raceNo, io = DEFAULT_IO) {
  try {
    const url = getUrl(date, placeCd, raceNo, "racelist");

    const html = await io.fetchHtml(url);
    const $ = cheerio.load(html);

    // レースグレード・タイトル・開催ステージを取得
    const raceGrade = scrapeRaceGrade($);
    const raceTitle = scrapeRaceTitle($);
    const raceStage = scrapeRaceStage($);

    const racers = [];

    // 選手情報を取得（1号艇から6号艇まで）
    $(".table1 tbody.is-fs12").each((index, tbody) => {
      if (index >= 6) return; // 最大6艇まで

      const $tbody = $(tbody);

      // 選手名を取得
      const name = $tbody.find(".is-fs18.is-fBold a").text().trim();

      // 級別と年齢を取得
      // .is-fs11 には2つのdivがある: 1つ目が「4203 / B1」、2つ目が「地域/地域<br>年齢/体重」
      const $fs11Divs = $tbody.find(".is-fs11");

      // 登録番号と級別を取得（例: "4203 / B1" から "4203" と "B1" を抽出）
      const gradeText = $fs11Divs.eq(0).text().trim();
      const racerIdMatch = gradeText.match(/^(\d+)/);
      const racerId = racerIdMatch ? parseInt(racerIdMatch[1]) : null;
      const gradeMatch = gradeText.match(/\s*\/\s*([AB][12])/);
      const grade = gradeMatch ? gradeMatch[1] : "-";

      // 年齢を取得（例: "群馬/栃木<br>49歳/54.1kg" から "49" を抽出）
      const ageText = $fs11Divs.eq(1).text().trim();
      const ageMatch = ageText.match(/(\d+)歳/);
      const age = ageMatch ? parseInt(ageMatch[1]) : null;

      // 統計データを取得（td.is-lineH2から）
      const $stats = $tbody.find("td.is-lineH2");

      // 全国: 勝率<br>2連率<br>3連率
      const globalStats = $stats
        .eq(1)
        .text()
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const globalWinRate = parseFloat(globalStats[0]) || 0;
      const global2Rate = parseFloat(globalStats[1]) || 0;
      const global3Rate = parseFloat(globalStats[2]) || 0;

      // 当地: 勝率<br>2連率<br>3連率
      const localStats = $stats
        .eq(2)
        .text()
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const localWinRate = parseFloat(localStats[0]) || 0;
      const local2Rate = parseFloat(localStats[1]) || 0;
      const local3Rate = parseFloat(localStats[2]) || 0;

      // モーター: 番号<br>2連率<br>3連率
      const motorStats = $stats
        .eq(3)
        .text()
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const motorNumber = parseInt(motorStats[0]) || null;
      const motor2Rate = parseFloat(motorStats[1]) || 0;
      const motor3Rate = parseFloat(motorStats[2]) || 0;

      // ボート: 番号<br>2連率<br>3連率
      const boatStats = $stats
        .eq(4)
        .text()
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const boatNumber = parseInt(boatStats[0]) || null;
      const boat2Rate = parseFloat(boatStats[1]) || 0;
      const boat3Rate = parseFloat(boatStats[2]) || 0;

      racers.push({
        lane: index + 1, // 1-6
        racerId: racerId,
        name: name || "選手名不明",
        grade: grade || "-",
        age: age,
        globalWinRate: globalWinRate,
        global2Rate: global2Rate,
        global3Rate: global3Rate,
        localWinRate: localWinRate,
        local2Rate: local2Rate,
        local3Rate: local3Rate,
        motorNumber: motorNumber,
        motor2Rate: motor2Rate,
        motor3Rate: motor3Rate,
        boatNumber: boatNumber,
        boat2Rate: boat2Rate,
        boat3Rate: boat3Rate,
      });
    });

    return racers.length > 0
      ? { racers, raceGrade, raceTitle, raceStage }
      : null;
  } catch (error) {
    if (io.strict) {
      throw new Error(
        `racelist の取得に失敗（会場${placeCd} ${raceNo}R）: ${error.message}`,
        { cause: error },
      );
    }
    console.error(
      `Error fetching racelist for place ${placeCd}, race ${raceNo}:`,
      error.message,
    );
    return null;
  }
}

// 今日の日付を取得 (YYYY-MM-DD形式, JST)
// dateUtils.jsのgetTodayDateJST()を使用

// 本日開催中のレース場リストを取得
// io: {fetchHtml, strict}（ファイル冒頭の説明を参照）。既定は従来どおり（失敗は [] に化ける）
export async function getTodayVenues(date, io = DEFAULT_IO) {
  try {
    // hd=（対象日）を明示指定する。指定なしだと、朝一番の実行時点で
    // boatrace.jp側のページがまだ当日分に完全ロールオーバーしておらず、
    // 新節初日の会場を取りこぼすことがある（2026-09-12、徳山ほか3会場で実際に発生）。
    // hd= は日付ごとに正しく異なる開催会場一覧を返すことを実地検証済み。
    const ymd = date.replace(/-/g, "");
    const url = `https://www.boatrace.jp/owpc/pc/race/index?hd=${ymd}`;

    const html = await io.fetchHtml(url);
    const $ = cheerio.load(html);

    const venues = new Set();

    // 開催中のレース場を抽出（raceindexへのリンクからjcdを取得）
    $('a[href*="raceindex"]').each((i, elem) => {
      const href = $(elem).attr("href");
      if (href) {
        const match = href.match(/jcd=(\d+)/);
        if (match) {
          venues.add(parseInt(match[1]));
        }
      }
    });

    const venuesList = Array.from(venues).sort((a, b) => a - b);
    console.log(`Found ${venuesList.length} venues open today:`, venuesList);
    return venuesList;
  } catch (error) {
    if (io.strict) {
      throw new Error(`開催会場一覧の取得に失敗（${date}）: ${error.message}`, {
        cause: error,
      });
    }
    console.error("Error fetching today's venues:", error.message);
    return [];
  }
}

/**
 * 1会場の全レース（1R〜12R）の、直前情報・出走表・発走時刻を取得する（メモリ上のデータを返す。fs は使わない）。
 *
 * beforeinfo と racelist を、レースごとに並列で取得する。raceConcurrency 個のレースを同時に処理する
 * （既定 12＝従来どおり全レース同時。Vercel は取得先への負荷を抑えるため、少なくする）。
 * strict のときは、1ページでも取得に失敗したら、会場全体の失敗として例外を投げる（一部のレースだけが
 * 欠けた状態で書き込まれ、その会場が「済み」になるのを避ける）。発走時刻が1件も取れない場合も失敗とする。
 *
 * @param {string} date YYYY-MM-DD
 * @param {number} placeCd 会場コード
 * @param {Object} [options]
 * @param {(url: string) => Promise<string>} [options.fetchHtml]
 * @param {boolean} [options.strict]
 * @param {number} [options.raceConcurrency]
 * @returns {Promise<{placeCd: number, placeName: string, races: Object[]}|null>} 取得できたレースが無ければ null
 */
export async function scrapeVenue(
  date,
  placeCd,
  { fetchHtml = defaultFetchHtml, strict = false, raceConcurrency = 12 } = {},
) {
  const io = { fetchHtml, strict };
  const MAX_RACES = 12; // 通常は1Rから12Rまで

  // まず、この会場の全レース発走時刻を取得
  const startTimes = await getRaceStartTimes(date, placeCd, io);
  if (strict && Object.keys(startTimes).length === 0) {
    throw new Error(
      `発走時刻を1件も取得できません（会場${placeCd}）。ページの構造変化・未公開の可能性`,
    );
  }

  // 1RからMAX_RACESまで取得（beforeinfoとracelistの両方）
  const raceNos = Array.from({ length: MAX_RACES }, (_, i) => i + 1);
  const results = await mapWithConcurrency(
    raceNos,
    raceConcurrency,
    async (raceNo) => {
      // strict では、失敗を捕捉して集め、会場全体の失敗として最後にまとめて投げる
      const settled = await Promise.allSettled([
        getBeforeinfo(date, placeCd, raceNo, io),
        getRacelist(date, placeCd, raceNo, io),
      ]);
      return { raceNo, settled };
    },
  );

  const failures = results.flatMap(({ settled }) =>
    settled.filter((r) => r.status === "rejected").map((r) => r.reason),
  );
  if (failures.length > 0) {
    throw new Error(
      `会場${placeCd}: ${failures.length}ページの取得に失敗（例: ${failures[0].message}）`,
      { cause: failures[0] },
    );
  }

  const venueRaces = [];
  // nullでないデータのみを追加し、beforeinfoとracelistをマージ
  for (const { raceNo, settled } of results) {
    const beforeinfo = settled[0].value;
    const racelistData = settled[1].value;
    if (!beforeinfo) continue;
    // beforeinfoとracelistを統合し、締切予定時刻も追加
    venueRaces.push({
      ...beforeinfo,
      startTime: startTimes[raceNo] || null, // 締切予定時刻を追加
      racers: racelistData?.racers || [], // 選手情報を追加（取得できない場合は空配列）
      raceGrade: racelistData?.raceGrade || null, // レースグレード
      raceTitle: racelistData?.raceTitle || null, // レースタイトル
      raceStage: racelistData?.raceStage || null, // 開催ステージ（予選/準優勝戦/優勝戦等）
    });
  }

  // このレース場でデータが取得できた場合のみ返す
  if (venueRaces.length === 0) return null;
  return {
    placeCd: placeCd,
    placeName: VENUES[placeCd] || `レース場${placeCd}`,
    races: venueRaces,
  };
}

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
