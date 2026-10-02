/**
 * 3連複ルールの回収率を正しい配当(payout_trifecta)で再計算
 *
 * 問題: betType='trio'のルールで誤ってpayout_trio(3連単)を使用していた
 * 修正: payout_trifecta(3連複)で再計算し、正しい回収率を算出
 */

import { createClient } from '@supabase/supabase-js';
import { fetchAll } from '../lib/supabaseClient.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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
  { id: 'G07-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 75 },
  { id: 'G07-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 7 },
  { id: 'G07-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
];

// 江戸川（03）
const EDOGAWA_RULES = [
  { id: 'E03-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => predSorted === '1-2-4' },
  { id: 'E03-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => predSorted === '1-2-3' },
  { id: 'E03-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => raceNo >= 9 && predSorted === '1-2-4' },
  { id: 'E03-T004', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 },
  { id: 'E03-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 75 },
  { id: 'E03-T006', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) && pred.top3.includes(4) },
];

// 浜名湖（06）
const HAMANAKO_RULES = [
  { id: 'H06-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'H06-T002', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'H06-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 三国（10）
const MIKUNI_RULES = [
  { id: 'M10-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => !has1 && conf >= 80 },
  { id: 'M10-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) && conf >= 75 },
  { id: 'M10-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 7 && raceNo <= 9 },
];

// びわこ（11）
const BIWAKO_RULES = [
  { id: 'B11-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'B11-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'B11-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 丸亀（15）
const MARUGAME_RULES = [
  { id: 'R15-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'R15-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'R15-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => !has1 && conf >= 75 },
];

// 福岡（22）
const FUKUOKA_RULES = [
  { id: 'F22-T001', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
  { id: 'F22-T003', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'F22-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 },
];

// 鳴門（14）
const NARUTO_RULES = [
  { id: 'N14-T005', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && raceNo >= 10 && raceNo <= 12 },
  { id: 'N14-T009', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && pred.top3.includes(2) },
  { id: 'N14-T015', betType: 'trio', check: (pred, raceNo, conf, predSorted, has1) => has1 && conf >= 80 },
];

// 児島（16）
const KOJIMA_RULES = [
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

  // 予測データ取得
  const allPredictions = await fetchAll(
    'predictions',
    '*',
    q => q.gte('predicted_at', startDate).eq('model_id', 'standard').order('prediction_id'),
    { client: supabase }
  );

  console.log(`  予測データ: ${allPredictions.length}件`);

  // 結果データ取得
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

async function recalculateAllRules() {
  console.log('='.repeat(80));
  console.log('📊 3連複ルール回収率再計算');
  console.log('   payout_trifecta（3連複の配当）を使用して正しい回収率を算出');
  console.log('='.repeat(80));

  const startDate = '2026-01-01';
  const { predictions, results } = await fetchAllData(startDate);

  // 結果をマップ化
  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  // 会場別・ルール別の統計を計算
  const venueStats = {};

  for (const [venueCode, rules] of Object.entries(VENUE_RULES)) {
    const venueName = VENUE_NAMES[venueCode] || venueCode;
    venueStats[venueCode] = {
      venueName,
      rules: {}
    };

    // この会場のルール初期化
    for (const rule of rules) {
      if (rule.betType === 'trio') {
        venueStats[venueCode].rules[rule.id] = {
          samples: 0,
          hits: 0,
          totalPayout_correct: 0,   // payout_trifecta（正しい3連複）
          totalPayout_wrong: 0,     // payout_trio（間違い：3連単）
        };
      }
    }
  }

  // 予測データをループして統計を計算
  for (const pred of predictions) {
    const venueCode = pred.race_id.split('-')[3];
    const raceNo = parseInt(pred.race_id.split('-')[4]);
    const rules = VENUE_RULES[venueCode];

    if (!rules) continue;

    const result = resultsMap.get(pred.race_id);
    if (!result || !result.rank1) continue;

    const prediction = {
      topPick: pred.top_pick,
      top3: [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(Boolean)
    };

    if (prediction.top3.length !== 3) continue;

    const conf = pred.confidence || 0;
    const predSorted = [...prediction.top3].sort((a, b) => a - b).join('-');
    const resultSorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b).join('-');
    const has1 = prediction.top3.includes(1);
    const isHit = predSorted === resultSorted;

    for (const rule of rules) {
      if (rule.betType !== 'trio') continue;

      try {
        const matches = rule.check(prediction, raceNo, conf, predSorted, has1);
        if (!matches) continue;

        const stats = venueStats[venueCode].rules[rule.id];
        stats.samples++;

        if (isHit) {
          stats.hits++;
          stats.totalPayout_correct += result.payout_trifecta || 0;
          stats.totalPayout_wrong += result.payout_trio || 0;
        }
      } catch (e) {
        // ルールチェック中のエラーは無視
      }
    }
  }

  // 結果を出力
  console.log('\n' + '='.repeat(80));
  console.log('📊 再計算結果');
  console.log('='.repeat(80));

  const allRulesResults = [];

  for (const [venueCode, data] of Object.entries(venueStats)) {
    const { venueName, rules } = data;
    const rulesWithData = Object.entries(rules).filter(([_, s]) => s.samples > 0);

    if (rulesWithData.length === 0) continue;

    console.log(`\n🏟️  ${venueName}（${venueCode}）`);
    console.log('-'.repeat(70));
    console.log('ルールID        | サンプル | 的中 | 的中率  | 正しい回収率 | 誤った回収率 | 差分');
    console.log('-'.repeat(70));

    for (const [ruleId, stats] of rulesWithData) {
      const hitRate = (stats.hits / stats.samples * 100).toFixed(1);
      const investment = stats.samples * 100;
      const recoveryCorrect = (stats.totalPayout_correct / investment * 100).toFixed(1);
      const recoveryWrong = (stats.totalPayout_wrong / investment * 100).toFixed(1);
      const diff = (parseFloat(recoveryWrong) - parseFloat(recoveryCorrect)).toFixed(1);

      const status = parseFloat(recoveryCorrect) >= 100 ? '✅' : '❌';

      console.log(
        `${ruleId.padEnd(15)} | ${String(stats.samples).padStart(8)} | ${String(stats.hits).padStart(4)} | ${hitRate.padStart(6)}% | ${recoveryCorrect.padStart(11)}% | ${recoveryWrong.padStart(11)}% | ${diff.padStart(6)}% ${status}`
      );

      allRulesResults.push({
        venueCode,
        venueName,
        ruleId,
        samples: stats.samples,
        hits: stats.hits,
        hitRate: parseFloat(hitRate),
        recoveryCorrect: parseFloat(recoveryCorrect),
        recoveryWrong: parseFloat(recoveryWrong),
        diff: parseFloat(diff),
        isValid: parseFloat(recoveryCorrect) >= 100
      });
    }
  }

  // サマリー
  console.log('\n' + '='.repeat(80));
  console.log('📊 サマリー');
  console.log('='.repeat(80));

  const validRules = allRulesResults.filter(r => r.isValid);
  const invalidRules = allRulesResults.filter(r => !r.isValid);

  console.log(`\n有効なルール（回収率100%以上）: ${validRules.length}件`);
  for (const r of validRules.sort((a, b) => b.recoveryCorrect - a.recoveryCorrect)) {
    console.log(`  ${r.ruleId}: ${r.recoveryCorrect}% (${r.samples}サンプル, ${r.hitRate}%的中)`);
  }

  console.log(`\n無効なルール（回収率100%未満）: ${invalidRules.length}件`);
  for (const r of invalidRules.sort((a, b) => b.recoveryCorrect - a.recoveryCorrect)) {
    console.log(`  ${r.ruleId}: ${r.recoveryCorrect}% (${r.samples}サンプル) ← 削除検討`);
  }

  // JSON出力
  const outputPath = './data/analysis/trio-rules-recalculation.json';
  const fs = await import('fs/promises');
  await fs.writeFile(outputPath, JSON.stringify({
    calculatedAt: new Date().toISOString(),
    startDate,
    totalRules: allRulesResults.length,
    validRules: validRules.length,
    invalidRules: invalidRules.length,
    results: allRulesResults
  }, null, 2));

  console.log(`\n📁 結果を保存: ${outputPath}`);

  return { validRules, invalidRules };
}

// 実行
recalculateAllRules()
  .then(({ validRules, invalidRules }) => {
    console.log('\n✅ 再計算完了');
    console.log(`   有効: ${validRules.length}件, 無効: ${invalidRules.length}件`);
    process.exit(0);
  })
  .catch(err => {
    console.error('エラー:', err);
    process.exit(1);
  });
