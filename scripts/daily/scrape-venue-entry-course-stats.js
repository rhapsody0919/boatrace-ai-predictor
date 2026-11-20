/**
 * 進入コース別選手成績（BOA-293、FR-6 Phase 6c）を対象9会場（若松は BOA-1165 で一時除外）から日次で取得し、
 * venue_entry_course_stats テーブルに保存する。
 *
 * 対象会場・除外理由は scripts/lib/venueEntryCourseStats/venueConfig.js 参照。
 * 全会場が完全に同一のURL・テーブル構造（`/modules/raceinfo/?page=index_racecourse`）
 * のため、単一の共有パーサー（parser.js）で対応する（FR-6 Phase 6b）。
 *
 * 会場公式サイトは選手登録番号を掲載しないため、選手の特定は氏名一致ではなく
 * 自社の races/race_entries（当日の出走表）から (race_id, boat_number) で
 * racer_id を引く方式にする。そのため、本日の出走スケジュール（Supabase races
 * テーブルにgenerate-predictions.jsが書き込み済みの前提）が無い会場はスキップする
 * （health記録もしない。「今日は開催が無い」と「取得に失敗した」を区別するため）。
 *
 * 実行タイミング: 日次1回（このデータは選手の全国直近12ヶ月実績であり当日の
 * 結果には依存しないため、当日の出走表さえ確定していればいつ取得しても値は
 * ほぼ変わらない。当日〜翌日程度の鮮度で十分なため、venue_motor_stats等と同様に
 * 1日1回のバッチで足りる。ADR-0058の原則を適用）。
 */
import fs from "node:fs";
import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import { jstMinutesOfDay, toJstDateString } from "../lib/scrapeJobs/time.js";
import {
  VENUE_ENTRY_COURSE_STATS_CONFIG,
} from "../lib/venueEntryCourseStats/venueConfig.js";
import { updateVenueHealth } from "../lib/venueMotorStats/driftHealth.js";
import { scrapeVenue, writeEntryCourseRows } from "../lib/venueEntryCourseStats/scrape.js";

const HEALTH_FILE_PATH = new URL(
  "../../data/analysis/venue-entry-course-stats-health.json",
  import.meta.url,
);

function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    return {};
  }
}

export async function run(schedule, date) {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    return { updated: false, count: 0 };
  }

  const targetDate = date || getTodayDateJST();
  console.log(`🚤 進入コース別選手成績スクレイピング開始 (${targetDate})`);

  const health = loadHealth();
  const allRows = [];
  let attemptedVenues = 0;
  let successVenues = 0;

  for (const venue of VENUE_ENTRY_COURSE_STATS_CONFIG) {
    const venueRaces = schedule.filter((r) => r.venue_code === venue.venueCode);
    if (venueRaces.length === 0) {
      console.log(`  ⏭️ ${venue.name}: 本日開催なし（スキップ）`);
      continue;
    }
    attemptedVenues++;

    const { rows, reason: venueReason } = await scrapeVenue(venue, venueRaces);
    allRows.push(...rows);

    health[venue.venueCode] = updateVenueHealth(health[venue.venueCode], {
      success: venueReason === null,
      reason: venueReason,
      date: targetDate,
    });

    if (venueReason === null) {
      console.log(`  ✅ ${venue.name}: ${rows.length}件`);
      successVenues++;
    }
  }

  // 会場ごとの成否履歴（構造変化の検知の入力）は、DB の書き込みが失敗して例外になっても残すため、先に書く（BOA-391）
  fs.mkdirSync(new URL(".", HEALTH_FILE_PATH), { recursive: true });
  fs.writeFileSync(HEALTH_FILE_PATH, JSON.stringify(health, null, 2) + "\n");

  if (allRows.length > 0) {
    console.log(
      `\n💾 venue_entry_course_stats: ${allRows.length}件書き込み中...`,
    );
    await writeEntryCourseRows(supabase, allRows);
  }

  console.log(
    `📊 完了: ${successVenues}/${attemptedVenues}会場成功（本日開催なしを除く）、${allRows.length}件保存`,
  );
  // 開催会場を1つ以上試したのに、1会場も取得・解析できなかった＝構造変化・取得先の障害。0件保存を成功にしない（BOA-364）
  if (attemptedVenues > 0 && successVenues === 0) {
    throw new Error(
      `${targetDate}: 開催${attemptedVenues}会場すべてで取得・解析に失敗しました`,
    );
  }
  return { updated: allRows.length > 0, count: allRows.length };
}

/**
 * CLI（GitHub Actions。Vercel が不調のときのフォールバック）の対象日（BOA-364）。
 * GitHub Actions の schedule（20:00 JST 指定）は数時間遅れて日付をまたぐことがあり、実行時点の日付だと、
 * races がまだ無い翌日を指して0件になっていた。--date が無ければ、07:00 JST より前の起動は前日、それ以降は当日。
 * Vercel のジョブ（「20:00 の指定時刻」から解決）と違い、20:00 前を前日にしないのは、取得先のURLが日付を持たず
 * （buildEntryCourseUrl）その時点の当日のページを返すため。日中の手動実行が前日を対象にすると、当日の内容を
 * 前日の race_id に上書きしてしまう
 */
export function resolveCliTargetDate(
  args = process.argv.slice(2),
  now = new Date(),
) {
  const LATE_START_UNTIL_JST_MIN = 7 * 60;
  return (
    parseDateArg(args) ??
    (jstMinutesOfDay(now) < LATE_START_UNTIL_JST_MIN
      ? toJstDateString(new Date(now.getTime() - 24 * 60 * 60 * 1000))
      : toJstDateString(now))
  );
}

/** CLI の本体。対象日の races が0件・DB障害は、成功にせず例外にする（BOA-364） */
export async function main({
  args,
  now,
  getSchedule = getRaceSchedule,
  runImpl = run,
} = {}) {
  const date = resolveCliTargetDate(args, now);
  const schedule = await getSchedule(date, { throwOnError: true });
  if (schedule.length === 0) {
    throw new Error(
      `対象日${date}の races が0件です（朝の初期化の失敗、または対象日の誤りの疑い）`,
    );
  }
  return runImpl(schedule, date);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}

export {
  createHtmlFetcher,
  scrapeVenue,
  writeEntryCourseRows,
} from "../lib/venueEntryCourseStats/scrape.js";
