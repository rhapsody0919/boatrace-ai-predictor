// Race Results Scraper
// Reads data/predictions/YYYY-MM-DD.json and adds race results

import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get today's date in JST (YYYY-MM-DD format)
function getTodayDateJST() {
  const now = new Date();
  const jstOffset = 9 * 60;
  const jstDate = new Date(now.getTime() + jstOffset * 60 * 1000);
  return jstDate.toISOString().split('T')[0];
}

// Convert date to YYYYMMDD format
function formatDateForUrl(dateStr) {
  return dateStr.replace(/-/g, '');
}

// Generate race result page URL
function getRaceResultUrl(venueCode, raceNo, dateStr) {
  const ymd = formatDateForUrl(dateStr);
  const jcd = String(venueCode).padStart(2, '0');
  return `https://www.boatrace.jp/owpc/pc/race/raceresult?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

// Scrape payout data
function scrapePayouts($) {
  const payouts = {
    win: {},      // 単勝
    place: {},    // 複勝
    trifecta: {}, // 3連複
    trio: {}      // 3連単
  };

  try {
    // 払戻金テーブルを取得（.is-w495の3番目 = index 2）
    const allTables = $('.is-w495');

    const payoutTable = allTables.eq(2);

    if (payoutTable.length === 0) {
      return payouts;
    }

    const rows = payoutTable.find('tbody tr');

    let currentType = '';

    payoutTable.find('tbody tr').each((i, row) => {
      const $row = $(row);
      const cells = $row.find('td');

      if (cells.length >= 2) {
        const col0 = cells.eq(0).text().trim();
        const col1 = cells.eq(1).text().trim();
        const col2 = cells.length >= 3 ? cells.eq(2).text().trim() : '';

        // 券種が記載されている場合
        if (col0 && (col0 === '単勝' || col0 === '複勝' || col0 === '3連単' || col0 === '3連複' || col0 === '2連単' || col0 === '2連複' || col0 === '拡連複')) {
          currentType = col0;
        }

        // パターン1: col2に配当がある場合（通常）
        let payout = parseInt(col2.replace(/[^0-9]/g, ''));
        let combo = col1;

        // パターン2: col1に配当がある場合（複勝の2行目以降など）
        if ((isNaN(payout) || payout === 0) && col1.includes('¥')) {
          payout = parseInt(col1.replace(/[^0-9]/g, ''));
          combo = col0;
        }

        if (!isNaN(payout) && payout > 0 && combo) {
          // 組み合わせを正規化
          const normalizedCombo = combo
            .replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))
            .replace(/[→－−ー=]/g, '-')
            .replace(/\s+/g, '');

          if (currentType === '単勝') {
            payouts.win[normalizedCombo] = payout;
          } else if (currentType === '複勝') {
            payouts.place[normalizedCombo] = payout;
          } else if (currentType === '3連複') {
            payouts.trifecta[normalizedCombo] = payout;
          } else if (currentType === '3連単') {
            payouts.trio[normalizedCombo] = payout;
          }
        }
      }
    });

  } catch (error) {
    console.error(`  Payout scraping error: ${error.message}`);
    // エラーが発生しても空のpayoutsを返して処理を続行
  }

  return payouts;
}

// Scrape race result
async function scrapeRaceResult(venueCode, raceNo, dateStr) {
  const url = getRaceResultUrl(venueCode, raceNo, dateStr);

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) {
      console.log(`  [HTTP ${response.status}]`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Check if result table exists
    const resultTable = $('.is-w495');
    if (resultTable.length === 0) {
      console.log(`  Not published yet`);
      return null;
    }

    // Get top 3 boat numbers
    const rankings = [];
    $('.is-w495 tbody tr').each((index, row) => {
      if (index < 3) {
        const $row = $(row);
        // Get the second column (boat number), not the first (rank)
        const boatNumber = parseInt($row.find('td').eq(1).text().trim());
        if (boatNumber && !isNaN(boatNumber)) {
          rankings.push(boatNumber);
        }
      }
    });

    if (rankings.length < 3) {
      console.log(`  Incomplete data (got ${rankings.length} boats)`);
      return null;
    }

    // Get payout data
    const payouts = scrapePayouts($);

    return {
      finished: true,
      rank1: rankings[0],
      rank2: rankings[1],
      rank3: rankings[2],
      payouts: payouts,
      updatedAt: new Date().toISOString(),
    };

  } catch (error) {
    console.error(`  Scraping error: ${error.message}`);
    return null;
  }
}

// Update prediction data with results
async function updatePredictionWithResults(dateStr = null) {
  try {
    const targetDate = dateStr || getTodayDateJST();
    console.log(`Starting race result scraping: ${targetDate}`);

    // Read prediction data
    const predictionsPath = path.join(__dirname, '..', 'data', 'predictions', `${targetDate}.json`);

    let predictionsData;
    try {
      predictionsData = JSON.parse(await fs.readFile(predictionsPath, 'utf-8'));
    } catch (error) {
      console.error(`Prediction data not found: ${predictionsPath}`);
      console.error('Please generate predictions first');
      process.exit(1);
    }

    console.log(`Fetching results for ${predictionsData.races.length} races\n`);

    let updatedCount = 0;
    let alreadyFinishedCount = 0;
    let notYetCount = 0;

    // Fetch results for each race
    for (const race of predictionsData.races) {
      const raceInfo = `${race.venue} R${race.raceNumber}`;
      process.stdout.write(`${raceInfo.padEnd(20)} `);

      // Skip if already finished and has payout data
      const hasPayouts = race.result?.payouts &&
                         (Object.keys(race.result.payouts.win).length > 0 ||
                          Object.keys(race.result.payouts.place).length > 0 ||
                          Object.keys(race.result.payouts.trifecta).length > 0 ||
                          Object.keys(race.result.payouts.trio).length > 0);

      if (race.result && race.result.finished && hasPayouts) {
        console.log(`Already finished (${race.result.rank1}-${race.result.rank2}-${race.result.rank3})`);
        alreadyFinishedCount++;
        continue;
      }

      // Scrape result
      const result = await scrapeRaceResult(race.venueCode, race.raceNumber, targetDate);

      if (result) {
        race.result = result;
        console.log(`New result: ${result.rank1}-${result.rank2}-${result.rank3}`);
        updatedCount++;
      } else {
        console.log(`Not yet finished`);
        notYetCount++;
      }

      // Wait to avoid server overload
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Update timestamp
    predictionsData.updatedAt = new Date().toISOString();

    // Write back to file
    await fs.writeFile(predictionsPath, JSON.stringify(predictionsData, null, 2), 'utf-8');

    console.log(`\nResults summary:`);
    console.log(`  - Newly fetched: ${updatedCount} races`);
    console.log(`  - Already finished: ${alreadyFinishedCount} races`);
    console.log(`  - Not yet finished: ${notYetCount} races`);
    console.log(`\nUpdated: ${predictionsPath}`);

  } catch (error) {
    console.error('Error occurred:', error);
    process.exit(1);
  }
}

// Get date from command line argument (optional)
const args = process.argv.slice(2);
const dateArg = args.find(arg => arg.startsWith('--date='));
const targetDate = dateArg ? dateArg.split('=')[1] : null;

// Execute script
updatePredictionWithResults(targetDate);
