/**
 * レース情報リアルタイム更新スクリプト
 *
 * 発走1時間前のウィンドウで racelist・beforeinfo をスクレイプし、
 * 出場選手情報・天候データを Supabase に更新する。
 * 欠場・代替選手・レース中止の検出もここで行う。
 *
 * scrape-scheduled.yml から5分毎に実行される（1時間前ウィンドウのレースのみ対象）。
 * 実装パターン: scrape-exhibition-data.js に準拠
 *
 * 入口は2つ（取得・解析・行の組み立て・書き込みは共通）:
 *   run          GitHub Actions・CLI。発走60分前ウィンドウのレースを、racelist + beforeinfo（気象）で更新する
 *   runForRaces  Vercel Cron（api/cron/race-info.js）の予定表スロット。指定レースを、racelist のみで更新する
 *                （beforeinfo は展示 A2 が全項目を取るため取らない。気象は展示の取得時の値）
 */

import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getRaceSchedule, getRacesInWindow } from "../lib/raceSchedule.js";
import { scrapeRaceStage } from "../lib/raceStageParser.js";
import { scrapeRaceMeta, scrapeSeriesDay } from "../lib/raceListParser.js";
import { loadSeriesDayByVenue } from "../lib/raceSeriesLookup.js";
import { detectPreRaceSchema } from "../lib/preRaceSchema.js";
import {
  buildStartTimeLookup,
  convertWindDirection,
  scrapeConditions,
} from "../lib/beforeinfoWeather.js";
// 取得は raceInfoFetch.js、集計（書く行をためる・1件の結果）は raceInfoAccumulate.js に置く
import { fetchRaceInfo, fetchRaceInfoDetailed } from "../lib/raceInfoFetch.js";
import {
  accumulateRaceInfo,
  createAccumulator,
} from "../lib/raceInfoAccumulate.js";
import { loadCancellationRows, flushRaceInfo } from "../lib/raceInfoRunForRaces.js";

export { fetchRaceInfoDetailed };

// 発走1時間前ウィンドウ（±3分）
const WINDOW_MINUTES = 60;

/**
 * オーケストレーターから呼び出し可能なレース情報更新処理
 * @param {Array} schedule - getRaceSchedule() の返り値（外部から渡す）
 * @param {string} date - YYYY-MM-DD
 * @param {{dryRun?: boolean, syncDeadlines?: boolean, client?: import("@supabase/supabase-js").SupabaseClient}} [options]
 *   dryRun=trueならDBへ書き込まず、書くはずの件数だけログに出す。
 *   syncDeadlines: 出走表の「締切予定時刻」の行が races.start_time と違うレースの start_time を更新するか
 *   （既定 true。日中の時刻変更への追従。N15）。client: テスト用のSupabaseクライアントの差し替え
 * @returns {Promise<{updated: boolean, count: number, deadlineUpdates?: number}>}
 *   updated/count は「取得できた件数」で、DBへ実際に書いた件数ではない（変更の無い行は
 *   書かないが、後続の予測リフレッシュの起動条件は従来どおり取得ベースのまま変えない）
 */
export async function run(
  schedule,
  date,
  { dryRun = false, syncDeadlines = true, client = supabase } = {},
) {
  // 発走1時間前ウィンドウのレースのみ対象
  const targetRaces = getRacesInWindow(schedule, WINDOW_MINUTES);
  if (targetRaces.length === 0) {
    console.log(
      `📭 レース情報: 発走${WINDOW_MINUTES}分前ウィンドウの対象レースなし`,
    );
    return { updated: false, count: 0 };
  }
  console.log(
    `🎯 レース情報更新: ${targetRaces.length}レース（発走${WINDOW_MINUTES}分前ウィンドウ）`,
  );
  // 気象の観測時刻の解決用（「N R時点」の気象は、Nレース目の発走予定時刻を観測時刻とする）
  const startTimeLookup = buildStartTimeLookup(schedule);

  // 出走表の新しい列（マイグレーション081）が適用済みかを先に判定する。未適用なら、旧実装と同じ列だけを書く
  const preRaceSchema = await detectPreRaceSchema(client);
  // 日目のフォールバック（BOA-501）。開催中の節は最大24行で、1回の実行で1回だけ読む
  const seriesDayByVenue = await loadSeriesDayByVenue(date, { client });

  const { rows: cancellationRows, error: cancellationFetchError } =
    await loadCancellationRows(
      client,
      targetRaces.map((r) => r.race_id),
    );
  const cancellationMap = new Map(cancellationRows.map((r) => [r.race_id, r]));

  const acc = createAccumulator();

  // 会場ごとにグループ化して並列取得
  const byVenue = new Map();
  for (const r of targetRaces) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    byVenue.get(r.venue_code).push(r);
  }

  const venueEntries = [...byVenue.entries()];
  for (let vi = 0; vi < venueEntries.length; vi++) {
    const [venueCode, races] = venueEntries[vi];
    const venueName = VENUE_NAMES[venueCode];

    // 会場内の全レースを並列取得
    const results = await Promise.all(
      races.map((r) =>
        fetchRaceInfo(date, r.venue_code, r.race_no).then((data) => ({
          r,
          data,
        })),
      ),
    );

    for (const { r, data } of results) {
      accumulateRaceInfo(acc, {
        r,
        data,
        // 従来の動作: 取得できなかった（通信の失敗を含む）レースは「選手情報なし」として数える
        cancellationCheck: data ? "found" : "not_found",
        schedule,
        syncDeadlines,
        cancellationMap,
        cancellationFetchError,
        entriesExtended: preRaceSchema.raceEntries,
        conditionsExtended: preRaceSchema.raceConditions,
        includeWeather: true,
        seriesDayByVenue,
      });
      if (data) {
        const racerSummary = data.page.entries
          .map(
            (e) =>
              `${e.boat_number}号艇:${e.player_name ?? "不明"}(${e.grade ?? "??"})`,
          )
          .join(", ");
        console.log(`  ✅ ${venueName} ${r.race_no}R — ${racerSummary}`);
      }
    }

    // 会場間1秒待機（サーバー負荷配慮）
    if (vi < venueEntries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const { updated, count, deadlineUpdates } = await flushRaceInfo(acc, {
    client,
    dryRun,
    date,
    startTimeLookup,
    cancellationRows,
    cancellationFetchError,
    includeWeather: true,
  });
  return { updated, count, deadlineUpdates };
}

/**
 * メイン処理（スタンドアローン実行用）
 */
async function main() {
  console.log("📋 レース情報更新開始");
  console.log(`⏰ ${new Date().toISOString()}`);

  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定です。");
    process.exit(1);
  }

  const date = parseDateArg() || getTodayDateJST();
  console.log(`📅 対象日: ${date}`);

  const schedule = await getRaceSchedule(date);
  if (schedule.length === 0) {
    console.log("📭 対象レースなし（スケジュール未登録）");
    return;
  }
  console.log(`📊 当日レース数: ${schedule.length}件`);

  await run(schedule, date);
  console.log("🏁 完了");
}

export const _internal = {
  scrapeRaceMeta,
  scrapeRaceStage,
  scrapeSeriesDay,
  scrapeConditions,
  convertWindDirection,
};

// スタンドアローン実行時のみ main() を呼ぶ（import 時に実行させない）
if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((err) => {
    console.error("❌ エラー:", err);
    process.exit(1);
  });
}

export { runForRaces } from "../lib/raceInfoRunForRaces.js";
