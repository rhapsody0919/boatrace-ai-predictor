// Backfill all hit flags and payouts with pagination
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';
import { calculateHits } from '../lib/hitCalculator.js';

async function backfillAllHits() {
  if (!isSupabaseEnabled()) {
    console.error('❌ Supabaseが設定されていません');
    process.exit(1);
  }

  console.log('全的中フラグ・配当のバックフィルを開始...');

  let totalUpdated = 0;
  let totalSkipped = 0;
  let hasMore = true;
  const batchSize = 500;

  let lastRaceId = '';

  while (hasMore) {
    // 全予測を取得（結果があるもの全て再計算）
    let query = supabase
      .from('predictions')
      .select('prediction_id, race_id, top_pick, top_2nd, top_3rd')
      .not('is_hit_win', 'is', null)  // 結果があるもののみ
      .order('race_id')
      .limit(batchSize);

    if (lastRaceId) {
      query = query.gt('race_id', lastRaceId);
    }

    const { data: predictions, error } = await query;

    if (error) {
      console.error('❌ 予測取得エラー:', error.message);
      break;
    }

    if (!predictions || predictions.length === 0) {
      hasMore = false;
      break;
    }

    console.log(`\nバッチ処理: ${predictions.length}件`);

    let batchUpdated = 0;
    let batchSkipped = 0;

    for (const pred of predictions) {
      // 結果を取得
      const { data: result } = await supabase
        .from('race_results')
        .select('rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio')
        .eq('race_id', pred.race_id)
        .single();

      if (!result) {
        batchSkipped++;
        continue;
      }

      // 共有ライブラリで的中判定と配当計算
      const hits = calculateHits(pred, result);

      const { error: updateError } = await supabase
        .from('predictions')
        .update({
          is_hit_win: hits.isHitWin,
          is_hit_place: hits.isHitPlace,
          is_hit_trifecta: hits.isHitTrifecta,
          is_hit_trio: hits.isHitTrio,
          payout_win: hits.payoutWin,
          payout_place: hits.payoutPlace,
          payout_trifecta: hits.payoutTrifecta,
          payout_trio: hits.payoutTrio
        })
        .eq('prediction_id', pred.prediction_id);

      if (!updateError) {
        batchUpdated++;
      }
    }

    console.log(`  更新: ${batchUpdated}件, スキップ: ${batchSkipped}件`);
    totalUpdated += batchUpdated;
    totalSkipped += batchSkipped;

    // 次のページへ
    if (predictions.length > 0) {
      lastRaceId = predictions[predictions.length - 1].race_id;
    }

    // バッチサイズ未満ならデータ終了
    if (predictions.length < batchSize) {
      hasMore = false;
    }
  }

  console.log(`\n=== 完了 ===`);
  console.log(`総更新: ${totalUpdated}件`);
  console.log(`総スキップ(結果なし): ${totalSkipped}件`);
}

backfillAllHits();
