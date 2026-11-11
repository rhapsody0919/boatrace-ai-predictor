// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { getTodayJST } from "../utils/dateUtils.js";
import { supabase } from "./supabaseClient";
import { addDaysToDateString } from "../../scripts/lib/dateUtils.js";
import { meetStartFromRows } from "../utils/meetGrouping";
import { currentMotorGenerationStart } from "../utils/motorGeneration";
import { motorWindowFrom } from "../utils/motorPowerIndex.js";
import {
  chunkArray,
  fetchAllByIn,
  isPermissionDeniedError,
  withCache,
} from "./core.js";

// toReturnRate・aggregateRacerVenueBoatStats・racerHistoryCutoff は src/utils/racerVenueBoatStats.js
// （BOA-1244。選手ページと龍神ボート番付で共有するため手を加えずに移した）

// resultのrank1〜rank6（着順でインデックス、値が艇番）を走査し、boatNumberと
// 一致する着順（1〜6）を返す。actual_course_N（艇番でインデックス、値が
// コース）とは列の向きが逆のため流用不可——進入コースはcourseOfBoat()を使う
export function findBoatColumnIndex(result, columnPrefix, boatNumber) {
  if (!result) return null;
  for (let i = 1; i <= 6; i++) {
    if (result[`${columnPrefix}${i}`] === boatNumber) return i;
  }
  return null;
}

// race_results.actual_course_1〜6（BOA-257、Kファイル由来の実進入コース）から
// 指定艇番の実際の進入コースを取り出す。バックフィル未実行の過去レースでは
// 全列NULLのため、その場合のみ艇番をそのままコース番号とみなす（暫定値、
// plan.mdの「courseColumn」抽象化に相当。BOA-257解消後の新しいレースは
// actual_course_N側が使われ、過去データはフォールバックのみで動く）。
//
// データ精度検証(2026-09-16)で発覚: バックフィル済みレースで一部の艇だけ
// actual_course_Nがnullなのは「欠場等でKファイルに進入コース記載が無い」
// ことを意味する（docs/db-migration/063参照、実データでも
// 2025-12-04-01-11等で確認済み: 3号艇のみnullで他5艇は1-5が埋まっている
// ＝3号艇欠場）。この場合に艇番へフォールバックすると、実際には走っていない
// 艇を実在のコースとして誤集計してしまう。同じレースで1件でも
// actual_course_Nが取得できていれば「バックフィル済み」と判断し、
// 艇番フォールバックはせずnull（集計除外）を返す
export function courseOfBoat(result, boatNumber) {
  const actualCourse = result?.[`actual_course_${boatNumber}`];
  if (actualCourse !== null && actualCourse !== undefined) return actualCourse;

  const isBackfilled = [1, 2, 3, 4, 5, 6].some((n) => {
    const v = result?.[`actual_course_${n}`];
    return v !== null && v !== undefined;
  });
  // バックフィル済みなのにこの艇だけnull = 欠場のため集計から除外(null)。
  // 未バックフィル(全列null)の場合のみ艇番を暫定コースとして使う
  return isBackfilled ? null : boatNumber;
}

/**
 * getRaceMotorMaintenanceBreakdown の戻り値を作る（BOA-497）。
 *
 * exhibition_data は1レースの中で段階的に埋まる。展示前は行が無いか、当日体重・調整重量
 * だけの行（BOA-500）、会場によっては展示タイムより先に展示STだけの行（BOA-356）。
 * チルト・展示タイム・展示進入はその後に同じ行へ入る。
 * 途中の状態をキャッシュすると、値が入った後も本日分は30分、リロードしても「—」のまま出る。
 *
 *   { state: "complete", rows }                      6艇以上の行があり、欠場以外の全艇に展示タイムがある
 *   { state: "partial",  rows, fetchFailed: true }   それ以外（展示前・書き込み途中・欠測）
 * partial は fetchFailed を付けて withCache に保存させない（frontend-data-fetch.md §4）。
 * 確定後も揃わないレース（欠測・取得漏れ）は毎回取り直すが、1クエリなので許容する。
 * 行の中身は state によらず同じで、画面は rows だけを見る
 */
