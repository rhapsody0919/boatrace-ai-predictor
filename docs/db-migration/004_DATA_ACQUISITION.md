# データ取得仕様書

## 1. 概要

### 1.1 データソース

| データ | ソース | 取得方法 | 優先度 |
|--------|--------|----------|--------|
| レース基本情報 | BOATRACE公式 | スクレイピング | 必須 |
| 選手情報 | BOATRACE公式 | スクレイピング | 必須 |
| レース結果 | BOATRACE公式 | スクレイピング | 必須 |
| 天候・風・波 | BOATRACE公式 | スクレイピング | Phase2 |
| 展示タイム | BOATRACE公式 | スクレイピング | Phase2 |
| オッズ | BOATRACE公式 | スクレイピング | Phase2 |
| レースグレード | BOATRACE公式 | スクレイピング | Phase2 |

### 1.2 取得タイミング

```
[06:00] 当日のレース一覧・出走表取得
[10:00] 展示情報取得（展示タイム・ST）
[発走3分前] オッズ取得（締切直前）
[レース後5分] 結果取得
[22:00] 全レース結果確定後の一括取得
```

---

## 2. BOATRACE公式サイト構造

### 2.1 主要URL

```
# レース一覧（日付指定）
https://www.boatrace.jp/owpc/pc/race/index?hd=YYYYMMDD

# 出走表（会場・レース指定）
https://www.boatrace.jp/owpc/pc/race/racelist?rno=R&jcd=JJ&hd=YYYYMMDD

# オッズ（単勝）
https://www.boatrace.jp/owpc/pc/race/oddstf?rno=R&jcd=JJ&hd=YYYYMMDD

# 結果
https://www.boatrace.jp/owpc/pc/race/raceresult?rno=R&jcd=JJ&hd=YYYYMMDD

# 会場コード（JJ）
01:桐生, 02:戸田, 03:江戸川, 04:平和島, 05:多摩川, 06:浜名湖
07:蒲郡, 08:常滑, 09:津, 10:三国, 11:びわこ, 12:住之江
13:尼崎, 14:鳴門, 15:丸亀, 16:児島, 17:宮島, 18:徳山
19:下関, 20:若松, 21:芦屋, 22:福岡, 23:唐津, 24:大村
```

### 2.2 HTMLセレクタ

```javascript
// 出走表ページのセレクタ
const SELECTORS = {
    // レース情報
    raceTitle: '.heading2_title',
    raceGrade: '.label2',
    startTime: '.is-fs12',

    // 天候情報
    weather: '.weather1_body .weather1_bodyUnitLabelTitle',
    temperature: '.weather1_body .weather1_bodyUnitLabelData',
    windDirection: '.weather1_bodyUnit.is-wind .weather1_bodyUnitImage',
    windSpeed: '.weather1_bodyUnit.is-wind .weather1_bodyUnitLabelData',
    waveHeight: '.weather1_bodyUnit.is-wave .weather1_bodyUnitLabelData',

    // 選手情報（テーブル）
    playerRow: '.table1 tbody tr',
    playerName: '.is-fs18',
    playerGrade: '.is-fs11',
    winRate: 'td:nth-child(5)',
    localWinRate: 'td:nth-child(6)',
    motorNumber: 'td:nth-child(7)',
    motor2Rate: 'td:nth-child(8)',
    boatNumber: 'td:nth-child(9)',
    boat2Rate: 'td:nth-child(10)',

    // 展示タイム
    exhibitionTime: '.table1 tbody tr td:nth-child(11)',
    startTiming: '.table1 tbody tr td:nth-child(12)'
}
```

---

## 3. データ取得実装

### 3.1 共通クライアント

