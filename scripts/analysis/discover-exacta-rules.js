/**
 * 3連単ルール発掘スクリプト
 *
 * 全会場で3連単（順序通り）の回収率100%超えルールを探索する
 * payout_trio（3連単配当）を使用
 */

import { createClient } from '@supabase/supabase-js';
import { fetchAll } from '../lib/supabaseClient.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Supabase環境変数が未設定です');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 会場名マッピング
const VENUE_NAMES = {
  '01': '桐生', '02': '戸田', '03': '江戸川', '04': '平和島', '05': '多摩川', '06': '浜名湖',
  '07': '蒲郡', '08': '常滑', '09': '津', '10': '三国', '11': 'びわこ', '12': '住之江',
  '13': '尼崎', '14': '鳴門', '15': '丸亀', '16': '児島', '17': '宮島', '18': '徳山',
  '19': '下関', '20': '若松', '21': '芦屋', '22': '福岡', '23': '唐津', '24': '大村'
};

// ルールIDプレフィックス
const VENUE_PREFIX = {
  '01': 'KR01', '02': 'TD02', '03': 'E03', '04': 'HW04', '05': 'TM05', '06': 'H06',
  '07': 'G07', '08': 'TK08', '09': 'TS09', '10': 'M10', '11': 'B11', '12': 'SM12',
  '13': 'AM13', '14': 'N14', '15': 'R15', '16': 'K16', '17': 'MY17', '18': 'TY18',
  '19': 'SG19', '20': 'WK20', '21': 'AS21', '22': 'F22', '23': 'KR23', '24': 'OM24'
};

