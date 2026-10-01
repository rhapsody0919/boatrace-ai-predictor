// Verify frontend calculation matches DB
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function verifyCalculations() {
  if (!isSupabaseEnabled()) {
    console.error('Supabase not configured');
    process.exit(1);
  }

  const date = '2026-01-08';
  console.log('=== フロントエンド計算シミュレーション ===');

  // レースIDを取得
  const { data: racesList } = await supabase
    .from('races')
    .select('race_id')
    .eq('race_date', date);

  const raceIds = racesList?.map(r => r.race_id) || [];

  // 予測と結果を取得
  const { data: predictions } = await supabase
    .from('predictions')
    .select('race_id, model_id, top_pick, top_2nd, top_3rd')
    .in('race_id', raceIds);

  const { data: results } = await supabase
    .from('race_results')
    .select('race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trifecta, payout_trio')
    .in('race_id', raceIds);

  // レースごとにまとめる
  const races = raceIds.map(raceId => ({
    race_id: raceId,
    predictions: predictions?.filter(p => p.race_id === raceId) || [],
    race_results: results?.filter(r => r.race_id === raceId) || []
  }));

  const models = ['standard', 'safeBet', 'upsetFocus'];

  for (const modelKey of models) {
    let winHits = 0, placeHits = 0, trifecta3Hits = 0, trio3Hits = 0;
    let winPayouts = 0, placePayouts = 0, trifecta3Payouts = 0, trio3Payouts = 0;
    let finishedRaces = 0;

    for (const race of races || []) {
      const result = race.race_results?.[0];
      if (!result || !result.rank1) continue;

      const prediction = race.predictions?.find(p => p.model_id === modelKey);
      if (!prediction) continue;

      finishedRaces++;
      const topPick = prediction.top_pick;
      const top3 = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd];

      // 単勝
      if (topPick === result.rank1) {
        winHits++;
        winPayouts += result.payout_win || 0;
      }

      // 複勝 (2着以内)
      if (topPick === result.rank1 || topPick === result.rank2) {
        placeHits++;
        if (topPick === result.rank1) placePayouts += result.payout_place_1 || 0;
        else placePayouts += result.payout_place_2 || 0;
      }

      // 3連複
      if (top3.includes(result.rank1) && top3.includes(result.rank2) && top3.includes(result.rank3)) {
        trifecta3Hits++;
        trifecta3Payouts += result.payout_trifecta || 0;
      }

      // 3連単
      if (top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3) {
        trio3Hits++;
        trio3Payouts += result.payout_trio || 0;
      }
    }

    console.log('\n' + modelKey + ' (n=' + finishedRaces + '):');
    console.log('  単勝: ' + winHits + '/' + finishedRaces + ' (' + (winHits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (winPayouts/(finishedRaces*100)*100).toFixed(1) + '%');
    console.log('  複勝: ' + placeHits + '/' + finishedRaces + ' (' + (placeHits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (placePayouts/(finishedRaces*100)*100).toFixed(1) + '%');
    console.log('  3連複: ' + trifecta3Hits + '/' + finishedRaces + ' (' + (trifecta3Hits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (trifecta3Payouts/(finishedRaces*100)*100).toFixed(1) + '%');
    console.log('  3連単: ' + trio3Hits + '/' + finishedRaces + ' (' + (trio3Hits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (trio3Payouts/(finishedRaces*100)*100).toFixed(1) + '%');
  }
}

verifyCalculations();
