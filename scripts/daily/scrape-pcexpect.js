/**
 * boatrace.jp 公式コンピュータ予想 (pcexpect) スクレイパ
 *
 * 各レースの予想フォーカス（2連単4点 + 3連単6点）と自信度（1〜5）を
 * external_predictions テーブルへ upsert する。
 *
 * 使い方:
 *   node scripts/daily/scrape-pcexpect.js                    # 当日全レース
 *   node scripts/daily/scrape-pcexpect.js --date 2026-01-08  # 指定日
 *   node scripts/daily/scrape-pcexpect.js --venue 24         # 会場絞り込み
 *   node scripts/daily/scrape-pcexpect.js --race 1           # レース番号絞り込み（要 --venue）
 *   node scripts/daily/scrape-pcexpect.js --dry              # DB 書き込みせず標準出力のみ
 *
 * 取得・解析・保存の本体は runForRaces（レース単位の入口。WS4b T4b-08-1）。CLI の main() も、Vercel Function
 * （api/cron/pcexpect.js。予定表のスロット）も、これを呼ぶ。import しても main() は走らない。
 */
// 取得・解析・書き込みの本体は scripts/lib/pcexpect/scrape.js（ハンドラー scrapeJobs/pcexpectHandlers.js も読む。ここは CLI の main と再 export）
import { fileURLToPath } from "node:url";
import { isSupabaseEnabled, VENUE_NAMES } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { runForRaces } from "../lib/pcexpect/scrape.js";

const FETCH_INTERVAL_MS = 1000;

function parseArgs(argv = process.argv.slice(2)) {
  const args = { date: null, venue: null, race: null, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--date") args.date = argv[++i];
    else if (a === "--venue") args.venue = parseInt(argv[++i], 10);
    else if (a === "--race") args.race = parseInt(argv[++i], 10);
    else if (a === "--dry") args.dry = true;
  }
  if (!args.date) args.date = parseDateArg() || getTodayDateJST();
  return args;
}

async function main() {
  const args = parseArgs();
  const date = args.date;

  console.log(`📅 pcexpect スクレイプ開始: ${date}`);
  if (args.dry) console.log("  🧪 DRY RUN (DB 書き込みスキップ)");

  // --venue + --race が両方指定されていれば Supabase を介さず単発実行
  let schedule;
  if (args.venue && args.race) {
    schedule = [
      { venue_code: args.venue, race_no: args.race, start_time: null },
    ];
  } else {
    schedule = await getRaceSchedule(date);
    if (schedule.length === 0) {
      console.warn(`  ⚠️ ${date} のスケジュールが空のため処理終了`);
      process.exit(0);
    }
    if (args.venue)
      schedule = schedule.filter((r) => r.venue_code === args.venue);
    if (args.race) schedule = schedule.filter((r) => r.race_no === args.race);
  }

  console.log(`  対象レース数: ${schedule.length}`);
  if (!args.dry && !isSupabaseEnabled()) {
    console.error("  ❌ Supabase 未設定。--dry でテスト可");
    process.exit(1);
  }

  let okCount = 0;
  let emptyCount = 0;
  let errCount = 0;

  // 従来どおり、1レースずつ逐次（1秒間隔）で処理する
  const results = await runForRaces(schedule, {
    date,
    mode: args.dry ? "shadow" : "live",
    intervalMs: FETCH_INTERVAL_MS,
  });
  results.forEach((result, i) => {
    const r = schedule[i];
    const label = `${VENUE_NAMES[r.venue_code] || r.venue_code}${r.race_no}R`;
    if (result.outcome === "ok") {
      okCount++;
      const { payload } = result;
      console.log(
        args.dry
          ? `  ✅ ${label}: ${JSON.stringify(payload)}`
          : `  ✅ ${label}: 2t=${payload.focus_2t.length}点 3t=${payload.focus_3t.length}点 lv=${payload.confidence}`,
      );
    } else if (result.outcome === "no_values") {
      emptyCount++;
      console.log(`  ⚪ ${label}: データなし`);
    } else {
      errCount++;
      console.error(`  ❌ ${label}: ${result.error}`);
    }
  });

  console.log(
    `\n📊 完了: 成功 ${okCount} / データなし ${emptyCount} / エラー ${errCount}`,
  );
}

// スタンドアローン実行時のみ実行する（import 時に実行させない。Vercel Function から import される）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("❌ 致命的エラー:", err);
    process.exit(1);
  });
}

export {
  buildUrl,
  fetchHtml,
  parsePcexpect,
  computePcexpectDigest,
  runForRaces,
} from "../lib/pcexpect/scrape.js";