```javascript
// scripts/lib/scraper-client.js

const axios = require('axios')
const cheerio = require('cheerio')

const BASE_URL = 'https://www.boatrace.jp/owpc/pc/race'

// レート制限対策
const RATE_LIMIT_MS = 1000

class BoatraceClient {
    constructor() {
        this.lastRequestTime = 0
    }

    async fetch(path, params = {}) {
        // レート制限
        const now = Date.now()
        const elapsed = now - this.lastRequestTime
        if (elapsed < RATE_LIMIT_MS) {
            await sleep(RATE_LIMIT_MS - elapsed)
        }

        const url = `${BASE_URL}/${path}`
        const response = await axios.get(url, {
            params,
            headers: {
                'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
                'Accept-Language': 'ja'
            },
            timeout: 10000
        })

        this.lastRequestTime = Date.now()
        return cheerio.load(response.data)
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = { BoatraceClient }
```

### 3.2 レース一覧取得

```javascript
// scripts/lib/fetch-race-list.js

const { BoatraceClient } = require('./scraper-client')

async function fetchRaceList(dateStr) {
    const client = new BoatraceClient()
    const hd = dateStr.replace(/-/g, '')

    const $ = await client.fetch('index', { hd })

    const races = []

    // 会場ごとのレース一覧を取得
    $('.table1').each((_, table) => {
        const venueCode = $(table).attr('data-jcd')
        const venueName = $(table).find('.heading2_title').text().trim()

        $(table).find('tbody tr').each((_, row) => {
            const raceNumber = parseInt($(row).find('td:first-child').text())
            const startTime = $(row).find('.is-fs12').text().trim()

            if (raceNumber >= 1 && raceNumber <= 12) {
                races.push({
                    raceId: `${dateStr}-${venueCode.padStart(2, '0')}-${String(raceNumber).padStart(2, '0')}`,
                    date: dateStr,
                    venueCode: parseInt(venueCode),
                    venueName,
                    raceNumber,
                    startTime
                })
            }
        })
    })

    return races
}

module.exports = { fetchRaceList }
```

### 3.3 出走表取得

```javascript
// scripts/lib/fetch-race-card.js

async function fetchRaceCard(raceId) {
    const [date, venueCode, raceNumber] = raceId.split('-')
    const client = new BoatraceClient()

    const $ = await client.fetch('racelist', {
        hd: date.replace(/-/g, ''),
        jcd: venueCode,
        rno: parseInt(raceNumber)
    })

    // 天候情報
    const weather = {
        weather: $('.weather1_bodyUnitLabelTitle').eq(0).text().trim(),
        temperature: parseFloat($('.weather1_bodyUnitLabelData').eq(0).text()),
        windDirection: parseWindDirection($('.weather1_bodyUnit.is-wind .weather1_bodyUnitImage').attr('class')),
        windSpeed: parseFloat($('.weather1_bodyUnit.is-wind .weather1_bodyUnitLabelData').text()),
        waveHeight: parseInt($('.weather1_bodyUnit.is-wave .weather1_bodyUnitLabelData').text())
    }

    // レースグレード
    const gradeText = $('.label2').text().trim()
    const grade = parseGrade(gradeText)

    // 選手情報
    const players = []
    $('.table1 tbody tr').each((index, row) => {
        const $row = $(row)
        const boatNumber = index + 1

        players.push({
            number: boatNumber,
            name: $row.find('.is-fs18').text().trim(),
            grade: $row.find('.is-fs11').text().trim(),
            age: parseInt($row.find('td:nth-child(3)').text()),
            weight: parseFloat($row.find('td:nth-child(4)').text()),
            winRate: parseFloat($row.find('td:nth-child(5)').text()),
            localWinRate: parseFloat($row.find('td:nth-child(6)').text()),
            motorNumber: parseInt($row.find('td:nth-child(7)').text()),
            motor2Rate: parseFloat($row.find('td:nth-child(8)').text()),
            boatNumber: parseInt($row.find('td:nth-child(9)').text()),
            boat2Rate: parseFloat($row.find('td:nth-child(10)').text())
        })
    })

    return {
        raceId,
        weather,
        grade,
        players
    }
}

function parseWindDirection(className) {
    // クラス名から風向きを判定
    // is-wind1: 北, is-wind2: 北東, etc.
    const match = className?.match(/is-wind(\d+)/)
    if (!match) return null

    const directions = ['北', '北東', '東', '南東', '南', '南西', '西', '北西']
    return directions[parseInt(match[1]) - 1] || null
}

function parseGrade(text) {
    if (text.includes('SG')) return 'SG'
    if (text.includes('G1') || text.includes('GⅠ')) return 'G1'
    if (text.includes('G2') || text.includes('GⅡ')) return 'G2'
    if (text.includes('G3') || text.includes('GⅢ')) return 'G3'
    return 'ippan'
}

module.exports = { fetchRaceCard }
```