const FULL_FIELD_SIZE = 6;
export function toMaintenanceResult(rows) {
  const complete =
    rows.length >= FULL_FIELD_SIZE &&
    rows.every((row) => row.is_absent === true || row.exhibition_time != null);
  return complete
    ? { state: "complete", rows }
    : { state: "partial", rows, fetchFailed: true };
}

/**
 * 過去レースのモータ情報を「そのレースの直前まで」で集計するときの、キャッシュの
 * キーの接尾辞（BOA-521）。末尾が race_id になるので、inferTtlFromKey() が
 * 過去レースとして長いTTLを付ける（締め切った集計は後から変わらない）
 */
export function beforeKey(beforeRaceId) {
  return beforeRaceId ? `-before-${beforeRaceId}` : "";
}

/**
 * includeTarget（beforeRaceId のレース自身も含める。BOA-1297）のときだけ付けるキーの
 * 接尾辞。beforeKey より前に置いて、キーの末尾を race_id のままにする
 */
export function includeKey(beforeRaceId, includeTarget) {
  return beforeRaceId && includeTarget ? "-incl" : "";
}

async function fetchRacesForVenueSince(venueCode, cutoff, untilDate = null) {
  if (!supabase) return [];

  // BOA-301データ精度検証(2026-09-16)で発覚: Supabaseのデフォルトlimit(1000行)
  // により、1日十数レース開催する会場では180日窓で1000件を超え(実測: 常滑180日
  // 1368件)、.range()無しでは黙って切り捨てられていた。getMotorConditionTrend等
  // 既存の呼び出し元も含め、この関数を経由する全ての集計に影響するため
  // fetchAllByIn等と同じページネーションに修正する
  const allData = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("races")
      .select("race_id, race_date")
      .eq("venue_code", venueCode)
      .gte("race_date", cutoff)
      .lte("race_date", untilDate ?? "9999-12-31")
      // 同じ日のレースは race_date だけでは順序が決まらず、ページ境界で行が
      // 重複・欠落しうる。race_id で一意に並べる（世代全体＝最長約1年分、
      // 徳山で2148件＝3ページを読むようになったため）
      .order("race_date")
      .order("race_id")
      .range(from, from + pageSize - 1);

    if (!data || data.length === 0) break;
    allData.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allData;
}

/**
 * 会場の、指定日（YYYY-MM-DD、当日を含む）以降のレース（BOA-151、複数メソッドで
 * 共有するためキャッシュする）。モーターの集計は、期間の開始を現行モーターの世代で
 * 切り詰めた日（motorWindowStart）から呼ぶ。
 * beforeRaceId を渡すと、そのレースより前（race_id < beforeRaceId）に限る（BOA-521。
 * 会場を固定すれば race_id の文字列順は時系列順と一致するので、同じ日のそれより
 * 後のレースと、そのレース自身は入らない）
 * includeTarget: true を渡すと、beforeRaceId のレース自身も含める（race_id <=。
 * BOA-1297 の「交換N」は対象レースの展示も数える）。既定（false）は上の動き。
 * beforeRaceId が null のときは意味を持たない
 */
