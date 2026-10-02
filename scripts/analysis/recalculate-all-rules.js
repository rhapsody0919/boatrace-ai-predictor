/**
 * 全ルールの回収率を正しい配当で再計算
 *
 * 対象: 単勝(win), 複勝(place), 3連複(trio)
 */

import { createClient } from '@supabase/supabase-js';
import { fetchAll } from '../lib/supabaseClient.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase環境変数が未設定です');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 会場コードから会場名への変換
const VENUE_NAMES = {
  '01': '桐生', '02': '戸田', '03': '江戸川', '04': '平和島', '05': '多摩川', '06': '浜名湖',
  '07': '蒲郡', '08': '常滑', '09': '津', '10': '三国', '11': 'びわこ', '12': '住之江',
  '13': '尼崎', '14': '鳴門', '15': '丸亀', '16': '児島', '17': '宮島', '18': '徳山',
  '19': '下関', '20': '若松', '21': '芦屋', '22': '福岡', '23': '唐津', '24': '大村'
};

// ========================================
// ルール定義（ruleMatchService.jsからコピー）
// ========================================

// 蒲郡（07）
const GAMAGORI_RULES = [
  // 単勝
  { id: 'G07-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'G07-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(4) },
  { id: 'G07-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'G07-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'G07-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && raceNo >= 7 },
  { id: 'G07-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && pred.top3.includes(1) },
  // 3連複
  { id: 'G07-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 75 },
  { id: 'G07-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 7 },
  { id: 'G07-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
];

// 江戸川（03）
const EDOGAWA_RULES = [
  // 単勝
  { id: 'E03-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 70 && conf < 80 },
  { id: 'E03-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 1 && raceNo <= 4 },
  { id: 'E03-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3[1] === 1 && conf >= 70 },
  { id: 'E03-W004', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'E03-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 1 && raceNo <= 4 },
  { id: 'E03-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'E03-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && conf >= 75 },
  { id: 'E03-P004', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 80 },
  // 3連複
  { id: 'E03-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => predSorted === '1-2-4' },
  { id: 'E03-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => predSorted === '1-2-3' },
  { id: 'E03-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => raceNo >= 9 && predSorted === '1-2-4' },
  { id: 'E03-T004', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 },
  { id: 'E03-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 75 },
  { id: 'E03-T006', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) && pred.top3.includes(4) },
];

// 浜名湖（06）
const HAMANAKO_RULES = [
  // 単勝
  { id: 'H06-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'H06-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'H06-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'H06-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 75 },
  { id: 'H06-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && raceNo >= 7 },
  { id: 'H06-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  // 3連複
  { id: 'H06-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'H06-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'H06-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 三国（10）
const MIKUNI_RULES = [
  // 単勝
  { id: 'M10-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'M10-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'M10-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'M10-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 7 },
  { id: 'M10-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'M10-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  // 3連複
  { id: 'M10-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => !has1 && conf >= 80 },
  { id: 'M10-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) && conf >= 75 },
  { id: 'M10-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 7 && raceNo <= 9 },
];

// びわこ（11）
const BIWAKO_RULES = [
  // 単勝
  { id: 'B11-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'B11-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'B11-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'B11-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 7 },
  { id: 'B11-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'B11-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  { id: 'B11-P004', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 80 },
  // 3連複
  { id: 'B11-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'B11-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'B11-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 丸亀（15）
const MARUGAME_RULES = [
  // 複勝
  { id: 'R15-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'R15-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && raceNo >= 7 },
  { id: 'R15-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  // 単勝
  { id: 'R15-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 85 },
  { id: 'R15-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 3連複
  { id: 'R15-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'R15-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'R15-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => !has1 && conf >= 75 },
];

// 福岡（22）
const FUKUOKA_RULES = [
  // 単勝
  { id: 'F22-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'F22-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'F22-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  { id: 'F22-W004', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 4 && raceNo >= 10 },
  { id: 'F22-W005', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 1 && raceNo <= 4 },
  { id: 'F22-W006', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  // 複勝
  { id: 'F22-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 7 },
  { id: 'F22-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  // 3連複
  { id: 'F22-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'F22-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'F22-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 鳴門（14）
const NARUTO_RULES = [
  // 単勝
  { id: 'N14-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'N14-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'N14-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 4 && raceNo >= 10 },
  { id: 'N14-W004', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'N14-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 7 },
  { id: 'N14-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'N14-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  { id: 'N14-P004', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 80 },
  // 3連複
  { id: 'N14-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 && raceNo <= 12 },
  { id: 'N14-T009', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'N14-T015', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
];

// 児島（16）
const KOJIMA_RULES = [
  // 単勝
  { id: 'K16-W001', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 2 && conf >= 80 },
  { id: 'K16-W002', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 3 && pred.top3.includes(1) },
  { id: 'K16-W003', betType: 'win', check: (pred, raceNo, conf) => pred.topPick === 1 && conf >= 85 },
  // 複勝
  { id: 'K16-P001', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 2 && raceNo >= 7 },
  { id: 'K16-P002', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 3 && conf >= 75 },
  { id: 'K16-P003', betType: 'place', check: (pred, raceNo, conf) => pred.topPick === 4 && pred.top3.includes(1) },
  // 3連複
  { id: 'K16-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'K16-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
];

// 全会場のルールマップ
const VENUE_RULES = {
  '03': EDOGAWA_RULES,
  '06': HAMANAKO_RULES,
  '07': GAMAGORI_RULES,
  '10': MIKUNI_RULES,
  '11': BIWAKO_RULES,
  '14': NARUTO_RULES,
  '15': MARUGAME_RULES,
  '16': KOJIMA_RULES,
  '22': FUKUOKA_RULES,
};

// ========================================
// 再計算ロジック
// ========================================

async function fetchAllData(startDate) {
  console.log(`\n📥 データ取得中... (${startDate}以降)`);

  const allPredictions = await fetchAll(
    'predictions',
    '*',
    q => q.gte('predicted_at', startDate).eq('model_id', 'standard').order('prediction_id'),
    { client: supabase }
  );

  console.log(`  予測データ: ${allPredictions.length}件`);

  const raceIds = [...new Set(allPredictions.map(p => p.race_id))];
  const allResults = [];
  const batchSize = 500;

  for (let i = 0; i < raceIds.length; i += batchSize) {
    const batch = raceIds.slice(i, i + batchSize);
    const { data, error } = await supabase
      .from('race_results')
      .select('*')
      .in('race_id', batch);

    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    allResults.push(...data);
  }

  console.log(`  結果データ: ${allResults.length}件`);

  return { predictions: allPredictions, results: allResults };
}

function calculatePayout(rule, pred, result) {
  if (rule.betType === 'win') {
    const isHit = pred.topPick === result.rank1;
    return { isHit, payout: isHit ? (result.payout_win || 0) : 0 };
  } else if (rule.betType === 'place') {
    const isHit = pred.topPick === result.rank1 || pred.topPick === result.rank2;
    let payout = 0;
    if (isHit) {
      payout = pred.topPick === result.rank1
        ? (result.payout_place_1 || 0)
        : (result.payout_place_2 || 0);
    }
    return { isHit, payout };
  } else if (rule.betType === 'trio') {
    const predSorted = [...pred.top3].sort((a, b) => a - b).join('-');
    const resultSorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b).join('-');
    const isHit = predSorted === resultSorted;
    // 正しい配当: payout_trifecta（3連複）
    return { isHit, payout: isHit ? (result.payout_trifecta || 0) : 0 };
  }
  return { isHit: false, payout: 0 };
}

async function recalculateAllRules() {
  console.log('='.repeat(80));
  console.log('📊 全ルール回収率再計算（単勝・複勝・3連複）');
  console.log('='.repeat(80));

  const startDate = '2026-01-01';
  const { predictions, results } = await fetchAllData(startDate);

  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  const allRulesResults = [];

  for (const [venueCode, rules] of Object.entries(VENUE_RULES)) {
    const venueName = VENUE_NAMES[venueCode] || venueCode;

    for (const rule of rules) {
      const stats = { samples: 0, hits: 0, totalPayout: 0 };

      for (const pred of predictions) {
        const predVenueCode = pred.race_id.split('-')[3];
        if (predVenueCode !== venueCode) continue;

        const raceNo = parseInt(pred.race_id.split('-')[4]);
        const result = resultsMap.get(pred.race_id);
        if (!result || !result.rank1) continue;

        const prediction = {
          topPick: pred.top_pick,
          top3: [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(Boolean)
        };

        if (prediction.top3.length !== 3) continue;

        const conf = pred.confidence || 0;
        const predSorted = [...prediction.top3].sort((a, b) => a - b).join('-');
        const has1 = prediction.top3.includes(1);

        try {
          const matches = rule.check(prediction, raceNo, conf, predSorted, has1);
          if (!matches) continue;

          stats.samples++;
          const { isHit, payout } = calculatePayout(rule, prediction, result);
          if (isHit) {
            stats.hits++;
            stats.totalPayout += payout;
          }
        } catch (e) {
          // エラー無視
        }
      }

      if (stats.samples > 0) {
        const investment = stats.samples * 100;
        const recovery = (stats.totalPayout / investment * 100);
        const hitRate = (stats.hits / stats.samples * 100);

        allRulesResults.push({
          venueCode,
          venueName,
          ruleId: rule.id,
          betType: rule.betType,
          samples: stats.samples,
          hits: stats.hits,
          hitRate: parseFloat(hitRate.toFixed(1)),
          recovery: parseFloat(recovery.toFixed(1)),
          isValid: recovery >= 100
        });
      }
    }
  }

  // ベットタイプ別にソート・出力
  const betTypes = ['win', 'place', 'trio'];
  const betTypeNames = { win: '単勝', place: '複勝', trio: '3連複' };

  for (const betType of betTypes) {
    const rules = allRulesResults.filter(r => r.betType === betType);
    const validRules = rules.filter(r => r.isValid).sort((a, b) => b.recovery - a.recovery);
    const invalidRules = rules.filter(r => !r.isValid).sort((a, b) => b.recovery - a.recovery);

    console.log('\n' + '='.repeat(80));
    console.log(`📊 ${betTypeNames[betType]}ルール`);
    console.log('='.repeat(80));

    console.log(`\n✅ 有効なルール（回収率100%以上）: ${validRules.length}件`);
    console.log('-'.repeat(70));
    if (validRules.length > 0) {
      console.log('ルールID        | 会場     | サンプル | 的中率  | 回収率');
      console.log('-'.repeat(70));
      for (const r of validRules) {
        console.log(
          `${r.ruleId.padEnd(15)} | ${r.venueName.padEnd(8)} | ${String(r.samples).padStart(8)} | ${r.hitRate.toFixed(1).padStart(6)}% | ${r.recovery.toFixed(1).padStart(6)}%`
        );
      }
    } else {
      console.log('  なし');
    }

    console.log(`\n❌ 無効なルール（回収率100%未満）: ${invalidRules.length}件`);
    console.log('-'.repeat(70));
    if (invalidRules.length > 0) {
      console.log('ルールID        | 会場     | サンプル | 的中率  | 回収率');
      console.log('-'.repeat(70));
      for (const r of invalidRules) {
        console.log(
          `${r.ruleId.padEnd(15)} | ${r.venueName.padEnd(8)} | ${String(r.samples).padStart(8)} | ${r.hitRate.toFixed(1).padStart(6)}% | ${r.recovery.toFixed(1).padStart(6)}%`
        );
      }
    } else {
      console.log('  なし');
    }
  }

  // サマリー
  console.log('\n' + '='.repeat(80));
  console.log('📊 総合サマリー');
  console.log('='.repeat(80));

  for (const betType of betTypes) {
    const rules = allRulesResults.filter(r => r.betType === betType);
    const valid = rules.filter(r => r.isValid).length;
    const invalid = rules.filter(r => !r.isValid).length;
    console.log(`${betTypeNames[betType]}: 有効 ${valid}件 / 無効 ${invalid}件`);
  }

  const totalValid = allRulesResults.filter(r => r.isValid).length;
  const totalInvalid = allRulesResults.filter(r => !r.isValid).length;
  console.log(`\n合計: 有効 ${totalValid}件 / 無効 ${totalInvalid}件`);

  // JSON出力
  const outputPath = './data/analysis/all-rules-recalculation.json';
  await fs.writeFile(outputPath, JSON.stringify({
    calculatedAt: new Date().toISOString(),
    startDate,
    summary: {
      win: { valid: allRulesResults.filter(r => r.betType === 'win' && r.isValid).length, invalid: allRulesResults.filter(r => r.betType === 'win' && !r.isValid).length },
      place: { valid: allRulesResults.filter(r => r.betType === 'place' && r.isValid).length, invalid: allRulesResults.filter(r => r.betType === 'place' && !r.isValid).length },
      trio: { valid: allRulesResults.filter(r => r.betType === 'trio' && r.isValid).length, invalid: allRulesResults.filter(r => r.betType === 'trio' && !r.isValid).length },
    },
    validRules: allRulesResults.filter(r => r.isValid).sort((a, b) => b.recovery - a.recovery),
    invalidRules: allRulesResults.filter(r => !r.isValid).sort((a, b) => b.recovery - a.recovery),
  }, null, 2));

  console.log(`\n📁 結果を保存: ${outputPath}`);

  return allRulesResults;
}

// 実行
recalculateAllRules()
  .then(results => {
    const valid = results.filter(r => r.isValid).length;
    const invalid = results.filter(r => !r.isValid).length;
    console.log(`\n✅ 再計算完了: 有効 ${valid}件 / 無効 ${invalid}件`);
    process.exit(0);
  })
  .catch(err => {
    console.error('エラー:', err);
    process.exit(1);
  });
