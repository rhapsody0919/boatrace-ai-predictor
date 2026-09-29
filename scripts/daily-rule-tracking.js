/**
 * 会場別ルール追跡バッチスクリプト
 *
 * 毎日実行して、ルール適用結果を集計する
 *
 * 処理内容:
 * 1. 前日のレースでルールがマッチしたものを抽出
 * 2. rule_applicationsテーブルに記録
 * 3. 結果が確定したレースの的中・払戻を更新
 */

import { pathToFileURL } from 'node:url';
import { supabase, isSupabaseEnabled } from './lib/supabaseClient.js';

// ルール定義（ruleMatchService.jsと同期させる必要あり）
const VENUE_RULES = {
  '03': [
    {
      id: 'E03-T001-S',
      betType: 'trio',
      check: (pred, raceNo, conf, predSorted, has1) =>
        predSorted === '1-2-4' && raceNo >= 9 && conf >= 80
    },
    {
      id: 'E03-T001-M',
      betType: 'trio',
      check: (pred, raceNo, conf, predSorted, has1) =>
        ['1-2-4', '1-2-3'].includes(predSorted) && raceNo >= 9 && conf >= 80
    },
    {
      id: 'E03-T004-S',
      betType: 'trio',
      check: (pred, raceNo, conf, predSorted, has1) =>
        has1 && raceNo >= 5 && conf >= 85
    },
    {
      id: 'E03-T004-L',
      betType: 'trio',
      check: (pred, raceNo, conf, predSorted, has1) =>
        has1 && conf >= 90
    },
    {
      id: 'E03-P002',
      betType: 'place',
      check: (pred, raceNo, conf, predSorted, has1) =>
        pred.top_pick === 1 && raceNo >= 9
    },
    {
      id: 'E03-W002',
      betType: 'win',
      check: (pred, raceNo, conf, predSorted, has1) =>
        pred.top_pick === 2 && raceNo <= 4
    },
    {
      id: 'E03-W003',
      betType: 'win',
      check: (pred, raceNo, conf, predSorted, has1) =>
        pred.top_pick === 3 && pred.top_2nd === 1 && conf >= 70
    }
  ]
};

function getMatchingRulesForPrediction(prediction, venueCode, raceNo) {
  const rules = VENUE_RULES[venueCode];
  if (!rules) return [];

  const conf = prediction.confidence || 0;
  const top3 = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd];
  const predSorted = [...top3].filter(Boolean).sort((a, b) => a - b).join('-');
  const has1 = top3.includes(1);

  const matched = [];
  for (const rule of rules) {
    try {
      if (rule.check(prediction, raceNo, conf, predSorted, has1)) {
        matched.push({ ruleId: rule.id, betType: rule.betType });
      }
    } catch (e) {
      // ignore
    }
  }
  return matched;
}

export function calculatePayout(prediction, result, betType) {
  if (!result) return { hit: null, payout: null };

  const top3 = [prediction.top_pick, prediction.top_2nd, prediction.top_3rd];
  const predSorted = [...top3].filter(Boolean).sort((a, b) => a - b).join('-');
  const resultSorted = [result.rank1, result.rank2, result.rank3].sort((a, b) => a - b).join('-');

  // 'trio' は3連複（順不同）。race_results の列名は中身と逆で、3連複の配当は payout_trifecta
  // （payout_trio は3連単。docs/db-migration/079_race_payouts.sql:29、BOA-535）
  if (betType === 'trio') {
    const hit = predSorted === resultSorted;
    return { hit, payout: hit ? (result.payout_trifecta || 0) : 0 };
  }

  if (betType === 'win') {
    const hit = prediction.top_pick === result.rank1;
    return { hit, payout: hit ? (result.payout_win || 0) : 0 };
  }

  if (betType === 'place') {
    const hit = prediction.top_pick === result.rank1 || prediction.top_pick === result.rank2;
    let payout = 0;
    if (prediction.top_pick === result.rank1) {
      payout = result.payout_place_1 || 0;
    } else if (prediction.top_pick === result.rank2) {
      payout = result.payout_place_2 || 0;
    }
    return { hit, payout };
  }

  return { hit: null, payout: null };
}

