# データ移行スクリプト仕様書

## 1. 概要

### 1.1 目的
既存のJSONファイル（`public/data/predictions/*.json`）からSupabaseへデータを移行する。

### 1.2 対象データ
- 日次予測ファイル: `public/data/predictions/YYYY-MM-DD.json`
- サマリーファイル: `public/data/predictions/summary.json`

### 1.3 移行対象期間
- 既存データ: 約30日分（2025-12-04〜2026-01-05）
- 想定レコード数: 約3,300レース

---

## 2. 移行スクリプト

### 2.1 ファイル構成

```
scripts/
├── migrate-to-supabase.js      # メイン移行スクリプト
├── migrate-config.js           # 設定ファイル
└── lib/
    ├── supabase-client.js      # Supabaseクライアント
    ├── json-parser.js          # JSON解析
    └── data-transformer.js     # データ変換
```

### 2.2 メイン移行スクリプト

```javascript
// scripts/migrate-to-supabase.js

const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

// 設定
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const PREDICTIONS_DIR = path.join(__dirname, '../public/data/predictions')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// バッチサイズ（Supabaseの制限対策）
const BATCH_SIZE = 100

/**
 * 日次ファイルを移行
 */
async function migrateDay(dateStr) {
    const filePath = path.join(PREDICTIONS_DIR, `${dateStr}.json`)

    if (!fs.existsSync(filePath)) {
        console.log(`Skip: ${dateStr} (file not found)`)
        return { success: false, reason: 'file_not_found' }
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    console.log(`Processing: ${dateStr} (${data.races.length} races)`)

    const results = {
        races: 0,
        entries: 0,
        predictions: 0,
        results: 0,
        errors: []
    }

    for (const race of data.races) {
        try {
            // 1. races テーブル
            const raceData = transformRace(race, dateStr)
            const { error: raceError } = await supabase
                .from('races')
                .upsert(raceData, { onConflict: 'race_id' })

            if (raceError) throw new Error(`Race: ${raceError.message}`)
            results.races++

            // 2. race_entries テーブル
            const entriesData = transformEntries(race)
            if (entriesData.length > 0) {
                const { error: entriesError } = await supabase
                    .from('race_entries')
                    .upsert(entriesData, { onConflict: 'race_id,boat_number' })

                if (entriesError) throw new Error(`Entries: ${entriesError.message}`)
                results.entries += entriesData.length
            }

            // 3. predictions テーブル
            const predictionsData = transformPredictions(race)
            for (const pred of predictionsData) {
                const { error: predError } = await supabase
                    .from('predictions')
                    .upsert(pred, {
                        onConflict: 'race_id,model_id',
                        ignoreDuplicates: false
                    })

                if (predError) throw new Error(`Prediction: ${predError.message}`)
                results.predictions++
            }

            // 4. race_results テーブル（結果がある場合）
            if (race.result?.finished) {
                const resultData = transformResult(race)
                const { error: resultError } = await supabase
                    .from('race_results')
                    .upsert(resultData, { onConflict: 'race_id' })

                if (resultError) throw new Error(`Result: ${resultError.message}`)
                results.results++
            }

        } catch (error) {
            results.errors.push({
                race_id: race.raceId,
                error: error.message
            })
        }
    }

    return results
}

/**
 * レースデータの変換
 */
function transformRace(race, dateStr) {
    // 1号艇の情報を取得
    const firstBoat = race.predictions?.standard?.players?.find(p => p.number === 1)

    return {
        race_id: race.raceId,
        race_date: dateStr,
        venue_code: race.venueCode,
        race_number: race.raceNumber,
        start_time: race.startTime,
        volatility_score: race.volatility?.score,
        volatility_level: race.volatility?.level,
        recommended_model: race.volatility?.recommendedModel,
        volatility_reasons: race.volatility?.reasons,
        first_boat_grade: firstBoat?.grade,
        first_boat_win_rate: firstBoat ? parseFloat(firstBoat.winRate) : null,
        first_boat_motor_2rate: firstBoat ? parseFloat(firstBoat.motor2Rate) : null,
        // 勝率の統計を計算
        ...calculateWinRateStats(race.predictions?.standard?.players)
    }
}

/**
 * 勝率の統計を計算
 */
function calculateWinRateStats(players) {
    if (!players || players.length === 0) return {}

    const winRates = players.map(p => parseFloat(p.winRate)).filter(r => !isNaN(r))
    const avg = winRates.reduce((a, b) => a + b, 0) / winRates.length
    const stddev = Math.sqrt(
        winRates.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / winRates.length
    )

    const motor2Rates = players.map(p => parseFloat(p.motor2Rate)).filter(r => !isNaN(r))
    const motorStddev = motor2Rates.length > 0
        ? Math.sqrt(
            motor2Rates.reduce((sum, r) => sum + Math.pow(r - motor2Rates.reduce((a, b) => a + b, 0) / motor2Rates.length, 2), 0) / motor2Rates.length
        )
        : null

    return {
        win_rate_avg: avg,
        win_rate_stddev: stddev,
        motor_2rate_stddev: motorStddev
    }
}

/**
 * 出走選手データの変換
 */
function transformEntries(race) {
    const entries = []
    const standardPlayers = race.predictions?.standard?.players || []
    const safeBetPlayers = race.predictions?.safeBet?.players || []
    const upsetPlayers = race.predictions?.upsetFocus?.players || []

    for (const player of standardPlayers) {
        const safeBetPlayer = safeBetPlayers.find(p => p.number === player.number)
        const upsetPlayer = upsetPlayers.find(p => p.number === player.number)

        entries.push({
            race_id: race.raceId,
            boat_number: player.number,
            player_name: player.name?.trim(),
            grade: player.grade,
            age: player.age,
            win_rate: parseFloat(player.winRate),
            local_win_rate: parseFloat(player.localWinRate),
            motor_number: player.motorNumber,
            motor_2rate: parseFloat(player.motor2Rate),
            boat_number_id: player.boatNumber,
            boat_2rate: parseFloat(player.boat2Rate),
            ai_score_standard: player.aiScore,
            ai_score_safe_bet: safeBetPlayer?.aiScore,
            ai_score_upset_focus: upsetPlayer?.aiScore
        })
    }

    return entries
}

/**
 * 予測データの変換
 */
function transformPredictions(race) {
    const predictions = []
    const modelMapping = {
        'standard': 'standard',
        'safeBet': 'safeBet',
        'upsetFocus': 'upsetFocus'
    }

    for (const [key, modelId] of Object.entries(modelMapping)) {
        const pred = race.predictions?.[key]
        if (!pred) continue

        // スコアをJSON形式に変換
        const scores = {}
        if (pred.players) {
            for (const player of pred.players) {
                scores[player.number] = player.aiScore
            }
        }

        predictions.push({
            race_id: race.raceId,
            model_id: modelId,
            top_pick: pred.topPick,
            top_2nd: pred.top3?.[1],
            top_3rd: pred.top3?.[2],
            confidence: pred.confidence,
            scores: Object.keys(scores).length > 0 ? scores : null,
            is_shadow: false,
            predicted_at: new Date().toISOString()
        })
    }

    return predictions
}

/**
 * 結果データの変換
 */
function transformResult(race) {
    const result = race.result

    // 配当を取得
    const winPayout = result.payouts?.win
        ? Object.values(result.payouts.win)[0]
        : null

    const placePayout1 = result.payouts?.place
        ? Object.values(result.payouts.place)[0]
        : null
    const placePayout2 = result.payouts?.place
        ? Object.values(result.payouts.place)[1]
        : null

    const trifectaPayout = result.payouts?.trifecta
        ? Object.values(result.payouts.trifecta)[0]
        : null

    const trioPayout = result.payouts?.trio
        ? Object.values(result.payouts.trio)[0]
        : null

    return {
        race_id: race.raceId,
        rank1: result.rank1,
        rank2: result.rank2,
        rank3: result.rank3,
        payout_win: winPayout,
        payout_place_1: placePayout1,
        payout_place_2: placePayout2,
        payout_trifecta: trifectaPayout,
        payout_trio: trioPayout,
        result_at: result.updatedAt
    }
}

/**
 * 全日次ファイルを移行
 */
async function migrateAll() {
    console.log('='.repeat(60))
    console.log('龍神レーダー Data Migration to Supabase')
    console.log('='.repeat(60))

    // 日次ファイル一覧を取得
    const files = fs.readdirSync(PREDICTIONS_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()

    console.log(`Found ${files.length} daily files\n`)

    const totalResults = {
        files: 0,
        races: 0,
        entries: 0,
        predictions: 0,
        results: 0,
        errors: []
    }

    for (const file of files) {
        const dateStr = file.replace('.json', '')
        const result = await migrateDay(dateStr)

        if (result.success !== false) {
            totalResults.files++
            totalResults.races += result.races
            totalResults.entries += result.entries
            totalResults.predictions += result.predictions
            totalResults.results += result.results
            totalResults.errors.push(...result.errors)
        }

        // レート制限対策
        await sleep(100)
    }

    console.log('\n' + '='.repeat(60))
    console.log('Migration Complete')
    console.log('='.repeat(60))
    console.log(`Files processed: ${totalResults.files}`)
    console.log(`Races: ${totalResults.races}`)
    console.log(`Entries: ${totalResults.entries}`)
    console.log(`Predictions: ${totalResults.predictions}`)
    console.log(`Results: ${totalResults.results}`)
    console.log(`Errors: ${totalResults.errors.length}`)

    if (totalResults.errors.length > 0) {
        console.log('\nError details:')
        for (const error of totalResults.errors.slice(0, 10)) {
            console.log(`  - ${error.race_id}: ${error.error}`)
        }
        if (totalResults.errors.length > 10) {
            console.log(`  ... and ${totalResults.errors.length - 10} more`)
        }
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

// 実行
migrateAll().catch(console.error)
```

