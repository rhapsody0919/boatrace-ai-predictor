// Fix predictions where results exist but is_hit_win is NULL
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function fixMissingHits() {
  if (!isSupabaseEnabled()) {
    console.error('Supabaseが設定されていません');
    process.exit(1);
  }

  // 対象日付を取得（引数から）
  const args = process.argv.slice(2);
  const dateArg = args.find(arg => arg.startsWith('--date='));
  const targetDate = dateArg ? dateArg.split('=')[1] : null;

  if (!targetDate) {
    console.error('Usage: node fix-missing-hits.js --date=2026-01-10');
    process.exit(1);
  }

  console.log(`${targetDate}の欠落した的中フラグを修正...`);

  // is_hit_winがNULLの予測を取得
  const { data: predictions, error: predError } = await supabase
    .from('predictions')
    .select('prediction_id, race_id, top_pick, top_2nd, top_3rd')
    .like('race_id', `${targetDate}%`)
    .is('is_hit_win', null);

  if (predError) {
    console.error('予測取得エラー:', predError.message);
    process.exit(1);
  }

  console.log(`対象予測: ${predictions.length}件`);

  if (predictions.length === 0) {
    console.log('修正対象がありません');
    return;
  }

  // race_resultsから結果を取得
  const { data: results, error: resError } = await supabase
    .from('race_results')
    .select('race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio')
    .like('race_id', `${targetDate}%`);

  if (resError) {
    console.error('結果取得エラー:', resError.message);
    process.exit(1);
  }

  console.log(`結果データ: ${results.length}件`);

  // 結果をマップに変換
  const resultsMap = new Map();
  for (const r of results) {
    resultsMap.set(r.race_id, r);
  }

  let updated = 0;
  let noResult = 0;

  for (const pred of predictions) {
    const result = resultsMap.get(pred.race_id);

    if (!result || !result.rank1) {
      noResult++;
      continue;
    }

    // 的中判定
    const isWinHit = pred.top_pick === result.rank1;
    const isPlaceHit = pred.top_pick === result.rank1 || pred.top_pick === result.rank2;

    // 3連複判定
    const predSet = new Set([pred.top_pick, pred.top_2nd, pred.top_3rd]);
    const resultSet = new Set([result.rank1, result.rank2, result.rank3]);
    const isTrifectaHit = predSet.size === 3 && resultSet.size === 3 &&
      [...predSet].every(p => resultSet.has(p));

    // 3連単判定
    const isTrioHit = pred.top_pick === result.rank1 &&
      pred.top_2nd === result.rank2 &&
      pred.top_3rd === result.rank3;

    // 配当計算
    let payoutWin = null;
    let payoutPlace = null;
    let payoutTrifecta = null;
    let payoutTrio = null;

    if (isWinHit && result.payout_win) {
      payoutWin = result.payout_win;
    }
    if (isPlaceHit) {
      if (pred.top_pick === result.rank1 && result.payout_place_1) {
        payoutPlace = result.payout_place_1;
      } else if (pred.top_pick === result.rank2 && result.payout_place_2) {
        payoutPlace = result.payout_place_2;
      }
    }
    if (isTrifectaHit && result.payout_trifecta) {
      payoutTrifecta = result.payout_trifecta;
    }
    if (isTrioHit && result.payout_trio) {
      payoutTrio = result.payout_trio;
    }

    // 更新
    const { error: updateError } = await supabase
      .from('predictions')
      .update({
        is_hit_win: isWinHit,
        is_hit_place: isPlaceHit,
        is_hit_trifecta: isTrifectaHit,
        is_hit_trio: isTrioHit,
        payout_win: payoutWin,
        payout_place: payoutPlace,
        payout_trifecta: payoutTrifecta,
        payout_trio: payoutTrio
      })
      .eq('prediction_id', pred.prediction_id);

    if (updateError) {
      console.error(`更新エラー (${pred.race_id}):`, updateError.message);
    } else {
      updated++;
    }
  }

  console.log(`\n完了: ${updated}件更新, ${noResult}件は結果なし`);
}

fixMissingHits();