### 3.4 展示情報取得

```javascript
// scripts/lib/fetch-exhibition.js

async function fetchExhibition(raceId) {
    const [date, venueCode, raceNumber] = raceId.split('-')
    const client = new BoatraceClient()

    const $ = await client.fetch('beforeinfo', {
        hd: date.replace(/-/g, ''),
        jcd: venueCode,
        rno: parseInt(raceNumber)
    })

    const exhibitions = []

    $('.table1 tbody tr').each((index, row) => {
        const $row = $(row)
        const boatNumber = index + 1

        exhibitions.push({
            raceId,
            boatNumber,
            exhibitionTime: parseFloat($row.find('td:nth-child(5)').text()) || null,
            startTiming: parseFloat($row.find('td:nth-child(6)').text()) || null
        })
    })

    return exhibitions
}

module.exports = { fetchExhibition }
```

### 3.5 オッズ取得

```javascript
// scripts/lib/fetch-odds.js

async function fetchOdds(raceId) {
    const [date, venueCode, raceNumber] = raceId.split('-')
    const client = new BoatraceClient()

    // 単勝オッズ
    const $ = await client.fetch('oddstf', {
        hd: date.replace(/-/g, ''),
        jcd: venueCode,
        rno: parseInt(raceNumber)
    })

    const winOdds = {}
    $('.oddsPoint').each((index, el) => {
        const boatNumber = index + 1
        const odds = parseFloat($(el).text())
        winOdds[boatNumber] = odds
    })

    // 3連単上位オッズ（別ページ）
    const $trio = await client.fetch('odds3t', {
        hd: date.replace(/-/g, ''),
        jcd: venueCode,
        rno: parseInt(raceNumber)
    })

    const trioPopular = []
    $trio('.is-p3-0 tbody tr').slice(0, 3).each((index, row) => {
        const $row = $trio(row)
        trioPopular.push({
            combination: $row.find('td:first-child').text().trim(),
            odds: parseFloat($row.find('td:last-child').text())
        })
    })

    return {
        raceId,
        capturedAt: new Date().toISOString(),
        winOdds,
        trioPopular
    }
}

module.exports = { fetchOdds }
```

### 3.6 結果取得

```javascript
// scripts/lib/fetch-result.js

async function fetchResult(raceId) {
    const [date, venueCode, raceNumber] = raceId.split('-')
    const client = new BoatraceClient()

    const $ = await client.fetch('raceresult', {
        hd: date.replace(/-/g, ''),
        jcd: venueCode,
        rno: parseInt(raceNumber)
    })

    // レースが終了しているか確認
    if ($('.table1_result').length === 0) {
        return { finished: false }
    }

    // 着順
    const ranks = []
    $('.table1_result tbody tr').each((_, row) => {
        const boatNumber = parseInt($(row).find('td:nth-child(2)').text())
        if (boatNumber >= 1 && boatNumber <= 6) {
            ranks.push(boatNumber)
        }
    })

    // 配当
    const payouts = {}

    // 単勝
    const winPayout = parseInt($('.table1_pay tr:contains("単勝") td:last-child').text().replace(/[^0-9]/g, ''))
    if (winPayout) payouts.win = winPayout

    // 複勝
    const placePayouts = []
    $('.table1_pay tr:contains("複勝")').each((_, row) => {
        const payout = parseInt($(row).find('td:last-child').text().replace(/[^0-9]/g, ''))
        if (payout) placePayouts.push(payout)
    })
    if (placePayouts.length > 0) payouts.place = placePayouts

    // 3連複
    const trifectaPayout = parseInt($('.table1_pay tr:contains("3連複") td:last-child').text().replace(/[^0-9]/g, ''))
    if (trifectaPayout) payouts.trifecta = trifectaPayout

    // 3連単
    const trioPayout = parseInt($('.table1_pay tr:contains("3連単") td:last-child').text().replace(/[^0-9]/g, ''))
    if (trioPayout) payouts.trio = trioPayout

    // 決まり手
    const technique = $('.table1_result .is-fs14').text().trim()

    return {
        finished: true,
        rank1: ranks[0],
        rank2: ranks[1],
        rank3: ranks[2],
        payouts,
        technique
    }
}

module.exports = { fetchResult }
```

