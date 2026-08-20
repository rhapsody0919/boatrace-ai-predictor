/**
 * JSON → Supabase 移行スクリプト
 *
 * Usage:
 *   node scripts/migrate-to-supabase.js           # 全データ移行
 *   node scripts/migrate-to-supabase.js --date 2026-01-04  # 特定日のみ
 *   node scripts/migrate-to-supabase.js --dry-run # ドライラン
 */

import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

// .env.local を読み込む
dotenv.config({ path: '.env.local' })
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Supabase設定
const SUPABASE_URL = process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const PREDICTIONS_DIR = path.join(__dirname, '../../public/data/predictions')

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// 移行統計
const stats = {
    files: 0,
    races: 0,
    entries: 0,
    predictions: 0,
    results: 0,
    errors: []
}

// コマンドライン引数
const args = process.argv.slice(2)
const isDryRun = args.includes('--dry-run')
const dateArg = args.find((_, i) => args[i - 1] === '--date')

/**
 * レースデータの変換
 */
function transformRace(race, dateStr) {
    const firstBoat = race.predictions?.standard?.players?.find(p => p.number === 1)
        || race.prediction?.players?.find(p => p.number === 1)

    const players = race.predictions?.standard?.players || race.prediction?.players || []
    const winRates = players.map(p => parseFloat(p.winRate)).filter(r => !isNaN(r))
    const motor2Rates = players.map(p => parseFloat(p.motor2Rate)).filter(r => !isNaN(r))

    const winRateAvg = winRates.length > 0
        ? winRates.reduce((a, b) => a + b, 0) / winRates.length
        : null
    const winRateStddev = winRates.length > 0
        ? Math.sqrt(winRates.reduce((sum, r) => sum + Math.pow(r - winRateAvg, 2), 0) / winRates.length)
        : null
    const motor2RateStddev = motor2Rates.length > 0
        ? Math.sqrt(motor2Rates.reduce((sum, r) => sum + Math.pow(r - motor2Rates.reduce((a, b) => a + b, 0) / motor2Rates.length, 2), 0) / motor2Rates.length)
        : null

    return {
        race_id: race.raceId,
        race_date: dateStr,
        venue_code: race.venueCode,
        race_number: race.raceNumber,
        start_time: race.startTime,
        volatility_score: race.volatility?.score || null,
        volatility_level: race.volatility?.level || null,
        recommended_model: race.volatility?.recommendedModel || null,
        volatility_reasons: race.volatility?.reasons || null,
        first_boat_grade: firstBoat?.grade || null,
        first_boat_win_rate: firstBoat ? parseFloat(firstBoat.winRate) : null,
        first_boat_motor_2rate: firstBoat ? parseFloat(firstBoat.motor2Rate) : null,
        win_rate_avg: winRateAvg,
        win_rate_stddev: winRateStddev,
        motor_2rate_stddev: motor2RateStddev
    }
}

/**
 * 出走選手データの変換
 */
function transformEntries(race) {
    const entries = []

    // 新形式 (predictions.standard.players) または 旧形式 (prediction.players)
    const standardPlayers = race.predictions?.standard?.players || race.prediction?.players || []
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
            win_rate: parseFloat(player.winRate) || null,
            local_win_rate: parseFloat(player.localWinRate) || null,
            motor_number: player.motorNumber,
            motor_2rate: parseFloat(player.motor2Rate) || null,
            boat_number_id: player.boatNumber,
            boat_2rate: parseFloat(player.boat2Rate) || null,
            ai_score_standard: player.aiScore,
            ai_score_safe_bet: safeBetPlayer?.aiScore || null,
            ai_score_upset_focus: upsetPlayer?.aiScore || null
        })
    }

    return entries
}

/**
 * 予測データの変換
 */
function transformPredictions(race) {
    const predictions = []

    // 新形式: predictions.standard, predictions.safeBet, predictions.upsetFocus
    if (race.predictions) {
        const modelMapping = {
            'standard': 'standard',
            'safeBet': 'safeBet',
            'upsetFocus': 'upsetFocus'
        }

        for (const [key, modelId] of Object.entries(modelMapping)) {
            const pred = race.predictions[key]
            if (!pred) continue

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
                top_2nd: pred.top3?.[1] || null,
                top_3rd: pred.top3?.[2] || null,
                confidence: pred.confidence,
                scores: Object.keys(scores).length > 0 ? scores : null,
                is_shadow: false
            })
        }
    }
    // 旧形式: prediction (単一)
    else if (race.prediction) {
        const pred = race.prediction
        const scores = {}
        if (pred.players) {
            for (const player of pred.players) {
                scores[player.number] = player.aiScore
            }
        }

        predictions.push({
            race_id: race.raceId,
            model_id: 'standard',
            top_pick: pred.topPick,
            top_2nd: pred.top3?.[1] || null,
            top_3rd: pred.top3?.[2] || null,
            confidence: pred.confidence,
            scores: Object.keys(scores).length > 0 ? scores : null,
            is_shadow: false
        })
    }

    return predictions
}

