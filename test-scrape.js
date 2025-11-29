// テスト用スクレイピングスクリプト
// 単一の会場・レースをテスト

import * as cheerio from 'cheerio';

// 今日の日付を取得 (YYYY-MM-DD形式)
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// URLを生成する関数
function getUrl(date, placeCd, raceNo, content) {
  const urlBase = 'https://www.boatrace.jp/owpc/pc/race/';
  const ymd = date.replace(/-/g, '');
  const jcd = placeCd < 10 ? `0${placeCd}` : `${placeCd}`;
  const url = `${urlBase}${content}?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  return url;
}

// 本日開催中のレース場リストを取得
async function getTodayVenues() {
  try {
    const url = 'https://www.boatrace.jp/owpc/pc/race/index';
    console.log(`Fetching venues from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const venues = new Set();

    // 開催中のレース場を抽出
    $('a[href*="raceindex"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        const match = href.match(/jcd=(\d+)/);
        if (match) {
          venues.add(parseInt(match[1]));
        }
      }
    });

    const venuesList = Array.from(venues).sort((a, b) => a - b);
    console.log(`Found ${venuesList.length} venues:`, venuesList);
    return venuesList;

  } catch (error) {
    console.error('Error fetching venues:', error.message);
    throw error;
  }
}

// 出走表から選手情報を取得
async function getRacelist(date, placeCd, raceNo) {
  try {
    const url = getUrl(date, placeCd, raceNo, 'racelist');
    console.log(`Fetching racelist from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
      }
    });

    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const racers = [];

    $('.table1 tbody.is-fs12').each((index, tbody) => {
      if (index >= 6) return;

      const $tbody = $(tbody);

      // 選手名を取得
      const name = $tbody.find('.is-fs18.is-fBold a').text().trim();

      // 級別を取得
      const gradeText = $tbody.find('.is-fs11').first().text().trim();
      const gradeMatch = gradeText.match(/\s*\/\s*([AB][12])/);
      const grade = gradeMatch ? gradeMatch[1] : '-';

      // 統計データを取得
      const $stats = $tbody.find('td.is-lineH2');
      const globalStats = $stats.eq(1).text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const globalWinRate = parseFloat(globalStats[0]) || 0;

      racers.push({
        lane: index + 1,
        name: name || '選手名不明',
        grade: grade,
        globalWinRate: globalWinRate,
      });
    });

    console.log(`Found ${racers.length} racers:`, racers);
    return racers;

  } catch (error) {
    console.error(`Error fetching racelist:`, error.message);
    return null;
  }
}

// メイン
async function main() {
  console.log('=== Boatrace Scraping Test ===\n');

  const date = getTodayDate();
  console.log(`Date: ${date}\n`);

  // ステップ1: 本日開催中の会場を取得
  console.log('Step 1: Get today\'s venues');
  const venues = await getTodayVenues();

  if (venues.length === 0) {
    console.log('No venues found. Exiting.');
    return;
  }

  // ステップ2: 最初の会場の1Rのデータを取得
  const testVenue = venues[0];
  const testRace = 1;

  console.log(`\nStep 2: Test scraping venue ${testVenue}, race ${testRace}`);
  const racers = await getRacelist(date, testVenue, testRace);

  if (racers && racers.length > 0) {
    console.log('\n✅ Scraping successful!');
  } else {
    console.log('\n❌ Scraping failed or no data');
  }
}

main().catch(console.error);
