// 過去データ補完スクリプト
// race_entries: racer_id, global_2rate, local_2rate, *_3rate
// race_results: winning_technique
//
// 使用方法:
//   node scripts/maintenance/backfill-race-data.js --from=2025-12-01 --to=2025-12-31
//   node scripts/maintenance/backfill-race-data.js --from=2025-12-01 --to=2025-12-31 --dry-run

import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// コマンドライン引数をパース
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    from: null,
    to: null,
    dryRun: false,
    entriesOnly: false,
    resultsOnly: false,
    limit: null,
    verbose: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--from=')) {
      options.from = arg.replace('--from=', '');
    } else if (arg.startsWith('--to=')) {
      options.to = arg.replace('--to=', '');
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--entries-only') {
      options.entriesOnly = true;
    } else if (arg === '--results-only') {
      options.resultsOnly = true;
    } else if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.replace('--limit=', ''));
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    }
  }

  return options;
}

// URLを生成
function getUrl(date, placeCd, raceNo, content) {
  const urlBase = 'https://www.boatrace.jp/owpc/pc/race/';
  const ymd = date.replace(/-/g, '');
  const jcd = String(placeCd).padStart(2, '0');
  return `${urlBase}${content}?rno=${raceNo}&jcd=${jcd}&hd=${ymd}`;
}

// 出走表から選手情報をスクレイピング
async function scrapeRacelist(date, placeCd, raceNo) {
  try {
    const url = getUrl(date, placeCd, raceNo, 'racelist');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    const racers = [];

    $('.table1 tbody.is-fs12').each((index, tbody) => {
      if (index >= 6) return;

      const $tbody = $(tbody);
      const $fs11Divs = $tbody.find('.is-fs11');

      // 登録番号と級別
      const gradeText = $fs11Divs.eq(0).text().trim();
      const racerIdMatch = gradeText.match(/^(\d+)/);
      const racerId = racerIdMatch ? parseInt(racerIdMatch[1]) : null;

      // 統計データ
      const $stats = $tbody.find('td.is-lineH2');

      // 全国: 勝率<br>2連率<br>3連率
      const globalStats = $stats.eq(1).text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const global2Rate = parseFloat(globalStats[1]) || null;
      const global3Rate = parseFloat(globalStats[2]) || null;

      // 当地: 勝率<br>2連率<br>3連率
      const localStats = $stats.eq(2).text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const local2Rate = parseFloat(localStats[1]) || null;
      const local3Rate = parseFloat(localStats[2]) || null;

      // モーター: 番号<br>2連率<br>3連率
      const motorStats = $stats.eq(3).text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const motor3Rate = parseFloat(motorStats[2]) || null;

      // ボート: 番号<br>2連率<br>3連率
      const boatStats = $stats.eq(4).text().trim().split('\n').map(s => s.trim()).filter(Boolean);
      const boat3Rate = parseFloat(boatStats[2]) || null;

      racers.push({
        boatNumber: index + 1,
        racerId,
        global2Rate,
        local2Rate,
        global3Rate,
        local3Rate,
        motor3Rate,
        boat3Rate,
      });
    });

    return racers.length === 6 ? racers : null;

  } catch {
    return null;
  }
}

// 結果ページから決まり手をスクレイピング
async function scrapeWinningTechnique(date, placeCd, raceNo) {
  try {
    const url = getUrl(date, placeCd, raceNo, 'raceresult');
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en-US;q=0.7,en;q=0.3',
      }
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    let winningTechnique = null;
    $('.is-w243').each((i, table) => {
      const header = $(table).find('th').first().text().trim();
      if (header === '決まり手') {
        winningTechnique = $(table).find('tbody td').first().text().trim();
      }
    });

    return winningTechnique || null;

  } catch {
    return null;
  }
}

// race_entriesを更新
async function updateRaceEntries(raceId, racers, dryRun) {
  const updates = racers.map(racer => ({
    race_id: raceId,
    boat_number: racer.boatNumber,
    racer_id: racer.racerId,
    global_2rate: racer.global2Rate,
    local_2rate: racer.local2Rate,
    global_3rate: racer.global3Rate,
    local_3rate: racer.local3Rate,
    motor_3rate: racer.motor3Rate,
    boat_3rate: racer.boat3Rate,
  }));

  if (dryRun) {
    return { success: true, count: updates.length };
  }

  const { error } = await supabase
    .from('race_entries')
    .upsert(updates, { onConflict: 'race_id,boat_number' });

  return { success: !error, error };
}

