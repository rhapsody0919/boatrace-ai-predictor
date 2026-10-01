// 江戸川会場の詳細分析 - 4券種での回収率分析
import { supabase, isSupabaseEnabled } from '../lib/supabaseClient.js';

async function analyze() {
  if (!isSupabaseEnabled()) {
    console.error('Supabase not configured');
    process.exit(1);
  }

  console.log('=== 江戸川 4券種別 回収率分析 ===\n');

  // 江戸川のレース結果を取得
  const { data: results } = await supabase
    .from('race_results')
    .select('race_id, rank1, rank2, rank3, payout_win, payout_place_1, payout_place_2, payout_trio, payout_trifecta')
    .like('race_id', '%-03-%');

  console.log('分析対象レース数:', results.length, '\n');

  // エントリーデータを取得
  const raceIds = results.map(r => r.race_id);
  let allEntries = [];
  for (let i = 0; i < raceIds.length; i += 100) {
    const batch = raceIds.slice(i, i + 100);
    const { data: entries } = await supabase
      .from('race_entries')
      .select('race_id, boat_number, grade, win_rate, local_win_rate, motor_2rate, boat_2rate')
      .in('race_id', batch);
    if (entries) allEntries = allEntries.concat(entries);
  }

  const entriesByRace = {};
  for (const entry of allEntries) {
    if (!entriesByRace[entry.race_id]) entriesByRace[entry.race_id] = {};
    entriesByRace[entry.race_id][entry.boat_number] = entry;
  }

  // ========================================
  // 1. 号艇別 4券種分析
  // ========================================
  console.log('=== 1. 号艇別 4券種 回収率 ===\n');

  for (let boat = 1; boat <= 6; boat++) {
    const stats = {
      win: { hits: 0, payout: 0 },       // 単勝: その艇が1着
      place: { hits: 0, payout: 0 },     // 複勝: その艇が1着or2着
      trifecta: { hits: 0, payout: 0 },  // 3連複: その艇が3着以内
      trio: { hits: 0, payout: 0 }       // 3連単: その艇が1着
    };

    for (const r of results) {
      // 単勝
      if (r.rank1 === boat) {
        stats.win.hits++;
        stats.win.payout += r.payout_win || 0;
        stats.trio.hits++;
        stats.trio.payout += r.payout_trio || 0;
      }
      // 複勝
      if (r.rank1 === boat) {
        stats.place.hits++;
        stats.place.payout += r.payout_place_1 || 0;
      } else if (r.rank2 === boat) {
        stats.place.hits++;
        stats.place.payout += r.payout_place_2 || 0;
      }
      // 3連複（その艇が3着以内に入っていれば的中）
      if (r.rank1 === boat || r.rank2 === boat || r.rank3 === boat) {
        stats.trifecta.hits++;
        stats.trifecta.payout += r.payout_trifecta || 0;
      }
    }

    const inv = results.length * 100;
    console.log(`${boat}号艇:`);
    console.log(`  単勝   的中${String(stats.win.hits).padStart(4)}回 (${(stats.win.hits/results.length*100).toFixed(1).padStart(5)}%)  回収率 ${(stats.win.payout/inv*100).toFixed(1).padStart(6)}%${stats.win.payout/inv >= 1 ? ' ★' : ''}`);
    console.log(`  複勝   的中${String(stats.place.hits).padStart(4)}回 (${(stats.place.hits/results.length*100).toFixed(1).padStart(5)}%)  回収率 ${(stats.place.payout/inv*100).toFixed(1).padStart(6)}%${stats.place.payout/inv >= 1 ? ' ★' : ''}`);
    console.log(`  3連複  的中${String(stats.trifecta.hits).padStart(4)}回 (${(stats.trifecta.hits/results.length*100).toFixed(1).padStart(5)}%)  回収率 ${(stats.trifecta.payout/inv*100).toFixed(1).padStart(6)}%${stats.trifecta.payout/inv >= 1 ? ' ★' : ''}`);
    console.log(`  3連単  的中${String(stats.trio.hits).padStart(4)}回 (${(stats.trio.hits/results.length*100).toFixed(1).padStart(5)}%)  回収率 ${(stats.trio.payout/inv*100).toFixed(1).padStart(6)}%${stats.trio.payout/inv >= 1 ? ' ★' : ''}`);
    console.log('');
  }

  // ========================================
  // 2. 条件付き戦略 - 4券種分析
  // ========================================
  console.log('=== 2. 条件付き戦略 4券種 回収率 ===\n');

  // 戦略定義
  const strategies = [
    {
      name: '1号艇モーター40%以上 → 1号艇購入',
      filter: (e) => e[1]?.motor_2rate >= 40,
      targetBoat: 1
    },
    {
      name: '1号艇モーター50%以上 → 1号艇購入',
      filter: (e) => e[1]?.motor_2rate >= 50,
      targetBoat: 1
    },
    {
      name: '1号艇A1級 → 1号艇購入',
      filter: (e) => e[1]?.grade === 'A1',
      targetBoat: 1
    },
    {
      name: '1号艇A1 & モーター45%↑ → 1号艇購入',
      filter: (e) => e[1]?.grade === 'A1' && e[1]?.motor_2rate >= 45,
      targetBoat: 1
    },
    {
      name: '1号艇勝率<5.5 → 2号艇購入',
      filter: (e) => e[1]?.win_rate < 5.5,
      targetBoat: 2
    },
    {
      name: '1号艇勝率<5.5 → 3号艇購入',
      filter: (e) => e[1]?.win_rate < 5.5,
      targetBoat: 3
    },
    {
      name: '1号艇B級 & 2号艇A1 → 2号艇購入',
      filter: (e) => (e[1]?.grade === 'B1' || e[1]?.grade === 'B2') && e[2]?.grade === 'A1',
      targetBoat: 2
    },
    {
      name: '2号艇モーター45%以上 → 2号艇購入',
      filter: (e) => e[2]?.motor_2rate >= 45,
      targetBoat: 2
    },
    {
      name: '4号艇A1級 → 4号艇購入',
      filter: (e) => e[4]?.grade === 'A1',
      targetBoat: 4
    },
    {
      name: '1号艇勝率<5.0 & 4号艇A1 → 4号艇購入',
      filter: (e) => e[1]?.win_rate < 5.0 && e[4]?.grade === 'A1',
      targetBoat: 4
    }
  ];

  console.log('戦略名                                   対象数  │  単勝      複勝      3連複     3連単');
  console.log('-'.repeat(100));

  for (const strat of strategies) {
    const stats = {
      count: 0,
      win: { hits: 0, payout: 0 },
      place: { hits: 0, payout: 0 },
      trifecta: { hits: 0, payout: 0 },
      trio: { hits: 0, payout: 0 }
    };

    for (const r of results) {
      const e = entriesByRace[r.race_id];
      if (!e || Object.keys(e).length < 6) continue;
      if (!strat.filter(e)) continue;

      stats.count++;
      const boat = strat.targetBoat;

      // 単勝
      if (r.rank1 === boat) {
        stats.win.hits++;
        stats.win.payout += r.payout_win || 0;
        stats.trio.hits++;
        stats.trio.payout += r.payout_trio || 0;
      }
      // 複勝
      if (r.rank1 === boat) {
        stats.place.hits++;
        stats.place.payout += r.payout_place_1 || 0;
      } else if (r.rank2 === boat) {
        stats.place.hits++;
        stats.place.payout += r.payout_place_2 || 0;
      }
      // 3連複
      if (r.rank1 === boat || r.rank2 === boat || r.rank3 === boat) {
        stats.trifecta.hits++;
        stats.trifecta.payout += r.payout_trifecta || 0;
      }
    }

    if (stats.count > 0) {
      const inv = stats.count * 100;
      const winRec = (stats.win.payout / inv * 100).toFixed(1);
      const placeRec = (stats.place.payout / inv * 100).toFixed(1);
      const trifectaRec = (stats.trifecta.payout / inv * 100).toFixed(1);
      const trioRec = (stats.trio.payout / inv * 100).toFixed(1);

      const m = (v) => parseFloat(v) >= 100 ? '★' : ' ';

      console.log(
        `${strat.name.padEnd(40)} ${String(stats.count).padStart(4)}   │ ${winRec.padStart(6)}%${m(winRec)} ${placeRec.padStart(6)}%${m(placeRec)} ${trifectaRec.padStart(6)}%${m(trifectaRec)} ${trioRec.padStart(6)}%${m(trioRec)}`
      );
    }
  }

  // ========================================
  // 3. 組み合わせ戦略 - 3連単/3連複
  // ========================================
  console.log('\n=== 3. 組み合わせ戦略 3連単/3連複 回収率 ===\n');

  const comboStrategies = [
    { name: '全レース 1-2-3', combos: ['1-2-3'] },
    { name: '全レース 1-2-4', combos: ['1-2-4'] },
    { name: '全レース 1-3-2', combos: ['1-3-2'] },
    { name: '全レース 2-1-3', combos: ['2-1-3'] },
    { name: '全レース 1号艇頭6点', combos: ['1-2-3','1-2-4','1-3-2','1-3-4','1-4-2','1-4-3'] },
    { name: '全レース 人気薄3点', combos: ['3-1-5','1-5-6','1-2-6'] },
  ];

  // 条件付き組み合わせ戦略
  const condComboStrategies = [
    {
      name: '1号艇A1&モーター45%↑ → 1-2-3,1-2-4,1-3-2',
      filter: (e) => e[1]?.grade === 'A1' && e[1]?.motor_2rate >= 45,
      combos: ['1-2-3', '1-2-4', '1-3-2']
    },
    {
      name: '1号艇モーター50%↑ → 1-2-3,1-3-2',
      filter: (e) => e[1]?.motor_2rate >= 50,
      combos: ['1-2-3', '1-3-2']
    },
    {
      name: '1号艇勝率<5.5 → 2-1-3,2-1-4,3-1-2',
      filter: (e) => e[1]?.win_rate < 5.5,
      combos: ['2-1-3', '2-1-4', '3-1-2']
    },
    {
      name: '1号艇B級&2号艇A1 → 2-1-3,2-1-4,2-3-1',
      filter: (e) => (e[1]?.grade === 'B1' || e[1]?.grade === 'B2') && e[2]?.grade === 'A1',
      combos: ['2-1-3', '2-1-4', '2-3-1']
    }
  ];

  console.log('戦略名                                        対象数   点数  │ 3連単回収率  3連複回収率');
  console.log('-'.repeat(95));

  // 無条件戦略
  for (const strat of comboStrategies) {
    let trioHits = 0, trioPayout = 0;
    let trifectaHits = 0, trifectaPayout = 0;

    for (const r of results) {
      const key = `${r.rank1}-${r.rank2}-${r.rank3}`;
      const sorted = [r.rank1, r.rank2, r.rank3].sort((a,b) => a-b).join('-');

      for (const combo of strat.combos) {
        // 3連単（順番通り）
        if (key === combo) {
          trioHits++;
          trioPayout += r.payout_trio || 0;
        }
        // 3連複（順番関係なし）
        const comboSorted = combo.split('-').map(Number).sort((a,b) => a-b).join('-');
        if (sorted === comboSorted) {
          trifectaHits++;
          trifectaPayout += r.payout_trifecta || 0;
          break; // 同じレースで複数の組み合わせが当たることはない
        }
      }
    }

    const inv = results.length * strat.combos.length * 100;
    const trioRec = (trioPayout / inv * 100).toFixed(1);
    const trifectaRec = (trifectaPayout / inv * 100).toFixed(1);
    const m = (v) => parseFloat(v) >= 100 ? '★' : ' ';

    console.log(
      `${strat.name.padEnd(44)} ${String(results.length).padStart(5)}   ${String(strat.combos.length).padStart(4)}  │ ${trioRec.padStart(8)}%${m(trioRec)}   ${trifectaRec.padStart(8)}%${m(trifectaRec)}`
    );
  }

  console.log('-'.repeat(95));

  // 条件付き戦略
  for (const strat of condComboStrategies) {
    let targetCount = 0;
    let trioHits = 0, trioPayout = 0;
    let trifectaHits = 0, trifectaPayout = 0;

    for (const r of results) {
      const e = entriesByRace[r.race_id];
      if (!e || Object.keys(e).length < 6) continue;
      if (!strat.filter(e)) continue;

      targetCount++;
      const key = `${r.rank1}-${r.rank2}-${r.rank3}`;
      const sorted = [r.rank1, r.rank2, r.rank3].sort((a,b) => a-b).join('-');

      for (const combo of strat.combos) {
        if (key === combo) {
          trioHits++;
          trioPayout += r.payout_trio || 0;
        }
        const comboSorted = combo.split('-').map(Number).sort((a,b) => a-b).join('-');
        if (sorted === comboSorted) {
          trifectaHits++;
          trifectaPayout += r.payout_trifecta || 0;
          break;
        }
      }
    }

    if (targetCount > 0) {
      const inv = targetCount * strat.combos.length * 100;
      const trioRec = (trioPayout / inv * 100).toFixed(1);
      const trifectaRec = (trifectaPayout / inv * 100).toFixed(1);
      const m = (v) => parseFloat(v) >= 100 ? '★' : ' ';

      console.log(
        `${strat.name.padEnd(44)} ${String(targetCount).padStart(5)}   ${String(strat.combos.length).padStart(4)}  │ ${trioRec.padStart(8)}%${m(trioRec)}   ${trifectaRec.padStart(8)}%${m(trifectaRec)}`
      );
    }
  }

  // ========================================
  // 4. 回収率100%超えサマリー
  // ========================================
  console.log('\n=== 4. 回収率100%超え戦略サマリー ===\n');
  console.log('※ 上記分析で★がついた戦略が回収率100%超え');
  console.log('※ サンプル数が少ない戦略は信頼性に注意\n');

  console.log('=== 分析完了 ===');
}

analyze().catch(console.error);