---

## 3. 移行手順

### 3.1 事前準備

```bash
# 1. 環境変数の設定
export SUPABASE_URL="https://xxxxx.supabase.co"
export SUPABASE_SERVICE_KEY="eyJxxxx..."  # service_role key

# 2. 依存関係のインストール
npm install @supabase/supabase-js
```

### 3.2 Supabaseでスキーマ作成

```bash
# Supabase SQL Editorで実行
# docs/db-migration/001_schema.sql の内容をコピー&ペースト
```

### 3.3 移行実行

```bash
# ドライラン（1日分のみ）
node scripts/migrate-to-supabase.js --dry-run --date 2026-01-04

# 本番移行
node scripts/migrate-to-supabase.js
```

### 3.4 検証

```sql
-- レコード数確認
SELECT 'races' AS table_name, COUNT(*) FROM races
UNION ALL
SELECT 'race_entries', COUNT(*) FROM race_entries
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions
UNION ALL
SELECT 'race_results', COUNT(*) FROM race_results;

-- 予測結果の自動更新確認
SELECT
    p.race_id,
    p.model_id,
    p.top_pick,
    p.is_hit_win,
    p.payout_win,
    r.rank1
FROM predictions p
JOIN race_results r ON p.race_id = r.race_id
LIMIT 10;
```

