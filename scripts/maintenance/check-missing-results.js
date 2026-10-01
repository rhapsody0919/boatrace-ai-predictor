import { supabase, isSupabaseEnabled, VENUE_NAMES } from '../lib/supabaseClient.js';

async function checkMissingResults() {
  if (!isSupabaseEnabled()) {
    console.error('Supabase not configured');
    process.exit(1);
  }

  for (const date of ['2026-01-09', '2026-01-10']) {
    console.log('\n=== ' + date + ' ===');

    // レース数
    const { count: raceCount } = await supabase
      .from('races')
      .select('*', { count: 'exact', head: true })
      .eq('race_date', date);

    // 結果数
    const { count: resultCount } = await supabase
      .from('race_results')
      .select('*', { count: 'exact', head: true })
      .like('race_id', date + '%');

    console.log('レース数: ' + raceCount);
    console.log('結果数: ' + resultCount);
    console.log('不足: ' + (raceCount - resultCount) + '件');

    // 結果がないレースを特定
    const { data: allRaces } = await supabase
      .from('races')
      .select('race_id, venue_code, race_number')
      .eq('race_date', date);

    const { data: results } = await supabase
      .from('race_results')
      .select('race_id')
      .like('race_id', date + '%');

    const resultIds = new Set(results?.map(r => r.race_id) || []);
    const missingRaces = allRaces?.filter(r => !resultIds.has(r.race_id)) || [];

    if (missingRaces.length > 0) {
      console.log('\n結果がないレース:');
      // 会場別にグループ化
      const byVenue = {};
      for (const race of missingRaces) {
        if (!byVenue[race.venue_code]) byVenue[race.venue_code] = [];
        byVenue[race.venue_code].push(race.race_number);
      }

      for (const [venue, raceNos] of Object.entries(byVenue)) {
        console.log('  ' + VENUE_NAMES[venue] + ' (' + venue + '): R' + raceNos.sort((a, b) => a - b).join(', R'));
      }
    }
  }
}

checkMissingResults();
