// スクレイピング時間計測テスト
import * as cheerio from 'cheerio';

// URLを生成する関数
function getUrl(date, placeCd, raceNo, content) {
  const urlBase = 'https://www.boatrace.jp/owpc/pc/race/';
  const ymd = date.replace(/-/g, '');
  const jcd = placeCd < 10 ? `0${placeCd}` : `${placeCd}`;
  const url = `${urlBase}${content}?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  return url;
}

// 直前情報を取得する関数
async function getBeforeinfo(date, placeCd, raceNo) {
  const startTime = Date.now();
  try {
    const url = getUrl(date, placeCd, raceNo, 'beforeinfo');
    console.log(`  Fetching: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) {
      const elapsed = Date.now() - startTime;
      console.log(`  ❌ HTTP ${response.status} (${elapsed}ms)`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 簡易的にデータが取得できたか確認
    const weatherData = [];
    $('.weather1_bodyUnitLabelData').each((i, elem) => {
      weatherData.push($(elem).text().trim());
    });

    const elapsed = Date.now() - startTime;
    console.log(`  ✅ Success (${elapsed}ms) - Weather data points: ${weatherData.length}`);

    return { placeCd, raceNo, elapsed, dataPoints: weatherData.length };
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.log(`  ❌ Error (${elapsed}ms): ${error.message}`);
    return null;
  }
}

// 本日開催中のレース場リストを取得
async function getTodayVenues() {
  const startTime = Date.now();
  try {
    const url = 'https://www.boatrace.jp/owpc/pc/race/index';
    console.log(`Fetching today's venues from: ${url}`);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const venues = new Set();

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
    const elapsed = Date.now() - startTime;
    console.log(`✅ Found ${venuesList.length} venues in ${elapsed}ms: ${venuesList.join(', ')}\n`);
    return venuesList;

  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`❌ Error fetching venues (${elapsed}ms):`, error.message);
    return [];
  }
}

// 今日の日付を取得
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// テスト実行
async function runTests() {
  console.log('='.repeat(60));
  console.log('ボートレーススクレイピング時間計測テスト');
  console.log('='.repeat(60));
  console.log();

  const date = getTodayDate();
  console.log(`Test Date: ${date}\n`);

  // テスト1: 本日の会場取得時間
  console.log('【テスト1】本日の会場取得');
  console.log('-'.repeat(60));
  const test1Start = Date.now();
  const todayVenues = await getTodayVenues();
  const test1Time = Date.now() - test1Start;
  console.log(`Total time: ${test1Time}ms\n`);

  if (todayVenues.length === 0) {
    console.log('❌ 会場が取得できなかったため、テスト終了');
    return;
  }

  // テスト2: 単一レース取得時間
  console.log('【テスト2】単一レース取得（1会場1レース）');
  console.log('-'.repeat(60));
  const test2Start = Date.now();
  await getBeforeinfo(date, todayVenues[0], 1);
  const test2Time = Date.now() - test2Start;
  console.log(`Total time: ${test2Time}ms\n`);

  // テスト3: 3レース並列取得
  console.log('【テスト3】3レース並列取得（1会場3レース）');
  console.log('-'.repeat(60));
  const test3Start = Date.now();
  const promises3 = [];
  for (let i = 1; i <= 3; i++) {
    promises3.push(getBeforeinfo(date, todayVenues[0], i));
  }
  await Promise.all(promises3);
  const test3Time = Date.now() - test3Start;
  console.log(`Total time: ${test3Time}ms\n`);

  // テスト4: 9レース並列取得（3会場×3レース）
  console.log('【テスト4】9レース並列取得（3会場×3レース）');
  console.log('-'.repeat(60));
  const test4Start = Date.now();
  const promises4 = [];
  const testVenues = todayVenues.slice(0, 3);
  for (const placeCd of testVenues) {
    for (let raceNo = 1; raceNo <= 3; raceNo++) {
      promises4.push(getBeforeinfo(date, placeCd, raceNo));
    }
  }
  const results4 = await Promise.all(promises4);
  const test4Time = Date.now() - test4Start;
  const successCount = results4.filter(r => r !== null).length;
  console.log(`Total time: ${test4Time}ms (${successCount}/9 succeeded)\n`);

  // テスト5: 会場ごとに順次、レースは並列（3会場×3レース）
  console.log('【テスト5】会場ごとに順次、レースは並列（3会場×3レース）');
  console.log('-'.repeat(60));
  const test5Start = Date.now();
  let test5SuccessCount = 0;
  for (const placeCd of testVenues) {
    console.log(`  Processing venue ${placeCd}...`);
    const racePromises = [];
    for (let raceNo = 1; raceNo <= 3; raceNo++) {
      racePromises.push(getBeforeinfo(date, placeCd, raceNo));
    }
    const raceResults = await Promise.all(racePromises);
    test5SuccessCount += raceResults.filter(r => r !== null).length;
  }
  const test5Time = Date.now() - test5Start;
  console.log(`Total time: ${test5Time}ms (${test5SuccessCount}/9 succeeded)\n`);

  // まとめ
  console.log('='.repeat(60));
  console.log('【結果サマリー】');
  console.log('='.repeat(60));
  console.log(`テスト1 (会場リスト取得):           ${test1Time}ms`);
  console.log(`テスト2 (単一レース):               ${test2Time}ms`);
  console.log(`テスト3 (3レース並列):              ${test3Time}ms`);
  console.log(`テスト4 (9レース全並列):            ${test4Time}ms`);
  console.log(`テスト5 (会場順次・レース並列):     ${test5Time}ms`);
  console.log();
  console.log(`合計時間 (テスト1+4):               ${test1Time + test4Time}ms`);
  console.log(`合計時間 (テスト1+5):               ${test1Time + test5Time}ms`);
  console.log();
  console.log(`Vercel無料プラン制限:              10,000ms (10秒)`);
  if (test1Time + test4Time < 10000) {
    console.log('✅ 10秒以内に収まっています');
  } else {
    console.log('❌ 10秒を超えています');
    console.log(`   超過時間: ${test1Time + test4Time - 10000}ms`);
  }
  console.log('='.repeat(60));
}

// 実行
runTests().catch(console.error);