---

## 4. ロールバック手順

### 4.1 データ削除（全削除）

```sql
-- 依存関係の順序で削除
TRUNCATE TABLE bet_recommendations CASCADE;
TRUNCATE TABLE daily_bet_summary CASCADE;
TRUNCATE TABLE user_visible_summary CASCADE;
TRUNCATE TABLE model_performance_daily CASCADE;
TRUNCATE TABLE predictions CASCADE;
TRUNCATE TABLE race_results CASCADE;
TRUNCATE TABLE race_entries CASCADE;
TRUNCATE TABLE race_conditions CASCADE;
TRUNCATE TABLE races CASCADE;

-- venuesとmodelsは初期データなので残す
```

### 4.2 特定日付のみ削除

```sql
-- 特定日付のデータを削除
DELETE FROM races WHERE race_date = '2026-01-04';
-- CASCADE設定により関連テーブルも自動削除
```

---

## 5. エラーハンドリング

### 5.1 想定されるエラー

| エラー | 原因 | 対処 |
|--------|------|------|
| `duplicate key value` | 同じrace_idが存在 | upsertで上書き |
| `foreign key violation` | venue_codeが存在しない | venuesを先に投入 |
| `rate limit exceeded` | Supabaseの制限 | sleep追加 |
| `payload too large` | バッチサイズ超過 | 分割して送信 |

### 5.2 リトライロジック

```javascript
async function withRetry(fn, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn()
        } catch (error) {
            if (i === maxRetries - 1) throw error
            console.log(`Retry ${i + 1}/${maxRetries}: ${error.message}`)
            await sleep(1000 * (i + 1))
        }
    }
}
```

---

## 6. 移行後の確認事項

- [ ] 全日次ファイルが移行されたか
- [ ] レース数がJSONと一致するか
- [ ] 予測の的中フラグが正しく設定されているか
- [ ] 配当が正しく記録されているか
- [ ] ビューが正常に動作するか
- [ ] トリガーが動作するか（新しい結果挿入時）
