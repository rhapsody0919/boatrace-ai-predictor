// Vercel Serverless Function for scraping boatrace data
import * as cheerio from 'cheerio';

// In-memory cache
let cache = {
  data: null,
  timestamp: null
};

const CACHE_DURATION = 5 * 60 * 1000; // 5分間キャッシュ

// レース場マッピング (1-24)
const VENUES = {
  1: '桐生', 2: '戸田', 3: '江戸川', 4: '平和島', 5: '多摩川', 6: '浜名湖',
  7: '蒲郡', 8: '常滑', 9: '津', 10: '三国', 11: 'びわこ', 12: '住之江',
  13: '尼崎', 14: '鳴門', 15: '丸亀', 16: '児島', 17: '宮島', 18: '徳山',
  19: '下関', 20: '若松', 21: '芦屋', 22: '福岡', 23: '唐津', 24: '大村'
};

// URLを生成する関数
function getUrl(date, placeCd, raceNo, content) {
  const urlBase = 'https://www.boatrace.jp/owpc/pc/race/';

  // 日付をYYYYMMDD形式に変換
  const ymd = date.replace(/-/g, '');

  // 場コードを2桁にする（10未満は0埋め）
  const jcd = placeCd < 10 ? `0${placeCd}` : `${placeCd}`;

  const url = `${urlBase}${content}?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
  return url;
}

// 直前情報を取得する関数
async function getBeforeinfo(date, placeCd, raceNo) {
  try {
    const url = getUrl(date, placeCd, raceNo, 'beforeinfo');

    // タイムアウト設定: 5秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status} for URL: ${url}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // 天候情報を取得
    const weatherData = [];
    $('.weather1_bodyUnitLabelData').each((i, elem) => {
      weatherData.push($(elem).text().trim());
    });

    // 天気を取得
    let weather = '';
    $('.weather1_bodyUnitLabelTitle').each((i, elem) => {
      if (i === 1) {
        weather = $(elem).text().trim();
      }
    });

    // 風向を取得
    let windDirection = 0;
    const windElem = $('p[class*="is-wind"]');
    if (windElem.length > 0) {
      const classes = windElem.attr('class');
      const windClass = classes.split(' ').find(c => c.startsWith('is-wind'));
      if (windClass) {
        windDirection = parseInt(windClass.replace('is-wind', ''));
      }
    }

    // 展示タイムとチルトの情報を取得
    const arr1 = [];
    $('.is-fs12').each((i, elem) => {
      const tds = $(elem).find('td');
      if (tds.length >= 6) {
        const et = $(tds[4]).text().trim();
        const tilt = $(tds[5]).text().trim();
        arr1.push({
          ET: et === '\xa0' || et === '' ? '' : et,
          tilt: tilt === '\xa0' || tilt === '' ? '' : tilt
        });
      }
    });

    // スタート展示情報を取得
    const arr2 = [];
    $('.table1_boatImage1').each((i, elem) => {
      const estNumber = $(elem).find('.table1_boatImage1Number').text().trim();
      const estTime = $(elem).find('.table1_boatImage1Time').text().trim();

      arr2.push({
        EST_Number: estNumber,
        EST_Time: estTime.replace('F', '-'),
        originalIndex: i + 1
      });
    });

    // スタート展示番号でソート
    arr2.sort((a, b) => {
      const aNum = parseInt(a.EST_Number) || 0;
      const bNum = parseInt(b.EST_Number) || 0;
      return aNum - bNum;
    });

    // データを統合
    const result = {
      date: date,
      placeCd: placeCd,
      raceNo: raceNo,
      weather: weather,
      airTemp: weatherData[0] ? parseFloat(weatherData[0].replace('℃', '')) : null,
      windDirection: windDirection,
      windVelocity: weatherData[1] ? parseFloat(weatherData[1].replace('m', '')) : null,
      waterTemp: weatherData[2] ? parseFloat(weatherData[2].replace('℃', '')) : null,
      waveHeight: weatherData[3] ? parseFloat(weatherData[3].replace('cm', '')) : null,
      racers: []
    };

    // 各艇のデータを統合
    for (let i = 0; i < 6; i++) {
      const racerData = {
        number: i + 1,
        ET: arr1[i] ? arr1[i].ET : '',
        tilt: arr1[i] ? arr1[i].tilt : '',
        EST: arr2[i] ? arr2[i].EST_Time : '',
        ESC: arr2[i] ? arr2[i].EST_Number : ''
      };
      result.racers.push(racerData);
    }

    return result;

  } catch (error) {
    console.error(`Error fetching beforeinfo for place ${placeCd}, race ${raceNo}:`, error.message);
    return null;
  }
}

// 今日の日付を取得 (YYYY-MM-DD形式)
function getTodayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 本日開催中のレース場リストを取得
async function getTodayVenues() {
  try {
    const url = 'https://www.boatrace.jp/owpc/pc/race/index';

    // タイムアウト設定: 5秒
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`HTTP error! status: ${response.status} for URL: ${url}`);
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const venues = new Set();

    // 開催中のレース場を抽出（raceindexへのリンクからjcdを取得）
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
    console.log(`Found ${venuesList.length} venues open today:`, venuesList);
    return venuesList;

  } catch (error) {
    console.error('Error fetching today\'s venues:', error.message);
    return [];
  }
}

export default async function handler(req, res) {
  // CORSヘッダーの設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // OPTIONSリクエストの処理
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();

  // キャッシュチェック
  if (cache.data && cache.timestamp && (now - cache.timestamp < CACHE_DURATION)) {
    console.log('Returning cached data');
    return res.status(200).json({
      success: true,
      data: cache.data,
      cached: true,
      cacheAge: Math.floor((now - cache.timestamp) / 1000)
    });
  }

  try {
    console.log('Fetching fresh data from boatrace.jp');

    const date = getTodayDate();

    // 本日開催中のレース場リストを取得
    const todayVenues = await getTodayVenues();

    if (todayVenues.length === 0) {
      console.log('No venues found for today');
      return res.status(200).json({
        success: true,
        data: [],
        cached: false,
        message: 'No races today'
      });
    }

    const allRaces = [];

    // 開催中のレース場のみ取得（並列処理で高速化）
    const MAX_VENUES = 3; // タイムアウト対策: 最初の3会場のみ
    const MAX_RACES = 3; // タイムアウト対策: 1-3Rのみ取得

    // 会場数を制限
    const limitedVenues = todayVenues.slice(0, MAX_VENUES);

    // 全会場のレースを並列で取得
    const venuePromises = limitedVenues.map(async (placeCd) => {
      const venueRaces = [];

      // 1RからMAX_RACESまで並列取得
      const racePromises = [];
      for (let raceNo = 1; raceNo <= MAX_RACES; raceNo++) {
        racePromises.push(getBeforeinfo(date, placeCd, raceNo));
      }

      const results = await Promise.all(racePromises);

      // nullでないデータのみを追加
      results.forEach(result => {
        if (result) {
          venueRaces.push(result);
        }
      });

      // このレース場でデータが取得できた場合のみ返す
      if (venueRaces.length > 0) {
        return {
          placeCd: placeCd,
          placeName: VENUES[placeCd] || `レース場${placeCd}`,
          races: venueRaces
        };
      }
      return null;
    });

    const venueResults = await Promise.all(venuePromises);

    // nullでない会場のみを追加
    venueResults.forEach(venue => {
      if (venue) {
        allRaces.push(venue);
      }
    });

    // キャッシュを更新
    cache.data = allRaces;
    cache.timestamp = now;

    console.log(`Successfully scraped ${allRaces.length} venues with race data`);

    return res.status(200).json({
      success: true,
      data: allRaces,
      cached: false,
      scrapedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in scraping:', error);

    // エラー時はキャッシュがあればそれを返す
    if (cache.data) {
      console.log('Returning stale cache due to error');
      return res.status(200).json({
        success: true,
        data: cache.data,
        cached: true,
        error: 'Using stale cache due to scraping error'
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to scrape race data',
      message: error.message
    });
  }
}
