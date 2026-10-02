/**
 * 全モデル分析スクリプト
 *
 * スタンダード・本命・穴狙いの3モデルで
 * 江戸川の高回収率パターンを分析する
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

const MODELS = ['standard', 'safeBet', 'upsetFocus'];
const MODEL_NAMES = {
  'standard': 'スタンダード',
  'safeBet': '本命',
  'upsetFocus': '穴狙い'
};

// 江戸川の会場コード
const VENUE_CODE = '03';

async function analyzeModel(modelId) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 ${MODEL_NAMES[modelId]}モデル (${modelId}) の分析`);
  console.log('='.repeat(60));

  // 予測データを取得（江戸川のみ、全期間）
  // race_idの形式: YYYY-MM-DD-XX-RR (XXが会場コード)
  const { data: edogawaPreds, error: predError } = await supabase
    .from('predictions')
    .select('*')
    .eq('model_id', modelId)
    .like('race_id', `%-${VENUE_CODE}-%`)
    .range(0, 5000);

  if (predError) {
    throw new Error(`予測取得エラー: ${predError.message}`);
  }

  console.log(`江戸川予測数: ${edogawaPreds?.length || 0}件`);

  if (edogawaPreds.length === 0) {
    console.log('データなし');
    return null;
  }

  // 分析用データ構築（predictionsテーブルに既に結果が入っている）
  const analysisData = edogawaPreds.map(pred => {
    const parts = pred.race_id.split('-');
    const raceNo = parseInt(parts[4]);

    const top3 = [pred.top_pick, pred.top_2nd, pred.top_3rd];
    const predSorted = [...top3].sort((a, b) => a - b).join('-');
    const has1 = top3.includes(1);

    // 結果は既にpredictionsテーブルに記録されている
    const hasResult = pred.is_hit_trio !== null;

    return {
      raceId: pred.race_id,
      raceNo,
      confidence: pred.confidence || 0,
      topPick: pred.top_pick,
      top2nd: pred.top_2nd,
      top3,
      predSorted,
      has1,
      hasResult,
      trioHit: pred.is_hit_trio || false,
      winHit: pred.is_hit_win || false,
      placeHit: pred.is_hit_place || false,
      trioPayout: pred.payout_trio || 0,
      winPayout: pred.payout_win || 0,
      placePayout: pred.payout_place || 0
    };
  }).filter(d => d.hasResult);

  console.log(`結果確定レース: ${analysisData.length}件`);

  if (analysisData.length === 0) {
    console.log('結果確定データなし');
    return [];
  }

  // パターン分析
  const patterns = [];

  // 3連複パターン
  const trioPatterns = [
    { name: '1-2-3×後半×conf80+', filter: d => d.predSorted === '1-2-3' && d.raceNo >= 9 && d.confidence >= 80 },
    { name: '1-2-4×後半×conf80+', filter: d => d.predSorted === '1-2-4' && d.raceNo >= 9 && d.confidence >= 80 },
    { name: '1-2-3or124×後半×conf80+', filter: d => ['1-2-3', '1-2-4'].includes(d.predSorted) && d.raceNo >= 9 && d.confidence >= 80 },
    { name: '1号艇含む×5R以降×conf85+', filter: d => d.has1 && d.raceNo >= 5 && d.confidence >= 85 },
    { name: '1号艇含む×conf90+', filter: d => d.has1 && d.confidence >= 90 },
    { name: '1号艇含む×後半×conf85+', filter: d => d.has1 && d.raceNo >= 9 && d.confidence >= 85 },
    { name: '全レース×conf90+', filter: d => d.confidence >= 90 },
    { name: '全レース×conf85+', filter: d => d.confidence >= 85 },
    { name: '全レース×conf80+', filter: d => d.confidence >= 80 },
  ];

  for (const pattern of trioPatterns) {
    const matched = analysisData.filter(pattern.filter);
    if (matched.length >= 5) {
      const hits = matched.filter(d => d.trioHit).length;
      const totalPayout = matched.reduce((sum, d) => sum + d.trioPayout, 0);
      const totalBet = matched.length * 100;
      const recovery = Math.round((totalPayout / totalBet) * 100);

      if (recovery >= 100) {
        patterns.push({
          type: '3連複',
          name: pattern.name,
          samples: matched.length,
          hits,
          recovery
        });
      }
    }
  }

  // 単勝パターン
  const winPatterns = [
    { name: '1号艇1着×後半', filter: d => d.topPick === 1 && d.raceNo >= 9 },
    { name: '1号艇1着×conf80+', filter: d => d.topPick === 1 && d.confidence >= 80 },
    { name: '2号艇1着×前半', filter: d => d.topPick === 2 && d.raceNo <= 4 },
    { name: '2号艇1着×conf75+', filter: d => d.topPick === 2 && d.confidence >= 75 },
    { name: '3号艇1着×conf70+', filter: d => d.topPick === 3 && d.confidence >= 70 },
    { name: '3号艇1着+1号艇2着×conf70+', filter: d => d.topPick === 3 && d.top2nd === 1 && d.confidence >= 70 },
  ];

  for (const pattern of winPatterns) {
    const matched = analysisData.filter(pattern.filter);
    if (matched.length >= 5) {
      const hits = matched.filter(d => d.winHit).length;
      const totalPayout = matched.reduce((sum, d) => sum + d.winPayout, 0);
      const totalBet = matched.length * 100;
      const recovery = Math.round((totalPayout / totalBet) * 100);

      if (recovery >= 100) {
        patterns.push({
          type: '単勝',
          name: pattern.name,
          samples: matched.length,
          hits,
          recovery
        });
      }
    }
  }

  // 複勝パターン
  const placePatterns = [
    { name: '1号艇×後半', filter: d => d.topPick === 1 && d.raceNo >= 9 },
    { name: '1号艇×conf85+', filter: d => d.topPick === 1 && d.confidence >= 85 },
    { name: '2号艇×前半', filter: d => d.topPick === 2 && d.raceNo <= 4 },
    { name: '2号艇×conf80+', filter: d => d.topPick === 2 && d.confidence >= 80 },
  ];

  for (const pattern of placePatterns) {
    const matched = analysisData.filter(pattern.filter);
    if (matched.length >= 5) {
      const hits = matched.filter(d => d.placeHit).length;
      const totalPayout = matched.reduce((sum, d) => sum + d.placePayout, 0);
      const totalBet = matched.length * 100;
      const recovery = Math.round((totalPayout / totalBet) * 100);

      if (recovery >= 100) {
        patterns.push({
          type: '複勝',
          name: pattern.name,
          samples: matched.length,
          hits,
          recovery
        });
      }
    }
  }

  // 結果表示
  if (patterns.length === 0) {
    console.log('\n回収率100%以上のパターンは見つかりませんでした');
  } else {
    console.log(`\n🎯 発見されたパターン (回収率100%以上):`);
    patterns.sort((a, b) => b.recovery - a.recovery);

    for (const p of patterns) {
      const hitRate = ((p.hits / p.samples) * 100).toFixed(1);
      console.log(`  [${p.type}] ${p.name}`);
      console.log(`    → ${p.samples}戦${p.hits}勝 (的中率${hitRate}%) 回収率${p.recovery}%`);
    }
  }

  return patterns;
}

async function main() {
  console.log('🔍 全モデル分析開始 - 江戸川');
  console.log('分析期間: 全期間');

  const allResults = {};

  for (const modelId of MODELS) {
    const patterns = await analyzeModel(modelId);
    allResults[modelId] = patterns || [];
  }

  // サマリー
  console.log('\n' + '='.repeat(60));
  console.log('📋 サマリー');
  console.log('='.repeat(60));

  for (const modelId of MODELS) {
    const patterns = allResults[modelId];
    console.log(`\n${MODEL_NAMES[modelId]}: ${patterns.length}パターン発見`);

    if (patterns.length > 0) {
      const top3 = patterns.slice(0, 3);
      for (const p of top3) {
        console.log(`  - [${p.type}] ${p.name} → 回収率${p.recovery}%`);
      }
    }
  }

  // JSONで出力
  const outputPath = './data/all-models-analysis.json';
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(allResults, null, 2));
  console.log(`\n結果を ${outputPath} に保存しました`);
}

main().catch(console.error);
