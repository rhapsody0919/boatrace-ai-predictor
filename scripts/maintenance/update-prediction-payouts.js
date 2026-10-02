import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { fetchAll } from '../lib/supabaseClient.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function updatePayouts() {
  console.log('Fetching predictions...');
  const predictions = await fetchAll('predictions', 'prediction_id, race_id, top_pick, is_hit_win, is_hit_place, is_hit_trifecta, is_hit_trio', q => q.order('prediction_id'), { client: supabase });
  console.log('  Total predictions:', predictions.length);

  console.log('Fetching race_results...');
  const results = await fetchAll('race_results', 'race_id, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio, rank1, rank2', q => q.order('race_id'), { client: supabase });
  console.log('  Total results:', results.length);

  // race_id -> result マップ
  const resultMap = {};
  results.forEach(r => resultMap[r.race_id] = r);

  let updated = 0;
  let skipped = 0;
  const batchSize = 100;
  const updates = [];

  for (const pred of predictions) {
    const result = resultMap[pred.race_id];
    if (!result) {
      skipped++;
      continue;
    }

    // 払戻金を計算
    const payoutWin = pred.is_hit_win ? (result.payout_win || 0) : 0;

    // 複勝: top_pickが1着or2着なら該当する払戻金
    let payoutPlace = 0;
    if (pred.is_hit_place) {
      if (pred.top_pick === result.rank1) {
        payoutPlace = result.payout_place_1 || 0;
      } else if (pred.top_pick === result.rank2) {
        payoutPlace = result.payout_place_2 || 0;
      }
    }

    const payoutTrifecta = pred.is_hit_trifecta ? (result.payout_trifecta || 0) : 0;
    const payoutTrio = pred.is_hit_trio ? (result.payout_trio || 0) : 0;

    updates.push({
      prediction_id: pred.prediction_id,
      payout_win: payoutWin,
      payout_place: payoutPlace,
      payout_trifecta: payoutTrifecta,
      payout_trio: payoutTrio
    });
  }

  // バッチ更新
  console.log('Updating ' + updates.length + ' predictions...');
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    for (const u of batch) {
      await supabase
        .from('predictions')
        .update({
          payout_win: u.payout_win,
          payout_place: u.payout_place,
          payout_trifecta: u.payout_trifecta,
          payout_trio: u.payout_trio
        })
        .eq('prediction_id', u.prediction_id);
      updated++;
    }
    if ((i + batchSize) % 1000 === 0) {
      console.log('  Progress: ' + Math.min(i + batchSize, updates.length) + '/' + updates.length);
    }
  }

  console.log('');
  console.log('✓ payout更新完了');
  console.log('  updated:', updated);
  console.log('  skipped (結果なし):', skipped);
}

updatePayouts();
