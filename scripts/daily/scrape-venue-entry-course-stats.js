/**
 * 進入コース別選手成績（BOA-293、FR-6 Phase 6c）を対象10会場から日次で取得し、
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
import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { getRaceSchedule } from "../lib/raceSchedule.js";
import {
  VENUE_ENTRY_COURSE_STATS_CONFIG,
  buildEntryCourseUrl,
} from "../lib/venueEntryCourseStats/venueConfig.js";
import { parseEntryCourseHtml } from "../lib/venueEntryCourseStats/parser.js";
import { updateVenueHealth } from "../lib/venueMotorStats/driftHealth.js";

const HEALTH_FILE_PATH = new URL(
  "../../data/analysis/venue-entry-course-stats-health.json",
  import.meta.url,
);

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const FETCH_TIMEOUT_MS = 15000;
// 同一会場ドメインへの連続リクエスト（最大12レース分）への配慮。
// 会場間（別ドメイン）は待機不要（venue_motor_stats.jsと同じ判断）
const SAME_VENUE_REQUEST_DELAY_MS = 300;

function loadHealth() {
  try {
    return JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return await res.text();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("timeout");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// race_entries（当日の出走表）から (race_id, boat_number) -> racer_id の
// マップを作る。会場サイトは選手登録番号を掲載しないため、氏名一致ではなく
// 自社の出走表と突き合わせて解決する
async function buildRacerIdMap(raceIds) {
  if (raceIds.length === 0) return new Map();
  const rows = await fetchAll(
    "race_entries",
    "race_id,boat_number,racer_id",
    (q) => q.in("race_id", raceIds),
  );
  const map = new Map();
  for (const row of rows) {
    map.set(`${row.race_id}:${row.boat_number}`, row.racer_id ?? null);
  }
  return map;
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

    const raceIds = venueRaces.map((r) => r.race_id);
    let racerIdMap;
    try {
      racerIdMap = await buildRacerIdMap(raceIds);
    } catch (error) {
      console.error(
        `  ⚠️ ${venue.name}: race_entries取得エラー（racer_idはNULLのまま続行）:`,
        error.message,
      );
      racerIdMap = new Map();
    }
    // race_entries（当日の出走表）が本日分まだ用意できていない場合、racer_idは
    // 全行NULLのまま静かに保存されうる（サイト側の構造は正常なため、この
    // scriptのhealth判定＝サイト構造監視には含めない。race_entries自体の欠損は
    // 別レイヤーの問題のため、ここではログでのみ可視化する）
    if (raceIds.length > 0 && racerIdMap.size === 0) {
      console.warn(
        `  ⚠️ ${venue.name}: race_entriesが本日分未登録の可能性（racer_idは全行NULLになります）`,
      );
    }

    let venueReason = null;
    let venueRowCount = 0;

    for (let i = 0; i < venueRaces.length; i++) {
      const race = venueRaces[i];
      const url = buildEntryCourseUrl(venue, race.race_no);
      try {
        const html = await fetchHtml(url);
        const { data, statsPeriod, reason } = parseEntryCourseHtml(html);
        if (!data) {
          venueReason = venueReason ?? reason;
          console.log(
            `    ⚠️ ${venue.name} ${race.race_no}R: データなし (${reason})`,
          );
        } else {
          for (const row of data) {
            allRows.push({
              race_id: race.race_id,
              venue_code: venue.venueCode,
              waku: row.waku,
              entry_course: row.entryCourse,
              racer_id: racerIdMap.get(`${race.race_id}:${row.waku}`) ?? null,
              racer_name_raw: row.racerNameRaw,
              entry_rate: row.entryRate,
              avg_st: row.avgSt,
              place_rate_1: row.placeRates[0],
              place_rate_2: row.placeRates[1],
              place_rate_3: row.placeRates[2],
              place_rate_4: row.placeRates[3],
              place_rate_5: row.placeRates[4],
              place_rate_6: row.placeRates[5],
              stats_period_start: statsPeriod.start,
              stats_period_end: statsPeriod.end,
            });
          }
          venueRowCount += data.length;
        }
      } catch (error) {
        venueReason = venueReason ?? error.message;
        console.error(
          `    ❌ ${venue.name} ${race.race_no}R: ${error.message}`,
        );
      }
      if (i < venueRaces.length - 1) await sleep(SAME_VENUE_REQUEST_DELAY_MS);
    }

    health[venue.venueCode] = updateVenueHealth(health[venue.venueCode], {
      success: venueReason === null,
      reason: venueReason,
      date: targetDate,
    });

    if (venueReason === null) {
      console.log(`  ✅ ${venue.name}: ${venueRowCount}件`);
      successVenues++;
    }
  }

  if (allRows.length > 0) {
    console.log(
      `\n💾 venue_entry_course_stats: ${allRows.length}件書き込み中...`,
    );
    for (let i = 0; i < allRows.length; i += 1000) {
      const batch = allRows.slice(i, i + 1000);
      const { error } = await supabase
        .from("venue_entry_course_stats")
        .upsert(batch, { onConflict: "race_id,waku,entry_course" });
      if (error) {
        console.error(
          `❌ venue_entry_course_stats 書き込みエラー:`,
          error.message,
        );
      }
    }
  }

  fs.mkdirSync(new URL(".", HEALTH_FILE_PATH), { recursive: true });
  fs.writeFileSync(HEALTH_FILE_PATH, JSON.stringify(health, null, 2) + "\n");

  console.log(
    `📊 完了: ${successVenues}/${attemptedVenues}会場成功（本日開催なしを除く）、${allRows.length}件保存`,
  );
  return { updated: allRows.length > 0, count: allRows.length };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const date = parseDateArg();
  const schedule = await getRaceSchedule(date);
  run(schedule, date).catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}
