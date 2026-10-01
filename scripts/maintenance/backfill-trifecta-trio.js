// Backfill is_hit_trifecta/is_hit_trio for existing predictions
// Uses service role key for write access

import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';
import { getTodayDateJST, parseDateArg } from '../lib/dateUtils.js';
import { isTrifectaHit as checkTrifectaHit, isTrioHit as checkTrioHit } from '../lib/hitCalculator.js';

async function backfillTrifectaTrio(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error('❌ Supabaseが設定されていません');
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Backfilling is_hit_trifecta/is_hit_trio for ${targetDate}`);

  // 対象日の結果を取得
  const { data: results, error: resultError } = await supabase
    .from('race_results')
    .select('*')
    .like('race_id', `${targetDate}%`);

  if (resultError) {
    console.error('❌ 結果取得エラー:', resultError.message);
    process.exit(1);
  }

  console.log(`Found ${results.length} results`);

  let trifectaHits = 0;
  let trioHits = 0;
  let updated = 0;

  for (const result of results) {
    // このレースの予測を取得
    const { data: predictions, error: predError } = await supabase
      .from('predictions')
      .select('prediction_id, model_id, top_pick, top_2nd, top_3rd')
      .eq('race_id', result.race_id);

    if (predError) {
      console.error(`  ${result.race_id} 予測取得エラー:`, predError.message);
      continue;
    }
    if (!predictions || predictions.length === 0) continue;

    for (const pred of predictions) {
      const predTop3 = [pred.top_pick, pred.top_2nd, pred.top_3rd];

      // 共有ライブラリで的中判定
      const isTrifectaHit = checkTrifectaHit(predTop3, result.rank1, result.rank2, result.rank3);
      const isTrioHit = checkTrioHit(predTop3, result.rank1, result.rank2, result.rank3);

      const updateData = {
        is_hit_trifecta: isTrifectaHit,
        is_hit_trio: isTrioHit,
        payout_trifecta: isTrifectaHit ? result.payout_trifecta : 0,
        payout_trio: isTrioHit ? result.payout_trio : 0
      };

      const { error: updateError } = await supabase
        .from('predictions')
        .update(updateData)
        .eq('prediction_id', pred.prediction_id);

      if (updateError) {
        console.error(`  ${result.race_id} ${pred.model_id} 更新エラー:`, updateError.message);
      } else {
        updated++;
        if (isTrifectaHit) trifectaHits++;
        if (isTrioHit) trioHits++;
      }
    }
  }

  console.log(`\n✅ 完了`);
  console.log(`  更新: ${updated}件`);
  console.log(`  3連複的中: ${trifectaHits}件`);
  console.log(`  3連単的中: ${trioHits}件`);
}

// Get date from command line argument (optional)
const targetDate = parseDateArg();

backfillTrifectaTrio(targetDate);