---

## 4. DB登録

### 4.1 天候データ登録

```javascript
async function saveRaceConditions(raceId, weather, grade) {
    await supabase
        .from('race_conditions')
        .upsert({
            race_id: raceId,
            weather: weather.weather,
            wind_direction: weather.windDirection,
            wind_speed: weather.windSpeed,
            wave_height: weather.waveHeight,
            temperature: weather.temperature,
            race_grade: grade
        }, { onConflict: 'race_id' })
}
```

### 4.2 オッズデータ登録

```javascript
async function saveOdds(odds) {
    await supabase
        .from('race_odds')
        .insert({
            race_id: odds.raceId,
            captured_at: odds.capturedAt,
            odds_win_1: odds.winOdds[1],
            odds_win_2: odds.winOdds[2],
            odds_win_3: odds.winOdds[3],
            odds_win_4: odds.winOdds[4],
            odds_win_5: odds.winOdds[5],
            odds_win_6: odds.winOdds[6],
            trifecta_popular_1: odds.trioPopular[0]?.combination,
            trifecta_odds_1: odds.trioPopular[0]?.odds,
            trifecta_popular_2: odds.trioPopular[1]?.combination,
            trifecta_odds_2: odds.trioPopular[1]?.odds,
            trifecta_popular_3: odds.trioPopular[2]?.combination,
            trifecta_odds_3: odds.trioPopular[2]?.odds
        })
}
```

### 4.3 展示データ登録

```javascript
async function saveExhibition(exhibitions) {
    await supabase
        .from('exhibition_data')
        .upsert(exhibitions, { onConflict: 'race_id,boat_number' })
}
```

---

## 5. 注意事項

### 5.1 スクレイピングのマナー

- リクエスト間隔: 最低1秒
- User-Agent: 適切なものを設定
- robots.txt: 確認すること
- 負荷: 1日あたり1000リクエスト以下を目安

### 5.2 エラーハンドリング

```javascript
async function fetchWithRetry(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn()
        } catch (error) {
            if (error.response?.status === 404) {
                // レースが存在しない
                return null
            }
            if (error.response?.status === 503) {
                // メンテナンス中
                await sleep(60000)
                continue
            }
            if (i === maxRetries - 1) throw error
            await sleep(5000 * (i + 1))
        }
    }
}
```

### 5.3 データ品質チェック

```javascript
function validateRaceData(race) {
    const errors = []

    if (!race.raceId) errors.push('raceId is required')
    if (race.players?.length !== 6) errors.push('players must be 6')
    if (race.raceNumber < 1 || race.raceNumber > 12) errors.push('invalid raceNumber')

    for (const player of race.players || []) {
        if (isNaN(player.winRate)) errors.push(`player ${player.number} winRate is NaN`)
        if (player.grade && !['A1', 'A2', 'B1', 'B2'].includes(player.grade)) {
            errors.push(`player ${player.number} invalid grade: ${player.grade}`)
        }
    }

    return errors
}
```
