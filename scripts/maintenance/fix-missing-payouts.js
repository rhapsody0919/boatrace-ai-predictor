// Fix predictions where is_hit_win=true but payout_win=null
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function fixMissingPayouts() {
  if (!isSupabaseEnabled()) {
    console.error('❌ Supabaseが設定されていません');
    process.exit(1);
  }

  console.log('payout更新漏れを修正中...');

  // is_hit_win=trueでpayout_win=nullの予測を取得
  const { data: missing } = await supabase
    .from('predictions')
    .select('prediction_id, race_id, top_pick, is_hit_win, is_hit_place')
    .eq('is_hit_win', true)
    .is('payout_win', null);

  console.log('対象: ' + (missing?.length || 0) + '件');

  let fixed = 0;
  for (const pred of missing || []) {
    // 結果を取得
    const { data: result } = await supabase
      .from('race_results')
      .select('payout_win, payout_place_1')
      .eq('race_id', pred.race_id)
      .single();

    if (result?.payout_win) {
      const updateData = { payout_win: result.payout_win };

      // 複勝も的中している場合
      if (pred.is_hit_place && result.payout_place_1) {
        updateData.payout_place = result.payout_place_1;
      }

      const { error } = await supabase
        .from('predictions')
        .update(updateData)
        .eq('prediction_id', pred.prediction_id);

      if (!error) fixed++;
    }
  }

  console.log('修正完了: ' + fixed + '件');
}

fixMissingPayouts();
