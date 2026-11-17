// Verify frontend calculation matches DB
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function fetchRaces(date) {
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
  return raceIds.map(raceId => ({
    race_id: raceId,
    predictions: predictions?.filter(p => p.race_id === raceId) || [],
    race_results: results?.filter(r => r.race_id === raceId) || []
  }));
}

function tallyWin(acc, topPick, result) {
  if (topPick === result.rank1) {
    acc.winHits++;
    acc.winPayouts += result.payout_win || 0;
  }
}

function tallyPlace(acc, topPick, result) {
  if (topPick === result.rank1 || topPick === result.rank2) {
    acc.placeHits++;
    if (topPick === result.rank1) acc.placePayouts += result.payout_place_1 || 0;
    else acc.placePayouts += result.payout_place_2 || 0;
  }
}

function tallyTrifecta(acc, top3, result) {
  if (top3.includes(result.rank1) && top3.includes(result.rank2) && top3.includes(result.rank3)) {
    acc.trifecta3Hits++;
    acc.trifecta3Payouts += result.payout_trifecta || 0;
  }
}

function tallyTrio(acc, top3, result) {
  if (top3[0] === result.rank1 && top3[1] === result.rank2 && top3[2] === result.rank3) {
    acc.trio3Hits++;
    acc.trio3Payouts += result.payout_trio || 0;
  }
}

function tallyRace(acc, result, prediction) {
  acc.finishedRaces++;
  const topPick = prediction.top_pick;
  const top3 = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd];

  // 単勝
  tallyWin(acc, topPick, result);
  // 複勝 (2着以内)
  tallyPlace(acc, topPick, result);
  // 3連複
  tallyTrifecta(acc, top3, result);
  // 3連単
  tallyTrio(acc, top3, result);
}

function tallyModel(races, modelKey) {
  const acc = {
    winHits: 0, placeHits: 0, trifecta3Hits: 0, trio3Hits: 0,
    winPayouts: 0, placePayouts: 0, trifecta3Payouts: 0, trio3Payouts: 0,
    finishedRaces: 0,
  };

  for (const race of races || []) {
    const result = race.race_results?.[0];
    if (!result || !result.rank1) continue;

    const prediction = race.predictions?.find(p => p.model_id === modelKey);
    if (!prediction) continue;

    tallyRace(acc, result, prediction);
  }
  return acc;
}

function printModelReport(modelKey, acc) {
  const { winHits, placeHits, trifecta3Hits, trio3Hits, winPayouts, placePayouts, trifecta3Payouts, trio3Payouts, finishedRaces } = acc;
  console.log('\n' + modelKey + ' (n=' + finishedRaces + '):');
  console.log('  単勝: ' + winHits + '/' + finishedRaces + ' (' + (winHits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (winPayouts/(finishedRaces*100)*100).toFixed(1) + '%');
  console.log('  複勝: ' + placeHits + '/' + finishedRaces + ' (' + (placeHits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (placePayouts/(finishedRaces*100)*100).toFixed(1) + '%');
  console.log('  3連複: ' + trifecta3Hits + '/' + finishedRaces + ' (' + (trifecta3Hits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (trifecta3Payouts/(finishedRaces*100)*100).toFixed(1) + '%');
  console.log('  3連単: ' + trio3Hits + '/' + finishedRaces + ' (' + (trio3Hits/finishedRaces*100).toFixed(1) + '%) 回収率: ' + (trio3Payouts/(finishedRaces*100)*100).toFixed(1) + '%');
}

async function verifyCalculations() {
  if (!isSupabaseEnabled()) {
    console.error('Supabase not configured');
    process.exit(1);
  }

  const date = '2026-01-08';
  console.log('=== フロントエンド計算シミュレーション ===');

  const races = await fetchRaces(date);

  const models = ['standard', 'safeBet', 'upsetFocus'];

  for (const modelKey of models) {
    printModelReport(modelKey, tallyModel(races, modelKey));
  }
}

verifyCalculations();