async function main() {
  console.log('================================================================================');
  console.log('📊 3連単ルール発掘（全会場）');
  console.log('   payout_trio（3連単配当）を使用、順序通りの的中判定');
  console.log('================================================================================\n');

  // データ取得（ページネーション）
  console.log('📥 データ取得中... (2026-01-01以降)');

  const allPredictions = await fetchAll(
    'predictions',
    'race_id, top_pick, top_2nd, top_3rd, confidence',
    q => q.gte('predicted_at', '2026-01-01').eq('model_id', 'standard').order('race_id').order('model_id'),
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
      .select('race_id, rank1, rank2, rank3, payout_trio')
      .in('race_id', batch);

    if (error) throw new Error(`race_results取得エラー: ${error.message}`);
    allResults.push(...data);
  }

  console.log(`  結果データ: ${allResults.length}件\n`);

  const predictions = allPredictions;
  const results = allResults;

  // 結果をマップ化
  const resultMap = new Map();
  for (const r of results) {
    resultMap.set(r.race_id, r);
  }

  // 会場ごとにデータを整理
  const venueData = {};

  for (const pred of predictions) {
    const result = resultMap.get(pred.race_id);
    if (!result || !result.payout_trio || !result.rank1) continue;

    // race_idから会場コードとレース番号を抽出
    // race_id形式: YYYYMMDD-XX-XX-03-01 (最後から2番目が会場コード、最後がレース番号)
    const parts = pred.race_id.split('-');
    const venueCode = parts[3];
    const raceNo = parseInt(parts[4]);

    if (!venueData[venueCode]) {
      venueData[venueCode] = [];
    }

    // top_3を構築
    const top3 = [pred.top_pick, pred.top_2nd, pred.top_3rd].filter(Boolean);
    if (top3.length !== 3) continue;

    // 予測と結果を文字列化（順序維持）
    const predExact = top3.join('-');
    const resultExact = `${result.rank1}-${result.rank2}-${result.rank3}`;

    // 予測をソート（3連複判定用）
    const predSorted = [...top3].sort((a, b) => a - b).join('-');
    const resultSorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b).join('-');

    // 1号艇を含むか
    const has1 = top3.includes(1);

    // top_pickの位置
    const topPick = top3[0];

    venueData[venueCode].push({
      raceId: pred.race_id,
      raceNo,
      confidence: pred.confidence || 0,
      predExact,
      resultExact,
      predSorted,
      resultSorted,
      has1,
      topPick,
      top3,
      payout: result.payout_trio,
      isExactHit: predExact === resultExact,       // 3連単的中
      isTrifectaHit: predSorted === resultSorted   // 3連複的中
    });
  }

  // 各会場で条件を探索
  const allRules = [];
  const MIN_SAMPLES = 20;
  const MIN_RECOVERY = 100;

  console.log('================================================================================');
  console.log('📊 会場別3連単ルール探索');
  console.log('================================================================================\n');

  for (const [venueCode, data] of Object.entries(venueData).sort()) {
    const venueName = VENUE_NAMES[venueCode] || venueCode;
    const prefix = VENUE_PREFIX[venueCode] || `V${venueCode}`;

    if (data.length < MIN_SAMPLES) continue;

    console.log(`\n🏟️  ${venueName}（${venueCode}）- ${data.length}レース`);
    console.log('----------------------------------------------------------------------');

    const venueRules = [];

    // 条件1: confidence帯別
    const confBands = [
      { name: 'conf90+', min: 90, max: 100 },
      { name: 'conf85+', min: 85, max: 100 },
      { name: 'conf80+', min: 80, max: 100 },
      { name: 'conf75-85', min: 75, max: 85 },
      { name: 'conf70-80', min: 70, max: 80 },
    ];

    for (const band of confBands) {
      const filtered = data.filter(d => d.confidence >= band.min && d.confidence < band.max);
      const stats = calculateStats(filtered, 'isExactHit');
      if (stats.samples >= MIN_SAMPLES && stats.recovery >= MIN_RECOVERY) {
        venueRules.push({
          id: `${prefix}-EX-C${band.min}`,
          condition: `confidence ${band.min}%以上`,
          ...stats
        });
      }
    }

    // 条件2: 1号艇含む/含まない × confidence
    for (const has1 of [true, false]) {
      const label = has1 ? '1号艇含む' : '1号艇含まず';
      for (const minConf of [90, 85, 80, 75, 70]) {
        const filtered = data.filter(d => d.has1 === has1 && d.confidence >= minConf);
        const stats = calculateStats(filtered, 'isExactHit');
        if (stats.samples >= MIN_SAMPLES && stats.recovery >= MIN_RECOVERY) {
          venueRules.push({
            id: `${prefix}-EX-${has1 ? 'H1' : 'N1'}-C${minConf}`,
            condition: `${label} × conf${minConf}+`,
            ...stats
          });
        }
      }
    }

    // 条件3: top_pick別（1着予想が何号艇か）
    for (const topPick of [1, 2, 3, 4, 5, 6]) {
      const filtered = data.filter(d => d.topPick === topPick);
      const stats = calculateStats(filtered, 'isExactHit');
      if (stats.samples >= MIN_SAMPLES && stats.recovery >= MIN_RECOVERY) {
        venueRules.push({
          id: `${prefix}-EX-TP${topPick}`,
          condition: `1着予想=${topPick}号艇`,
          ...stats
        });
      }

      // top_pick × confidence
      for (const minConf of [85, 80, 75]) {
        const filtered2 = data.filter(d => d.topPick === topPick && d.confidence >= minConf);
        const stats2 = calculateStats(filtered2, 'isExactHit');
        if (stats2.samples >= MIN_SAMPLES && stats2.recovery >= MIN_RECOVERY) {
          venueRules.push({
            id: `${prefix}-EX-TP${topPick}-C${minConf}`,
            condition: `1着予想=${topPick}号艇 × conf${minConf}+`,
            ...stats2
          });
        }
      }
    }

    // 条件4: レース番号帯
    const raceNoBands = [
      { name: '前半', min: 1, max: 6 },
      { name: '後半', min: 7, max: 12 },
      { name: '終盤', min: 10, max: 12 },
    ];

    for (const band of raceNoBands) {
      const filtered = data.filter(d => d.raceNo >= band.min && d.raceNo <= band.max);
      const stats = calculateStats(filtered, 'isExactHit');
      if (stats.samples >= MIN_SAMPLES && stats.recovery >= MIN_RECOVERY) {
        venueRules.push({
          id: `${prefix}-EX-R${band.min}${band.max}`,
          condition: `${band.name}レース(${band.min}-${band.max}R)`,
          ...stats
        });
      }

      // レース番号 × confidence
      for (const minConf of [85, 80]) {
        const filtered2 = data.filter(d =>
          d.raceNo >= band.min && d.raceNo <= band.max && d.confidence >= minConf
        );
        const stats2 = calculateStats(filtered2, 'isExactHit');
        if (stats2.samples >= MIN_SAMPLES && stats2.recovery >= MIN_RECOVERY) {
          venueRules.push({
            id: `${prefix}-EX-R${band.min}${band.max}-C${minConf}`,
            condition: `${band.name}(${band.min}-${band.max}R) × conf${minConf}+`,
            ...stats2
          });
        }
      }
    }

    // 条件5: 特定の艇番組み合わせ（top3）
    const popularCombos = ['1-2-3', '1-2-4', '1-3-2', '1-3-4', '1-4-2', '1-4-3', '2-1-3', '2-1-4', '2-3-1'];
    for (const combo of popularCombos) {
      const filtered = data.filter(d => d.predExact === combo);
      const stats = calculateStats(filtered, 'isExactHit');
      if (stats.samples >= MIN_SAMPLES && stats.recovery >= MIN_RECOVERY) {
        venueRules.push({
          id: `${prefix}-EX-${combo.replace(/-/g, '')}`,
          condition: `予想=${combo}`,
          ...stats
        });
      }
    }

    // 重複排除（同じ条件で回収率が高い方を残す）
    const uniqueRules = [];
    const seenConditions = new Set();

    // 回収率でソート
    venueRules.sort((a, b) => b.recovery - a.recovery);

    for (const rule of venueRules) {
      if (!seenConditions.has(rule.condition)) {
        seenConditions.add(rule.condition);
        uniqueRules.push(rule);
      }
    }

    if (uniqueRules.length > 0) {
      console.log('ルールID        | 条件                     | サンプル | 的中率  | 回収率');
      console.log('----------------------------------------------------------------------');
      for (const rule of uniqueRules.slice(0, 10)) { // 上位10件
        console.log(
          `${rule.id.padEnd(15)} | ${rule.condition.padEnd(24)} | ${String(rule.samples).padStart(6)} | ${(rule.hitRate * 100).toFixed(1).padStart(5)}% | ${rule.recovery.toFixed(1).padStart(6)}%`
        );
      }
      allRules.push(...uniqueRules);
    } else {
      console.log('有効なルールなし');
    }
  }

  // サマリー
  console.log('\n================================================================================');
  console.log('📊 3連単ルール発掘結果サマリー');
  console.log('================================================================================\n');

  // 回収率でソート
  allRules.sort((a, b) => b.recovery - a.recovery);

  console.log(`発見したルール: ${allRules.length}件\n`);

  if (allRules.length > 0) {
    console.log('🏆 回収率TOP20');
    console.log('----------------------------------------------------------------------');
    console.log('ルールID        | 条件                     | サンプル | 的中率  | 回収率');
    console.log('----------------------------------------------------------------------');
    for (const rule of allRules.slice(0, 20)) {
      console.log(
        `${rule.id.padEnd(15)} | ${rule.condition.padEnd(24)} | ${String(rule.samples).padStart(6)} | ${(rule.hitRate * 100).toFixed(1).padStart(5)}% | ${rule.recovery.toFixed(1).padStart(6)}%`
      );
    }
  }

  // 会場別集計
  const byVenue = {};
  for (const rule of allRules) {
    const venueCode = rule.id.match(/\d{2}/)?.[0] || 'unknown';
    if (!byVenue[venueCode]) byVenue[venueCode] = [];
    byVenue[venueCode].push(rule);
  }

  console.log('\n📍 会場別ルール数');
  console.log('----------------------------------------------------------------------');
  for (const [code, rules] of Object.entries(byVenue).sort()) {
    const venueName = VENUE_NAMES[code] || code;
    console.log(`${venueName}（${code}）: ${rules.length}件`);
  }

  // 結果をJSONに保存
  const output = {
    analysisDate: new Date().toISOString(),
    betType: 'exacta',
    description: '3連単（順序通り）- payout_trio使用',
    totalRules: allRules.length,
    rules: allRules,
    byVenue
  };

  const outputPath = './data/analysis/exacta-rules-discovery.json';
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n📁 結果を保存: ${outputPath}`);

  console.log(`\n✅ 3連単ルール発掘完了: ${allRules.length}件`);
}

function calculateStats(data, hitField) {
  if (data.length === 0) {
    return { samples: 0, hits: 0, hitRate: 0, recovery: 0 };
  }

  const hits = data.filter(d => d[hitField]).length;
  const totalPayout = data.reduce((sum, d) => sum + (d[hitField] ? d.payout : 0), 0);
  const totalBet = data.length * 100; // 1レース100円

  return {
    samples: data.length,
    hits,
    hitRate: hits / data.length,
    recovery: (totalPayout / totalBet) * 100
  };
}

main().catch(console.error);