async function trackRules(targetDate) {
  if (!isSupabaseEnabled()) {
    console.error('Supabase環境変数が未設定です');
    process.exit(1);
  }

  const dateStr = targetDate || new Date(Date.now() - 86400000).toISOString().split('T')[0];
  console.log(`\n=== ルール追跡: ${dateStr} ===\n`);

  // 対象日の予測を取得
  const { data: predictions, error: predError } = await supabase
    .from('predictions')
    .select('*')
    .like('race_id', `${dateStr}-%`)
    .eq('model_id', 'standard');

  if (predError) {
    console.error('予測取得エラー:', predError.message);
    return;
  }

  console.log(`予測数: ${predictions?.length || 0}`);

  if (!predictions || predictions.length === 0) {
    console.log('対象レースなし');
    return;
  }

  // 結果を取得
  const raceIds = predictions.map(p => p.race_id);
  const { data: results, error: resError } = await supabase
    .from('race_results')
    .select('*')
    .in('race_id', raceIds);

  if (resError) {
    console.error('結果取得エラー:', resError.message);
    return;
  }

  const resultsMap = {};
  results?.forEach(r => { resultsMap[r.race_id] = r; });

  // 既存の適用を取得
  const { data: existingApps } = await supabase
    .from('rule_applications')
    .select('rule_id, race_id')
    .in('race_id', raceIds);

  const existingSet = new Set(
    (existingApps || []).map(a => `${a.rule_id}:${a.race_id}`)
  );

  // ルールマッチング
  const newApplications = [];
  const updateApplications = [];

  for (const pred of predictions) {
    const parts = pred.race_id.split('-');
    const venueCode = parts[3];
    const raceNo = parseInt(parts[4]);

    const matchedRules = getMatchingRulesForPrediction(pred, venueCode, raceNo);

    for (const match of matchedRules) {
      const key = `${match.ruleId}:${pred.race_id}`;
      const result = resultsMap[pred.race_id];
      const { hit, payout } = calculatePayout(pred, result, match.betType);

      if (existingSet.has(key)) {
        // 既存レコードを更新（結果が確定した場合）
        if (result && hit !== null) {
          updateApplications.push({
            rule_id: match.ruleId,
            race_id: pred.race_id,
            is_hit: hit,
            payout: payout
          });
        }
      } else {
        // 新規レコード
        newApplications.push({
          rule_id: match.ruleId,
          race_id: pred.race_id,
          bet_amount: 100,
          is_hit: hit,
          payout: payout
        });
      }
    }
  }

  console.log(`新規適用: ${newApplications.length}件`);
  console.log(`更新対象: ${updateApplications.length}件`);

  // 新規レコード挿入
  if (newApplications.length > 0) {
    const { error: insertError } = await supabase
      .from('rule_applications')
      .insert(newApplications);

    if (insertError) {
      console.error('挿入エラー:', insertError.message);
    } else {
      console.log(`${newApplications.length}件を挿入しました`);
    }
  }

  // 既存レコード更新
  for (const update of updateApplications) {
    const { error: updateError } = await supabase
      .from('rule_applications')
      .update({ is_hit: update.is_hit, payout: update.payout })
      .eq('rule_id', update.rule_id)
      .eq('race_id', update.race_id);

    if (updateError) {
      console.error(`更新エラー (${update.rule_id}/${update.race_id}):`, updateError.message);
    }
  }

  // サマリー出力
  console.log('\n--- ルール別サマリー ---');

  const ruleStats = {};
  for (const app of [...newApplications, ...updateApplications]) {
    if (!ruleStats[app.rule_id]) {
      ruleStats[app.rule_id] = { total: 0, hits: 0, payout: 0 };
    }
    ruleStats[app.rule_id].total++;
    if (app.is_hit) {
      ruleStats[app.rule_id].hits++;
      ruleStats[app.rule_id].payout += app.payout || 0;
    }
  }

  for (const [ruleId, stats] of Object.entries(ruleStats)) {
    const recovery = stats.total > 0 ? ((stats.payout / (stats.total * 100)) * 100).toFixed(1) : '-';
    const hitRate = stats.total > 0 ? ((stats.hits / stats.total) * 100).toFixed(1) : '-';
    console.log(`${ruleId}: ${stats.total}R | 的中${hitRate}% | 回収${recovery}%`);
  }

  console.log('\n=== 完了 ===');
}

// コマンドラインから直接実行されたときだけ動く（検証スクリプトが calculatePayout を import できるように。BOA-535）
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  // コマンドライン引数から日付を取得
  const targetDate = process.argv[2];
  trackRules(targetDate).catch(console.error);
}