export function getRacesForVenueSince(
  venueCode,
  sinceDate,
  beforeRaceId = null,
  { includeTarget = false } = {},
) {
  return withCache(
    // "-incl" は beforeKey より前に置く（末尾を race_id に保ち、inferTtlFromKey の過去レース判定を効かせる）
    `races-for-venue-since-${venueCode}-${sinceDate}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
    async () => {
      const races = await fetchRacesForVenueSince(
        venueCode,
        sinceDate,
        beforeRaceId?.slice(0, 10) ?? null,
      );
      if (beforeRaceId === null) return races;
      return includeTarget
        ? races.filter((r) => r.race_id <= beforeRaceId)
        : races.filter((r) => r.race_id < beforeRaceId);
    },
  );
}

/**
 * 会場の現行モーター世代の開始日（venue_motor_start_dates の最新の使用開始日）。
 * 行が無い会場・匿名に権限が無い場合（マイグレーション104が外された場合）は null
 * （＝世代が分からない）。それ以外の取得エラーは例外にする（呼び出し側で
 * 「取得失敗」と「世代不明」を出し分けるため）
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
export async function getMotorGenerationStart(venueCode) {
  const cached = await withCache(
    `motor-generation-start-${venueCode}`,
    async () => {
      try {
        const { data } = await supabase
          .from("venue_motor_start_dates")
          .select("start_date")
          .eq("venue_code", venueCode);
        return { generationStart: currentMotorGenerationStart(data) };
      } catch (err) {
        if (isPermissionDeniedError(err)) return { generationStart: null };
        throw err;
      }
    },
  );
  return cached.generationStart;
}

/**
 * 会場の、その日を含む節の初日（BOA-830。公式の2連率は「前の節まで」の走りで出ているので、
 * 何走で出た数字かを数える起点）。種別（race_conditions）の series_day・is_final_day・
 * 開催日の空きから meetStartFromRows で決める（getMeetScoreboard と同じ）。
 * 種別が1行も無ければ null
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
export async function getVenueMeetStart(venueCode, date) {
  const cached = await withCache(
    `venue-meet-start-${venueCode}-${date}`,
    async () => {
      const vv = String(venueCode).padStart(2, "0");
      const { data } = await supabase
        .from("race_conditions")
        .select("race_id, series_day, is_final_day")
        .gte("race_id", addDaysToDateString(date, -12))
        .lte("race_id", `${date}-zz`)
        .like("race_id", `__________-${vv}-__`);
      // 開催日は種別の行の日付（出走表は読まない）
      const rows = data ?? [];
      return {
        meetStart: meetStartFromRows(
          rows.map((c) => c.race_id.slice(0, 10)),
          rows,
          date,
        ),
      };
    },
  );
  return cached.meetStart;
}

/**
 * その日のその会場で、公式のモーター2連率が全行 0 か（BOA-830。新しいモーターの最初の節）。
 * 1行でも 0 より大きければ false
 */
export async function isAllOfficialMotorRateZero(venueCode, date) {
  const cached = await withCache(
    `venue-official-motor-zero-${venueCode}-${date}`,
    async () => {
      const vv = String(venueCode).padStart(2, "0");
      const { data } = await supabase
        .from("race_entries")
        .select("race_id")
        .like("race_id", `${date}-${vv}-__`)
        .gt("motor_2rate", 0)
        .limit(1);
      return { allZero: (data ?? []).length === 0 };
    },
  );
  return cached.allZero;
}

/**
 * モーターの成績を「過去days日」で集計するときの開始日。現行モーターの世代
 * （使用開始日以降）で切り詰める（BOA-329）。入れ替え前の同じ番号の別モーターを
 * 混ぜないため。
 * - since: max(使用開始日, 基準日−days)。使用開始日が不明なら null（集計しない）
 * - clippedByGeneration: 使用開始日で切り詰めたか（画面で注記を出す）
 * 基準日は今日（JST）。beforeRaceId を渡すとそのレースの日付（BOA-521。過去レースの
 * ドリルダウンを「そのレースの直前まで」で集計する）
 * 使用開始日の取得エラー（権限以外）は例外にする
 * @returns {Promise<{since:string|null, generationStart:string|null, clippedByGeneration:boolean}>}
 */
export async function motorWindowStart(venueCode, days, beforeRaceId = null) {
  const generationStart = await getMotorGenerationStart(venueCode);
  // 期間の計算は src/utils/motorPowerIndex.js（BOA-1245。龍神ボート番付と共有するため手を加えずに移した）
  return motorWindowFrom(
    generationStart,
    days,
    beforeRaceId === null ? getTodayJST() : beforeRaceId.slice(0, 10),
  );
}

export const NEUTRAL_EXHIBITION_DIFF_SEC = 0.02; // これ未満は展示タイムの日次ブレの範囲内とみなす
export const INTERPRETATION_WINDOW_DAYS = 3; // 前後何日分の平均で比較するか

/**
 * 指定会場・モーター番号の日次系列（race_entries+exhibition_data結合、日付単位
 * dedupe済み）を取得する内部共通ヘルパー。getMotorConditionTrend/
 * getMotorPartsHistoryの両方が同じrace_entries+exhibition_data結合パターンを
 * 必要とするため共通化（BOA-221）。withCacheで結果を共有することで、両関数が
 * 同じ(venueCode, motorNumber, days)を同時に要求した場合の二重フェッチも防ぐ
 */
export function fetchMotorDailySeries(
  venueCode,
  motorNumber,
  days,
  beforeRaceId = null,
  { includeTarget = false } = {},
) {
  return withCache(
    // v2: 期間を現行モーターの世代で切り詰め、{window, series}を返す（BOA-329）
    // v3: 部品交換・プロペラ交換が記録されたレース番号（eventRaceNos）を追加（BOA-513）
    `motor-daily-series-v3-${venueCode}-${motorNumber}-${days}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
    async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return { window: null, series: [] };
      }

      const window = await motorWindowStart(venueCode, days, beforeRaceId);
      if (window.since === null) return { window, series: [] };
      const races = await getRacesForVenueSince(
        venueCode,
        window.since,
        beforeRaceId,
        { includeTarget },
      );
      if (races.length === 0) return { window, series: [] };

      const raceDateById = new Map(races.map((r) => [r.race_id, r.race_date]));
      const raceIds = races.map((r) => r.race_id);
      const chunks = chunkArray(raceIds, 500);

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("race_entries")
            .select("race_id, boat_number, motor_2rate, motor_3rate")
            .in("race_id", chunk)
            .eq("motor_number", motorNumber)
            .order("race_id"),
        ),
      );
      let entries = [];
      results.forEach(({ data }) => {
        entries = entries.concat(data);
      });
      if (entries.length === 0) return { window, series: [] };

      const exhibitionRows = await fetchAllByIn(
        "exhibition_data",
        "race_id, boat_number, exhibition_time, propeller_change, parts_changed",
        "race_id",
        entries.map((e) => e.race_id),
      );
      const exhibitionByKey = new Map(
        exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
      );

      // 日付単位でdedupe。motor_2rate/motor_3rate/exhibitionTimeは節単位でほぼ
      // 一定のためrace_idで安定ソート済みの先頭を採用するが、部品交換・プロペラ
      // 交換は「同日の特定の1レースだけに記録されるイベント」のため先頭決め打ちでは
      // 取りこぼす（例: 同日中の途中交換で、交換後のレースにしか記録されない）。
      // 同日の全レース分をOR/合算してdedupeする
      const byDate = new Map();
      entries
        .map((e) => ({
          ...e,
          race_date: raceDateById.get(e.race_id),
          exhibition: exhibitionByKey.get(`${e.race_id}-${e.boat_number}`),
        }))
        .filter((e) => e.race_date)
        .sort(
          (a, b) =>
            a.race_date.localeCompare(b.race_date) ||
            a.race_id.localeCompare(b.race_id),
        )
        .forEach((e) => {
          const propellerChanged = !!e.exhibition?.propeller_change;
          const parts = e.exhibition?.parts_changed ?? null;
          // 交換が記録されたレース番号。同じ日に何Rの前の交換かを画面で示す
          // （展示は各レースの前に行うので、そのレースの前に交換したことになる。BOA-513）
          const eventRaceNo =
            propellerChanged || (parts && parts.length > 0)
              ? Number(e.race_id.slice(-2))
              : null;
          const existing = byDate.get(e.race_date);
          if (!existing) {
            byDate.set(e.race_date, {
              date: e.race_date,
              motor_2rate: e.motor_2rate,
              motor_3rate: e.motor_3rate,
              exhibitionTime: e.exhibition?.exhibition_time ?? null,
              propellerChanged,
              parts,
              eventRaceNos: eventRaceNo === null ? [] : [eventRaceNo],
            });
            return;
          }
          if (eventRaceNo !== null) existing.eventRaceNos.push(eventRaceNo);
          existing.propellerChanged =
            existing.propellerChanged || propellerChanged;
          if (parts && parts.length > 0) {
            existing.parts = [
              ...new Set([...(existing.parts ?? []), ...parts]),
            ];
          }
        });

      return { window, series: [...byDate.values()] };
    },
  );
}