/**
 * 結果データの変換
 */
function transformResult(race) {
    const result = race.result
    if (!result?.finished) return null

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
        result_at: result.updatedAt || null
    }
}

/**
 * 1日分のデータを移行
 */
async function migrateDay(dateStr) {
    const filePath = path.join(PREDICTIONS_DIR, `${dateStr}.json`)

    if (!fs.existsSync(filePath)) {
        console.log(`  Skip: ${dateStr} (file not found)`)
        return { skipped: true }
    }

    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    console.log(`  Processing: ${dateStr} (${data.races?.length || 0} races)`)

    const dayStats = { races: 0, entries: 0, predictions: 0, results: 0, errors: [] }

    for (const race of data.races || []) {
        try {
            // 1. races テーブル
            const raceData = transformRace(race, dateStr)
            if (!isDryRun) {
                const { error: raceError } = await supabase
                    .from('races')
                    .upsert(raceData, { onConflict: 'race_id' })
                if (raceError) throw new Error(`Race: ${raceError.message}`)
            }
            dayStats.races++

            // 2. race_entries テーブル
            const entriesData = transformEntries(race)
            if (entriesData.length > 0 && !isDryRun) {
                const { error: entriesError } = await supabase
                    .from('race_entries')
                    .upsert(entriesData, { onConflict: 'race_id,boat_number' })
                if (entriesError) throw new Error(`Entries: ${entriesError.message}`)
            }
            dayStats.entries += entriesData.length

            // 3. predictions テーブル
            const predictionsData = transformPredictions(race)
            for (const pred of predictionsData) {
                if (!isDryRun) {
                    const { error: predError } = await supabase
                        .from('predictions')
                        .upsert(pred, {
                            onConflict: 'race_id,model_id',
                            ignoreDuplicates: false
                        })
                    if (predError) throw new Error(`Prediction: ${predError.message}`)
                }
                dayStats.predictions++
            }

            // 4. race_results テーブル
            const resultData = transformResult(race)
            if (resultData && !isDryRun) {
                const { error: resultError } = await supabase
                    .from('race_results')
                    .upsert(resultData, { onConflict: 'race_id' })
                if (resultError) throw new Error(`Result: ${resultError.message}`)
                dayStats.results++
            } else if (resultData) {
                dayStats.results++
            }

        } catch (error) {
            dayStats.errors.push({
                race_id: race.raceId,
                error: error.message
            })
        }
    }

    return dayStats
}

/**
 * メイン処理
 */
async function main() {
    console.log('='.repeat(60))
    console.log('龍神レーダー Data Migration to Supabase')
    console.log('='.repeat(60))
    if (isDryRun) console.log('** DRY RUN MODE **\n')

    // 日次ファイル一覧を取得
    let files = fs.readdirSync(PREDICTIONS_DIR)
        .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()

    // 特定日のみの場合
    if (dateArg) {
        files = files.filter(f => f.startsWith(dateArg))
    }

    console.log(`Found ${files.length} daily files\n`)

    for (const file of files) {
        const dateStr = file.replace('.json', '')
        const result = await migrateDay(dateStr)

        if (!result.skipped) {
            stats.files++
            stats.races += result.races
            stats.entries += result.entries
            stats.predictions += result.predictions
            stats.results += result.results
            stats.errors.push(...result.errors)
        }

        // レート制限対策
        await new Promise(resolve => setTimeout(resolve, 100))
    }

    // 結果出力
    console.log('\n' + '='.repeat(60))
    console.log('Migration Complete')
    console.log('='.repeat(60))
    console.log(`Files processed: ${stats.files}`)
    console.log(`Races: ${stats.races}`)
    console.log(`Entries: ${stats.entries}`)
    console.log(`Predictions: ${stats.predictions}`)
    console.log(`Results: ${stats.results}`)
    console.log(`Errors: ${stats.errors.length}`)

    if (stats.errors.length > 0) {
        console.log('\nError details:')
        for (const error of stats.errors.slice(0, 10)) {
            console.log(`  - ${error.race_id}: ${error.error}`)
        }
        if (stats.errors.length > 10) {
            console.log(`  ... and ${stats.errors.length - 10} more`)
        }

        // エラーをファイルに保存
        fs.writeFileSync(
            path.join(__dirname, '../../data/migration-errors.json'),
            JSON.stringify(stats.errors, null, 2)
        )
    }

    // 検証用カウントを保存
    fs.writeFileSync(
        path.join(__dirname, '../../data/migration-stats.json'),
        JSON.stringify(stats, null, 2)
    )

    console.log('\nStats saved to migration-stats.json')
}

main().catch(console.error)
