// Backfill is_hit_place and payout_place for predictions
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function backfillPlaceHits() {
  if (!isSupabaseEnabled()) {
    console.error('❌ Supabaseが設定されていません');
    process.exit(1);
  }

  console.log('is_hit_place のバックフィルを開始...');

  // is_hit_placeがNULLの予測を取得（結果があるもののみ）
  const { data: predictions, error } = await supabase
    .from('predictions')
    .select('prediction_id, race_id, top_pick')
    .is('is_hit_place', null);

  if (error) {
    console.error('❌ 予測取得エラー:', error.message);
    process.exit(1);
  }

  console.log(`対象: ${predictions?.length || 0}件`);

  let updated = 0;
  let skipped = 0;

  for (const pred of predictions || []) {
    // 結果を取得
    const { data: result } = await supabase
      .from('race_results')
      .select('rank1, rank2, rank3, payout_place_1, payout_place_2')
      .eq('race_id', pred.race_id)
      .single();

    if (!result) {
      skipped++;
      continue;
    }

    // 複勝判定: top_pickが3着以内
    const isPlaceHit = pred.top_pick === result.rank1 ||
                       pred.top_pick === result.rank2 ||
                       pred.top_pick === result.rank3;

    // 配当を取得
    let payoutPlace = 0;
    if (isPlaceHit) {
      if (pred.top_pick === result.rank1) {
        payoutPlace = result.payout_place_1 || 0;
      } else if (pred.top_pick === result.rank2) {
        payoutPlace = result.payout_place_2 || 0;
      } else if (pred.top_pick === result.rank3) {
        // 3着の複勝配当は通常rank2と同程度（簡易処理）
        payoutPlace = result.payout_place_2 || result.payout_place_1 || 0;
      }
    }

    const { error: updateError } = await supabase
      .from('predictions')
      .update({
        is_hit_place: isPlaceHit,
        payout_place: payoutPlace
      })
      .eq('prediction_id', pred.prediction_id);

    if (!updateError) {
      updated++;
    }

    if (updated % 100 === 0 && updated > 0) {
      console.log(`  進捗: ${updated}件更新完了`);
    }
  }

  console.log(`\n完了:`);
  console.log(`  更新: ${updated}件`);
  console.log(`  スキップ(結果なし): ${skipped}件`);
}

backfillPlaceHits();
