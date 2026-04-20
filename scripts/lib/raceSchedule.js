/**
 * レーススケジュール管理モジュール
 *
 * 発走時刻ベースのスクレイピング制御に使用する共通モジュール。
 * scrape-odds.js / scrape-exhibition-data.js / scrape-results.js /
 * generate-predictions.js から共通利用する。
 *
 * データソース: Supabase races テーブル（generate-predictions.js が毎朝書き込み）
 */

import { supabase, isSupabaseEnabled } from "./supabaseClient.js";
import { getTodayDateJST } from "./dateUtils.js";

/**
 * 当日のレーススケジュールを Supabase から取得する
 *
 * @param {string} [date] - YYYY-MM-DD形式（省略時は今日のJST日付）
 * @returns {Promise<Array<{race_id: string, venue_code: number, race_no: number, start_time: Date}>>}
 */
export async function getRaceSchedule(date) {
  const targetDate = date || getTodayDateJST();

  if (!isSupabaseEnabled()) {
    console.warn("⚠️ Supabase未設定のためスケジュール取得をスキップ");
    return [];
  }

  const { data, error } = await supabase
    .from("races")
    .select("race_id, start_time")
    .like("race_id", `${targetDate}%`)
    .not("start_time", "is", null);

  if (error) {
    console.error("⚠️ レーススケジュール取得エラー:", error.message);
    return [];
  }

  if (!data || data.length === 0) {
    console.warn(
      `⚠️ ${targetDate} のレースデータが未登録です（朝の初期化前の可能性があります）`,
    );
    return [];
  }

  // start_time "HH:MM:00" を当日 JST の Date オブジェクトに変換
  return data
    .map((r) => {
      const venueCode = parseInt(r.race_id.substring(11, 13), 10);
      const raceNo = parseInt(r.race_id.substring(14, 16), 10);

      // "HH:MM:00" → JST の ISO 文字列経由で Date を生成（hour - 9 の負値リスクを回避）
      const timeStr = r.start_time.substring(0, 5); // "HH:MM"
      const startTime = new Date(`${targetDate}T${timeStr}:00+09:00`);

      return {
        race_id: r.race_id,
        venue_code: venueCode,
        race_no: raceNo,
        start_time: startTime,
      };
    })
    .sort((a, b) => a.start_time - b.start_time);
}

/**
 * 発走 minutesBefore 分前 ±windowMin 分のウィンドウに入るレースを返す
 *
 * 例: getRacesInWindow(schedule, 30, 3)
 *   → 発走27〜33分前のレースを返す
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 * @param {number} minutesBefore - 発走の何分前か
 * @param {number} [windowMin=3] - ウィンドウの幅（±分）
 * @returns {Array}
 */
export function getRacesInWindow(schedule, minutesBefore, windowMin = 3) {
  const now = new Date();
  return schedule.filter((r) => {
    const minBeforeStart = (r.start_time - now) / 1000 / 60;
    return (
      minBeforeStart >= minutesBefore - windowMin &&
      minBeforeStart <= minutesBefore + windowMin
    );
  });
}

/**
 * 発走後 minutesAfter 分以上、maxMinutesAfter 分以内のレースを返す
 *
 * 例: getRacesAfterStart(schedule, 5, 90)
 *   → 発走5〜90分後のレースを返す（結果取得対象）
 * レース結果は通常30分以内に公開される。90分経過後も未公開のレースはスキップ。
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 * @param {number} [minutesAfter=5] - 発走後何分以上経過したか（下限）
 * @param {number} [maxMinutesAfter=90] - 発走後何分以内か（上限）。90分超は取得を諦める
 * @returns {Array}
 */
export function getRacesAfterStart(schedule, minutesAfter = 5, maxMinutesAfter = 90) {
  const now = new Date();
  return schedule.filter((r) => {
    const minAfterStart = (now - r.start_time) / 1000 / 60;
    return minAfterStart >= minutesAfter && minAfterStart <= maxMinutesAfter;
  });
}

/**
 * 発走前のレースを返す（オッズがまだ変動中のレース）
 *
 * 例: getRacesBeforeStart(schedule, 60)
 *   → 発走60分以内のレースを返す（発走済みは除外）
 *
 * @param {Array} schedule - getRaceSchedule() の返り値
 * @param {number} [maxMinutesBefore=Infinity] - 発走まで最大何分前まで対象にするか
 * @returns {Array}
 */
export function getRacesBeforeStart(schedule, maxMinutesBefore = Infinity) {
  const now = new Date();
  return schedule.filter((r) => {
    const minBeforeStart = (r.start_time - now) / 1000 / 60;
    return minBeforeStart > 0 && minBeforeStart <= maxMinutesBefore;
  });
}
