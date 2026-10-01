// Backfill is_hit_win for existing predictions
// Uses service role key for write access

import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';
import { getTodayDateJST, parseDateArg } from '../lib/dateUtils.js';
import { isWinHit } from '../lib/hitCalculator.js';

async function backfillIsHitWin(dateStr = null) {
  if (!isSupabaseEnabled()) {
    console.error('❌ Supabaseが設定されていません');
    process.exit(1);
  }

  const targetDate = dateStr || getTodayDateJST();
  console.log(`Backfilling is_hit_win for ${targetDate}`);

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

  let updated = 0;
  let hits = 0;

  for (const result of results) {
    // このレースの予測を取得
    const { data: predictions, error: predError } = await supabase
      .from('predictions')
      .select('prediction_id, top_pick')
      .eq('race_id', result.race_id);

    if (predError || !predictions || predictions.length === 0) continue;

    for (const pred of predictions) {
      const isHit = isWinHit(pred.top_pick, result.rank1);

      const { error: updateError } = await supabase
        .from('predictions')
        .update({ is_hit_win: isHit })
        .eq('prediction_id', pred.prediction_id);

      if (!updateError) {
        updated++;
        if (isHit) hits++;
      }
    }
  }

  console.log(`\n✅ 完了`);
  console.log(`  更新: ${updated}件`);
  console.log(`  1着的中: ${hits}件`);
}

// Get date from command line argument (optional)
const targetDate = parseDateArg();

backfillIsHitWin(targetDate);