// race_resultsを更新
async function updateRaceResult(raceId, winningTechnique, dryRun) {
  if (dryRun) {
    return { success: true };
  }

  const { error } = await supabase
    .from('race_results')
    .update({ winning_technique: winningTechnique })
    .eq('race_id', raceId);

  return { success: !error, error };
}

// メイン処理
async function main() {
  const options = parseArgs();

  if (!options.from || !options.to) {
    console.log('使用方法:');
    console.log('  node scripts/maintenance/backfill-race-data.js --from=2025-12-01 --to=2025-12-31');
    console.log('');
    console.log('オプション:');
    console.log('  --dry-run       実際には更新しない（テスト実行）');
    console.log('  --entries-only  race_entriesのみ更新');
    console.log('  --results-only  race_results（決まり手）のみ更新');
    console.log('  --limit=N       最初のN件のみ処理');
    console.log('  --verbose, -v   詳細ログを出力');
    process.exit(1);
  }

  console.log('=== 過去データ補完スクリプト ===');
  console.log(`期間: ${options.from} 〜 ${options.to}`);
  console.log(`モード: ${options.dryRun ? 'ドライラン（テスト）' : '本番実行'}`);
  console.log('');

  // 対象レースを取得
  let query = supabase
    .from('races')
    .select('race_id, race_date, venue_code, race_number')
    .gte('race_date', options.from)
    .lte('race_date', options.to)
    .order('race_id');

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data: races, error } = await query;

  if (error) {
    console.error('レース取得エラー:', error.message);
    process.exit(1);
  }

  console.log(`対象レース数: ${races.length}件${options.limit ? ` (limit: ${options.limit})` : ''}`);
  console.log('');

  let entriesUpdated = 0;
  let resultsUpdated = 0;
  let entriesSkipped = 0;
  let resultsSkipped = 0;
  let errors = 0;

  for (let i = 0; i < races.length; i++) {
    const race = races[i];
    const progress = `[${i + 1}/${races.length}]`;

    // race_entries更新
    if (!options.resultsOnly) {
      if (options.verbose) console.log(`${progress} ${race.race_id} - entries取得中...`);
      const racers = await scrapeRacelist(race.race_date, race.venue_code, race.race_number);
      if (racers) {
        const result = await updateRaceEntries(race.race_id, racers, options.dryRun);
        if (result.success) {
          entriesUpdated++;
          if (options.verbose) console.log(`${progress} ${race.race_id} - entries更新OK`);
        } else {
          errors++;
          console.error(`${progress} ${race.race_id} entries更新エラー:`, result.error?.message);
        }
      } else {
        entriesSkipped++;
        if (options.verbose) console.log(`${progress} ${race.race_id} - entriesスキップ`);
      }
    }

    // race_results更新（決まり手）
    if (!options.entriesOnly) {
      // 既にwinning_techniqueがある場合はスキップ
      const { data: existing } = await supabase
        .from('race_results')
        .select('winning_technique')
        .eq('race_id', race.race_id)
        .single();

      if (existing && !existing.winning_technique) {
        if (options.verbose) console.log(`${progress} ${race.race_id} - results取得中...`);
        const technique = await scrapeWinningTechnique(race.race_date, race.venue_code, race.race_number);
        if (technique) {
          const result = await updateRaceResult(race.race_id, technique, options.dryRun);
          if (result.success) {
            resultsUpdated++;
            if (options.verbose) console.log(`${progress} ${race.race_id} - results更新OK (${technique})`);
          } else {
            errors++;
            console.error(`${progress} ${race.race_id} results更新エラー:`, result.error?.message);
          }
        } else {
          resultsSkipped++;
          if (options.verbose) console.log(`${progress} ${race.race_id} - resultsスキップ`);
        }
      } else {
        resultsSkipped++;
      }
    }

    // 進捗表示（10件ごと）
    if ((i + 1) % 10 === 0 || i === races.length - 1) {
      console.log(`${progress} entries: ${entriesUpdated}件更新, results: ${resultsUpdated}件更新`);
    }

    // レート制限対策（50msの遅延）
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  console.log('');
  console.log('=== 完了 ===');
  console.log(`race_entries更新: ${entriesUpdated}件`);
  console.log(`race_entriesスキップ: ${entriesSkipped}件`);
  console.log(`race_results更新: ${resultsUpdated}件`);
  console.log(`race_resultsスキップ: ${resultsSkipped}件`);
  console.log(`エラー: ${errors}件`);
}

main().catch(console.error);
