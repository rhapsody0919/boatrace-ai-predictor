/**
 * Supabase データサービス
 *
 * Supabaseからデータを取得し、既存のJSON形式に変換して返す
 * Phase 2: Edge API経由でCDNキャッシュを活用
 */

import { getTodayJST } from "../utils/dateUtils.js";
import { supabase } from "./supabaseClient";
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";
import { addDaysToDateString } from "../../scripts/lib/dateUtils.js";
import {
  // getCurrentMeetFlyingBoats（今節F）が使う。#1002（BOA-591）でこの import を
  // groupIntoMeetBeforeRace に置き換えたあとに #999（BOA-440）が入り、本番で
  // 「groupIntoCurrentMeet is not defined」になって今節の印が全レースで消えていた
  groupIntoCurrentMeet,
  groupIntoMeetBeforeRace,
  meetStartFromRows,
  seriesDayByDate,
} from "../utils/meetGrouping";
import { isWithinFreshMotorWindow } from "../utils/motorFreshRate.js";
import {
  currentMotorGenerationStart,
  isInMotorGeneration,
} from "../utils/motorGeneration";
import { isFinalStage } from "../constants/raceStageConfig";
import { isRaceCancelled } from "../utils/raceCancellation.js";
import {
  meetDaysOf,
  meetPageState,
  pickMeetAnchor,
  buildQualifiers,
  officialAsOfDate,
} from "../utils/meetPageModel.js";
import { meetExclusionsOf } from "./meetExclusion.js";
import { competitionRank } from "../utils/competitionRank.js";
import {
  VENUE_SITE_STATS_HIDDEN,
  rankBy,
  currentSeriesRiders,
  currentSeriesRange,
} from "../utils/venueMotorRanking.js";
import {
  countsForSeriesScore,
  shouldUseOfficialSeries,
  prelimOfficialAdjustments,
  prelimEndRaceIdOf,
  prelimEndDayOf,
  noRaceDaysOf,
  semifinalSlotsOf,
  splitMeetSeries,
  scoreTableFor,
  isAbsentStartRow,
  postPrelimFlyingRacerIds,
  runFinishLabel,
  officialMarkOf,
} from "../components/race/seriesPoints.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import {
  PRETEST_LOOKBACK_DAYS,
  pickMeetPretestByRacer,
  pickLatestPretestByRacer,
  shiftDate,
} from "../utils/pretestRows";
import {
  pastMotorRows,
  recalcMotorRows,
  settleMotorBreakdown,
} from "../pure/raceMotorBreakdown.js";
import {
  computeMotorPowerIndex,
  motorWindowFrom,
} from "../utils/motorPowerIndex.js";
import {
  chunkArray,
  fetchAllByIn,
  isPastRace,
  isPermissionDeniedError,
  withCache,
} from "./core.js";
import {
  getAvailableDates,
  getMorningDigest,
  getRaceHistorySummary,
  getRaces,
  getSeriesOfDate,
  getTodaysRacesForVenue,
  getUpcomingSeries,
  getVenuesWithTodaysRaces,
} from "./scheduleQueries.js";
export {
  clearCache,
  FETCH_ALL_BY_IN_ORDER,
  aggregateRacerCrossStats,
} from "./core.js";
import { getPredictions } from "./predictionQueries2.js";
import { getAccuracy, getUnifiedModelAccuracy } from "./predictionQueries3.js";
import {
  getInCautionAccuracy,
  getUnifiedTrifectaReference,
  getUnifiedVolatilityAccuracy,
} from "./predictionQueries4.js";
import {
  getCourseWinRateBaseline,
  getNationalAverageOutcomeDistribution,
  getOutcomeDistribution,
  getVenueCharacteristics,
  getVenueTechniquePeriodStats,
  getWinningTechniqueStats,
} from "./venueQueries.js";
import {
  getLosingTechniqueStats,
  getStCourseBaseline,
  getTodaysVenueRanking,
  getTopStartStats,
  getVenueDaySummary,
  getVenueFirstWinRateRanking,
} from "./venueQueries2.js";
import {
  getExhibitionTimeTopStats,
  getNigeOutcomeDistribution,
  getNigeSimulation,
  getVenueGradeBoatStats,
  getVenuesWithGradeStats,
} from "./venueQueries3.js";
import {
  getRaceEntryOfficialRatesBreakdown,
  getRaceRacerFormBreakdown,
  getRaceStPredictabilityBreakdown,
  getRaceWinnerCourses,
} from "./raceQueries.js";
import {
  getRaceEntryWeights,
  getRaceExhibitionBasics,
  getRaceExhibitionTimeBreakdown,
  getRaceOddsSnapshots,
  getRaceOfficialAvgSt,
  getRaceRacerStats,
} from "./raceQueries2.js";
import {
  getRaceEntriesDetail,
  getRaceFinalOdds,
  getRaceRacerBoatReturnRate,
  getRaceResultSummary,
  getRaceTechniqueProfileBreakdown,
} from "./raceQueries3.js";
import {
  getRaceOriginalExhibition,
  getRacePitReport,
  getRaceStartTimings,
} from "./raceQueries4.js";
import {
  getAllRacersLite,
  getAllRacersWithGrade,
  getRacerAggregatedStats,
  getRacerAllPeriodStats,
  getRacerFormSummary,
  getRacerFormTrend,
  getRacerGradeCache,
  getRacerOfficialAvgSt,
  getRacerTechniqueProfile,
} from "./racerQueries.js";
import {
  getRacerRaceHistory,
  getRacerScopedRaceStats,
  getRacerVenueStats,
} from "./racerQueries2.js";
import {
  getExhibitionTimeTrend,
  getRacerBoatReturnRate,
  getStDeviationTrend,
  getTodaysRacerFormRanking,
} from "./racerQueries3.js";
import {
  getRacerAccidentRecords,
  getRacerPeriodStats,
} from "./racerQueries4.js";

// toReturnRate・aggregateRacerVenueBoatStats・racerHistoryCutoff は src/utils/racerVenueBoatStats.js
// （BOA-1244。選手ページと龍神ボート番付で共有するため手を加えずに移した）

// resultのrank1〜rank6（着順でインデックス、値が艇番）を走査し、boatNumberと
// 一致する着順（1〜6）を返す。actual_course_N（艇番でインデックス、値が
// コース）とは列の向きが逆のため流用不可——進入コースはcourseOfBoat()を使う
function findBoatColumnIndex(result, columnPrefix, boatNumber) {
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
function courseOfBoat(result, boatNumber) {
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
function toMaintenanceResult(rows) {
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
function beforeKey(beforeRaceId) {
  return beforeRaceId ? `-before-${beforeRaceId}` : "";
}

/**
 * includeTarget（beforeRaceId のレース自身も含める。BOA-1297）のときだけ付けるキーの
 * 接尾辞。beforeKey より前に置いて、キーの末尾を race_id のままにする
 */
function includeKey(beforeRaceId, includeTarget) {
  return beforeRaceId && includeTarget ? "-incl" : "";
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
function getRacesForVenueSince(
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
 * 会場の現行モーター世代の開始日（venue_motor_start_dates の最新の使用開始日）。
 * 行が無い会場・匿名に権限が無い場合（マイグレーション104が外された場合）は null
 * （＝世代が分からない）。それ以外の取得エラーは例外にする（呼び出し側で
 * 「取得失敗」と「世代不明」を出し分けるため）
 * @returns {Promise<string|null>} YYYY-MM-DD
 */
async function getMotorGenerationStart(venueCode) {
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
async function getVenueMeetStart(venueCode, date) {
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
async function isAllOfficialMotorRateZero(venueCode, date) {
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
async function motorWindowStart(venueCode, days, beforeRaceId = null) {
  const generationStart = await getMotorGenerationStart(venueCode);
  // 期間の計算は src/utils/motorPowerIndex.js（BOA-1245。龍神ボート番付と共有するため手を加えずに移した）
  return motorWindowFrom(
    generationStart,
    days,
    beforeRaceId === null ? getTodayJST() : beforeRaceId.slice(0, 10),
  );
}

const NEUTRAL_EXHIBITION_DIFF_SEC = 0.02; // これ未満は展示タイムの日次ブレの範囲内とみなす
const INTERPRETATION_WINDOW_DAYS = 3; // 前後何日分の平均で比較するか

/**
 * 指定会場・モーター番号の日次系列（race_entries+exhibition_data結合、日付単位
 * dedupe済み）を取得する内部共通ヘルパー。getMotorConditionTrend/
 * getMotorPartsHistoryの両方が同じrace_entries+exhibition_data結合パターンを
 * 必要とするため共通化（BOA-221）。withCacheで結果を共有することで、両関数が
 * 同じ(venueCode, motorNumber, days)を同時に要求した場合の二重フェッチも防ぐ
 */
function fetchMotorDailySeries(
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

/**
 * Supabase データサービス
 */
export const supabaseDataService = {
  getRaces,
  getUpcomingSeries,
  getSeriesOfDate,
  getRaceWinnerCourses,
  getPredictions,
  getAccuracy,
  getAvailableDates,
  getRaceHistorySummary,
  getVenueTechniquePeriodStats,
  getVenueCharacteristics,
  getNationalAverageOutcomeDistribution,
  getOutcomeDistribution,
  getWinningTechniqueStats,
  getVenuesWithTodaysRaces,
  getTodaysRacesForVenue,
  getRaceEntryOfficialRatesBreakdown,

  /**
   * 今期のF（`f_count`）のうち1本を**今節**で切った艇番を返す（BOA-440）。
   *
   * 出走表の「F1」だけでは、半年前のFか今節のFか分からない。今節のFは
   * 当日のスタート勘に直結するため、Fバッジに「今節」の印を付ける材料にする。
   *
   * - 対象は `f_count >= 1` の艇だけ。F0の艇にはバッジ自体が無い
   * - 見るのは**前日まで**の走。`f_count` は朝の出走表の値で、同じ日の前のレースで
   *   切ったFは含まない（実測: Fの翌日の出走表では15件中15件で1本増えていた）。
   *   同じ日のFを拾うと「F1 今節」の1本が別のFを指してしまう
   * - 節の範囲は `groupIntoCurrentMeet` を**選手＋会場**で絞って推定する
   *   （`basicInfoStats.buildMeetResults` と同じ絞り方。meetGrouping.js の前提）
   *
   * @returns {Promise<number[]>} 今節にFがある艇番
   */
  getCurrentMeetFlyingBoats(raceId) {
    return withCache(`race-current-meet-flying-${raceId}`, async () => {
      if (!supabase) {
        console.error("Supabase client not initialized");
        return [];
      }
      const date = raceId.slice(0, 10);
      const venue = raceId.slice(11, 13);

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, racer_id, f_count")
        .eq("race_id", raceId);
      const targets = (entries ?? []).filter(
        (e) => e.racer_id != null && (e.f_count ?? 0) >= 1,
      );
      if (targets.length === 0) return [];

      // 節は長くて7日。前後の空き（2日）を見分けるのに足りる幅を取る
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 14);
      const { data: past } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, boat_number")
        .in(
          "racer_id",
          targets.map((e) => e.racer_id),
        )
        .gte("race_id", from.toISOString().slice(0, 10))
        .lt("race_id", raceId);

      const meetRunsByRacer = new Map(
        targets.map((e) => {
          const upto = (past ?? [])
            .filter(
              (r) =>
                r.racer_id === e.racer_id && r.race_id.slice(11, 13) === venue,
            )
            .sort((a, b) => a.race_id.localeCompare(b.race_id));
          const meet = groupIntoCurrentMeet([
            ...upto,
            { race_id: raceId, anchor: true },
          ]).filter((r) => !r.anchor && r.race_id.slice(0, 10) < date);
          return [e.racer_id, meet];
        }),
      );
      const meetRaceIds = [
        ...new Set([...meetRunsByRacer.values()].flat().map((r) => r.race_id)),
      ];
      if (meetRaceIds.length === 0) return [];

      const { data: flying } = await supabase
        .from("race_start_timings")
        .select("race_id, boat_number")
        .in("race_id", meetRaceIds)
        .eq("is_flying", true);
      const flew = new Set(
        (flying ?? []).map((r) => `${r.race_id}#${r.boat_number}`),
      );

      return targets
        .filter((e) =>
          meetRunsByRacer
            .get(e.racer_id)
            .some((r) => flew.has(`${r.race_id}#${r.boat_number}`)),
        )
        .map((e) => e.boat_number)
        .sort((a, b) => a - b);
    });
  },

  /**
   * 各艇の**今節の前走**（同じ会場・同じ節で、表示中のレースより前の最後の走）を返す
   * （BOA-610、データ出走表の「今節の前走」行）。
   *
   * 以前この行は exhibition_data.prev_*（公式の直前情報の前走）を出していたが、
   * それは「同じ日の前の走」で、前日までの走が入らない。節の2日目以降でも、
   * その日の1走目は空になる（2026-09-30 児島7R の西村拓也は 9/29 10R を走っているのに空）。
   * 節の切り方は `groupIntoMeetBeforeRace`（今節タブ・今節展示情報と同じ。選手＋会場＋目印）。
   *
   * 戻り値は艇ごとに1行:
   *   { boat_number, firstOfMeet: true }                       今節の走がまだ無い
   *   { boat_number, raceId, boatNumber, result, finishMark }  前走（result は race_results の1行か null）
   * 中止になったレース（`isRaceCancelled`）は走っていないので飛ばす。
   * 前走の結果がまだ無い行があるとき（同じ日の直前のレースが確定前）は `fetchFailed: true` を
   * 付けて withCache に焼き付けない（frontend-data-fetch.md §4）
   *
   * @returns {Promise<{rows: Array<Object>, fetchFailed?: boolean}>}
   */
  getRaceMeetPrevRuns(raceId) {
    return withCache(`race-meet-prev-runs-v2-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      const date = raceId.slice(0, 10);
      const venue = raceId.slice(11, 13);

      const { data: entries } = await supabase
        .from("race_entries")
        .select("boat_number, racer_id")
        .eq("race_id", raceId);
      const targets = (entries ?? []).filter((e) => e.racer_id != null);
      if (targets.length === 0) return { rows: [] };

      // 節は長くて7日。前後の空き（2日）を見分けるのに足りる幅を取る
      // （getCurrentMeetFlyingBoats と同じ）。6選手×14日なら1000行に届かない
      const from = new Date(`${date}T00:00:00Z`);
      from.setUTCDate(from.getUTCDate() - 14);
      const { data: past } = await supabase
        .from("race_entries")
        .select("race_id, racer_id, boat_number")
        .in(
          "racer_id",
          targets.map((e) => e.racer_id),
        )
        // `%-VV-%` だと月の部分（-09-）にも当たるので桁で位置を固定する
        .like("race_id", `__________-${venue}-__`)
        .gte("race_id", from.toISOString().slice(0, 10))
        .lt("race_id", raceId);

      const meetByBoat = new Map(
        targets.map((e) => [
          e.boat_number,
          groupIntoMeetBeforeRace(
            (past ?? []).filter((r) => r.racer_id === e.racer_id),
            raceId,
          ),
        ]),
      );
      const meetRaceIds = [
        ...new Set([...meetByBoat.values()].flat().map((r) => r.race_id)),
      ];
      if (meetRaceIds.length === 0) {
        return {
          rows: targets.map((e) => ({
            boat_number: e.boat_number,
            firstOfMeet: true,
          })),
        };
      }

      // 中止になったレースにも出走表の行は残る（結果の行は無い）。節の走を全部引いて、
      // 中止を飛ばした最後の走を前走にする（中止を拾うと結果が来ないまま「—」が残る）
      const [{ data: results }, { data: timings }, { data: races }] =
        await Promise.all([
          supabase
            .from("race_results")
            .select(
              "race_id, rank1, rank2, rank3, rank4, rank5, rank6, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
            )
            .in("race_id", meetRaceIds),
          supabase
            .from("race_start_timings")
            .select("race_id, boat_number, finish_mark, entry_course")
            .in("race_id", meetRaceIds),
          supabase
            .from("races")
            .select("race_id, cancellation_status")
            .in("race_id", meetRaceIds),
        ]);
      const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
      const statusById = new Map(
        (races ?? []).map((r) => [r.race_id, r.cancellation_status]),
      );
      const timingByKey = new Map(
        (timings ?? []).map((r) => [`${r.race_id}#${r.boat_number}`, r]),
      );

      const rows = targets.map((e) => {
        const prev = meetByBoat.get(e.boat_number).findLast(
          (r) =>
            !isRaceCancelled({
              cancellationStatus: statusById.get(r.race_id) ?? null,
              result: resultById.get(r.race_id) ?? null,
            }),
        );
        if (!prev) return { boat_number: e.boat_number, firstOfMeet: true };
        return {
          boat_number: e.boat_number,
          raceId: prev.race_id,
          boatNumber: prev.boat_number,
          result: resultById.get(prev.race_id) ?? null,
          finishMark:
            timingByKey.get(`${prev.race_id}#${prev.boat_number}`)
              ?.finish_mark ?? null,
          entryCourse:
            timingByKey.get(`${prev.race_id}#${prev.boat_number}`)
              ?.entry_course ?? null,
        };
      });
      const pending = rows.some((r) => !r.firstOfMeet && !r.result);
      return pending ? { rows, fetchFailed: true } : { rows };
    });
  },

  /**
   * 指定レースの枠番別モーター調子（2連率/3連率）を取得する（BOA-151）
   * 「このレースのどの艇のモーターが調子いいか」を直接示す
   * venueCodeを渡すと各艇のモーターの機力指数（BOA-265）も合わせて取得する
   *
   * ## 前検タイムと「節時点の公式2連率」（BOA-451 / FR-4a）
   *
   * この関数が返す `motor_2rate` は**選択期間（過去90日・直近1ヶ月）で再計算した値**に
   * 差し替えている（下の注記）。一方、出走表に印刷され他サイトにも載っている
   * 「モーター2連対率」は**節の開始時点（前検日）の公式値**で、両者は別物。
   * 同じタブの中で見比べられないと「なぜ基本情報タブと数字が違うのか」になるため、
   * 差し替え前の公式値を `official_2rate` として残す（**追加クエリ0本**。
   * `race_entries` から既に取っている値をそのまま持ち回るだけ）。
   *
   * 前検タイム（`pretest_time` / `pretest_rank`）は機力の**起点**で、
   * `motor_pretest_stats` から**1クエリ**で節の全選手分を引く。
   *
   * 行の選び方（実測で決めた。2026-09-28）:
   *   同じ会場・同じ選手で `race_date <= 表示レースの日付` かつ `>= 日付 - 6日` の
   *   **最新の行**を採る。理由は3つとも実データで確かめた。
   *     1. 節の中で `pretest_time` / `pretest_rank` が変わる例は **0件**
   *        （31,268の連続区間すべてで単一値）。どの行を採っても値は同じ
   *     2. 6日ルックバックで、**その日に走る選手について前の節の行を引く例は0件**
   *        （2026年1月〜9月の出走241,427件。採った行のモーター番号が
   *        `race_entries.motor_number` と食い違う例も9月の24,842件で0件）。
   *        返るMap自体には「前の節にしか出ていない選手」の行が残ることはあるが、
   *        引き当てには使われない（詳細は `src/utils/pretestRows.js`）
   *     3. 日付完全一致だけだと当たるのは30.9%（節の中の一部の日にしか行が無い）。
   *        6日ルックバックで94.6%に上がる
   *   今節タブ（`getMeetScoreboard`）は「節の最も古い行」を採るが、1の理由で
   *   両者は必ず同じ値になる。`npm run verify:pretest-row-pick` がこの不変条件を守る
   *
   * ## 過去レースは出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）
   *
   * 再計算（機力指数・期間の2連率）は「今日から遡るN日」の集計なので、過去レースに
   * 使うとレース後のデータが混ざり、入れ替え前のレースでは別モーターの成績になる。
   * そのため過去レース（race_idの日付 < 今日JST）では再計算をせず、
   * - motor_2rate / motor_3rate は race_entries の値（そのレース時点の公式値）のまま
   * - power_index は null（公式に相当する値が無い。画面は「—」と注記）
   * - 優出・優勝・1着率は、レース日以前で最新の venue_motor_stats（公式サイトの
   *   その時点のスナップショット）。無ければ null
   * とし、rate_source: "official" を付ける（当日以降は "recalc"）。
   * 当日のレースの再計算は、期間を現行モーターの世代で切り詰める（getMotorPowerIndex）
   *
   * 戻り値は `{ rows, fetchFailed? }`。会場公式サイトのモーター成績（優出・優勝・1着率・出走数）の取得に
   * 失敗した行は `venue_stats_failed: true` を付け、そのときは fetchFailed を付けて withCache に保存させない
   * （BOA-740。他の列は出し、その列だけ「取得失敗」と表示する）
   * @returns {Promise<{rows: Array<Object>, fetchFailed?: boolean}>}
   */
  getRaceMotorBreakdown(raceId, venueCode = null, days = 90) {
    const past = isPastRace(raceId);
    return withCache(
      // raceIdを末尾に置く: inferTtlFromKey()は末尾の「YYYY-MM-DD-会場-レース番号」
      // パターンで過去レースを検知し7日キャッシュを付与する。venueCode/daysを
      // 末尾に付けるとこのパターンにマッチしなくなり、過去レースでも30分キャッシュに
      // 格下げされてしまうため、raceIdより前に置く。
      // v2: motor_2rate/3rateを選択期間に応じた値に差し替えるよう変更(BOA-283)。
      // v3: 優出回数・優勝回数・1着率を追加(BOA-264追加調査、日和比較)。
      // v4: 前検タイム・前検順位・公式2連率（節時点）を追加(BOA-451)。
      // 旧キーのままだと古いキャッシュが新フィールド無しの形状のまま返る
      // （過去レースは7日TTLなので、上げ忘れると1週間「前検」列が出ない）
      // v5: 過去レースは公式値（rate_source）、当日は世代で切り詰め（BOA-329）。
      // 過去/当日をキーに含める: 当日に保存した再計算の値が、日付が変わって
      // 過去レース扱い（7日TTL）になった後も読まれ続けないようにする
      // v6: 当日のレースの行に sample_count（初下ろしの判定）を追加（BOA-513）
      // v7: 当日のレースの行に official_3rate（「集計前」の判定）を追加
      // v8: 過去レースの行にも official_3rate を追加し、当日の機力指数を
      //     「このレースの直前まで」にした（BOA-557）
      // v9: 前検の取得失敗を空の前検として保存しないようにした（BOA-686）。v8 には、失敗が
      //     「前検なし」として最長7日残っている可能性があるため読まない
      // v10: 戻り値を { rows, fetchFailed? } にし、会場公式のモーター成績の取得失敗を行に印として残す
      //     （BOA-740）。v9 は配列の形で、失敗も「成績なし」として最長7日残っている可能性があるため読まない
      // v11: 新しいモーターの最初の開催向けに、自前の値（generation_*）・前の節までの走数
      //     （prior_meet_runs）・freshness を追加（BOA-830）。v10 には無い列なので読まない
      `race-motor-breakdown-v11-${past ? "official" : "recalc"}-${venueCode}-${days}-${raceId}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { rows: [] };
        }

        const { data } = await supabase
          .from("race_entries")
          .select(
            "boat_number, player_name, racer_id, motor_number, motor_2rate, motor_3rate",
          )
          .eq("race_id", raceId)
          .order("boat_number");

        const rows = data ?? [];
        if (venueCode === null) return { rows };
        // 新しいモーターの最初の開催で、公式の2連率が 0 の艇に出す自前の値（BOA-830）。
        // 過去レース・当日のレースで同じ値を足す
        const freshPromise = this.getRaceMotorFreshness(
          raceId,
          venueCode,
          rows,
        );
        // 会場公式のモーター成績が1艇でも取れなかったら、結果を保存させない（BOA-740）。
        // 自前の値の材料（使用開始日・節の初日）が取れなかったときも同じ（BOA-830）
        const settle = async (out) =>
          settleMotorBreakdown(out, await freshPromise);

        if (past) {
          const raceDate = raceId.slice(0, 10);
          const [statsAsOf, pretestAsOf] = await Promise.all([
            Promise.all(
              rows.map((row) =>
                this.getVenueMotorStats(venueCode, row.motor_number, raceDate),
              ),
            ),
            fetchPretestByRacer(venueCode, raceDate),
          ]);
          const out = pastMotorRows(rows, statsAsOf, pretestAsOf);
          return await settle(out);
        }

        const [powerIndexes, venueMotorStatsList, pretestByRacer] =
          await Promise.all([
            Promise.all(
              // このレースの直前まで（BOA-557）。終了後に開いてもそのレース自身の
              // 結果を含めず、翌日に開いたときと数字をそろえる
              rows.map((row) =>
                this.getMotorPowerIndex(
                  venueCode,
                  row.motor_number,
                  days,
                  raceId,
                ),
              ),
            ),
            Promise.all(
              rows.map((row) =>
                this.getVenueMotorStats(venueCode, row.motor_number),
              ),
            ),
            fetchPretestByRacer(venueCode, raceId.slice(0, 10)),
          ]);
        // 2連率/3連率も選択中の期間（過去90日/直近1ヶ月）に応じた値に差し替える
        // （組み立ては src/pure/raceMotorBreakdown.js の recalcMotorRows）
        const out = recalcMotorRows(
          rows,
          powerIndexes,
          venueMotorStatsList,
          pretestByRacer,
        );
        return await settle(out);
      },
    );
  },

  /**
   * 新しいモーターの最初の開催向けの列（BOA-830、2026-10-11 ユーザー決定）。
   * 公式の出走表のモーター2連率は、入れ替え後の最初の節の間は全艇 0（2節目の初日から入る）。
   * 公式が 0 の艇に、現世代の開始日以降・このレースより前の自前の値を出すための材料を返す。
   *
   * - generation_runs / generation_rate2 / generation_rate3 / generation_power_index:
   *   機力指数の計算（過去90日・このレースより前）の結果。期間は使用開始日で切り詰められる。
   *   このレースが現世代で、入れ替えから90日以内か公式 0 の艇があるときだけ取る。それ以外は null
   * - prior_meet_runs: 入れ替えから90日以内で公式 > 0 の艇の、節の初日より前の走数
   *   （公式の値が何走で出た数字か）。取れなければ null
   * - freshness: { generationStart（このレースが現世代のときだけ）, firstMeet（その日の
   *   その会場の公式2連率が全行 0＝最初の節） }
   *
   * 使用開始日・節の初日・公式の確認の取得に失敗したら、その材料を出さずに failed: true
   * （呼び出し元はキャッシュに保存しない）
   * @param {string} raceId
   * @param {number} venueCode
   * @param {Array<{motor_number:number, motor_2rate:number|null}>} rows race_entries の行（公式値）
   * @returns {Promise<{columns: Array<Object>, freshness: {generationStart: string|null, firstMeet: boolean}, failed: boolean}>}
   */
  async getRaceMotorFreshness(raceId, venueCode, rows) {
    const raceDate = raceId.slice(0, 10);
    const none = rows.map(() => ({
      generation_runs: null,
      generation_rate2: null,
      generation_rate3: null,
      generation_power_index: null,
      prior_meet_runs: null,
    }));
    let failed = false;
    let generationStart = null;
    try {
      generationStart = await getMotorGenerationStart(venueCode);
    } catch (err) {
      console.error("モーター使用開始日の取得に失敗:", err.message);
      failed = true;
    }
    if (generationStart === null || raceDate < generationStart) {
      return {
        columns: none,
        freshness: { generationStart: null, firstMeet: false },
        failed,
      };
    }
    const official = rows.map((r) =>
      r.motor_2rate === null || r.motor_2rate === undefined
        ? null
        : Number(r.motor_2rate),
    );
    const fresh = isWithinFreshMotorWindow(generationStart, raceDate);
    const needOwn = fresh || official.some((v) => v === 0);
    // 節の初日・全行0の確認は、取れなくても他の列は出す（その材料だけ出さず、保存しない）
    const softFail = (label, fallback) => (err) => {
      console.error(`${label}の取得に失敗:`, err.message);
      failed = true;
      return fallback;
    };
    const [own, meetStart, firstMeet] = await Promise.all([
      needOwn
        ? Promise.all(
            rows.map((r) =>
              this.getMotorPowerIndex(venueCode, r.motor_number, 90, raceId),
            ),
          )
        : null,
      fresh
        ? getVenueMeetStart(venueCode, raceDate).catch(
            softFail("節の初日", null),
          )
        : null,
      // 最初の節は、入れ替えから90日以内で、このレースにも公式0の艇があるときだけ確かめる。
      // 公式の値が取れていない日（全行 null）を、何か月後でも最初の節と取り違えないため
      fresh && official.some((v) => v === 0)
        ? isAllOfficialMotorRateZero(venueCode, raceDate).catch(
            softFail("公式2連率の確認", false),
          )
        : false,
    ]);
    // 節の初日より前（race_id < "YYYY-MM-DD"）の走数。公式は節の途中で変わらないので、
    // 公式の値はこの走りで出た数字
    const prior =
      meetStart !== null
        ? await Promise.all(
            rows.map((r, i) =>
              official[i] > 0
                ? this.getMotorPowerIndex(
                    venueCode,
                    r.motor_number,
                    90,
                    meetStart,
                  )
                : null,
            ),
          )
        : null;
    return {
      columns: rows.map((_, i) => ({
        generation_runs: own?.[i]?.sample_count ?? null,
        generation_rate2: own?.[i]?.actual_rate2 ?? null,
        generation_rate3: own?.[i]?.actual_rate3 ?? null,
        generation_power_index: own?.[i]?.power_index ?? null,
        prior_meet_runs: prior?.[i]?.sample_count ?? null,
      })),
      freshness: { generationStart, firstMeet },
      failed,
    };
  },

  /**
   * 指定会場・モーター番号の「機力指数」を算出する（BOA-265）
   * このモーターが過去90日に出走した全レースについて、
   * 「そのレースで実際に2着以内だったか（0/1）」−
   * 「その時このモーターに乗っていた選手自身の全国2連率」を計算し、
   * 全レース分を平均する。強い選手ばかりが使ってきたことによる
   * 見かけ上の高評価（交絡バイアス）を避けるための設計。
   * 単純に motor_2rate − 現在の選手のglobal_2rate を引き算するだけでは
   * 過去の使用選手の実力とモーター自体の性能を区別できないため、
   * この残差平均方式を採用している（ユーザー指摘を受けて修正、2026-09-12）。
   * daysで集計期間を指定できる（既定90日=「過去90日」、30日=「直近1ヶ月」、BOA-283）。
   * 期間は現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。入れ替え前の
   * 同じ番号の別モーターを混ぜない）。使用開始日が不明な会場は集計せず
   * generation_unknown: true を返す
   */
  getMotorPowerIndex(venueCode, motorNumber, days = 90, beforeRaceId = null) {
    return withCache(
      // v3: 期間を現行モーターの世代で切り詰め、generation_unknown・
      // clipped_by_generationを追加（BOA-329）
      `motor-power-index-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const empty = {
          venue_code: venueCode,
          motor_number: motorNumber,
          sample_count: 0,
          actual_rate2: null,
          actual_rate3: null,
          avg_baseline_rate2: null,
          power_index: null,
          generation_unknown: false,
          clipped_by_generation: false,
        };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return empty;
        }

        const window = await motorWindowStart(venueCode, days, beforeRaceId);
        if (window.since === null) {
          return { ...empty, generation_unknown: true };
        }
        const windowed = {
          ...empty,
          clipped_by_generation: window.clippedByGeneration,
        };
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
        );
        if (races.length === 0) return windowed;

        const raceIds = races.map((r) => r.race_id);
        const entryChunks = chunkArray(raceIds, 500);

        const entryResults = await Promise.all(
          entryChunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, global_2rate")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data }) => {
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return windowed;

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select("race_id, rank1, rank2, rank3")
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data }) => {
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        // 指数の計算は src/utils/motorPowerIndex.js（BOA-1245。龍神ボート番付と共有するため手を加えずに移した）
        const index = computeMotorPowerIndex(entries, resultByRaceId);
        return index ? { ...windowed, ...index } : windowed;
      },
    );
  },

  /**
   * 指定会場・モーター番号を過去に使用した選手の履歴を、節ごとにグループ化して
   * 取得する（BOA-283）。「誰がこのモーターに乗っていたか」を辿れるようにする。
   * 節の境目は「同一選手が同一モーターに乗り続けた出走の間隔が2日以内か」で
   * 判定する（BOA-265のgetRacerCurrentMotorStatusと同じ考え方を一般化したもの）。
   * 各節の2連率/3連率はそのモーター・その選手のその節内の実績（機力指数のような
   * 選手実力の差し引きはしない、素の成績）を返す。選手の実力水準は級別バッジで
   * 別途示す（ユーザーフィードバック、2026-09-13: 機力指数を軸にすると選手間の
   * 比較がしづらいため、素の連対率＋級別表示に変更）。
   * 期間は過去90日を現行モーターの世代（使用開始日以降）で切り詰める（BOA-329。
   * 入れ替え前の同じ番号の別モーターに乗った選手を出さない）。使用開始日が
   * 不明な会場は空
   * includeTarget: true（BOA-1297）は beforeRaceId のレース自身の出走も含める。
   * 未確定のレースなら結果が無く、その走は rank: null で入る（n には数えない）。
   * 初日の初走でも今節の firstDate が取れるようにするための口
   */
  getMotorUsageHistory(
    venueCode,
    motorNumber,
    beforeRaceId = null,
    { includeTarget = false } = {},
  ) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 着順の付かなかった走（失格等）も分母に数える（BOA-549）
      `motor-usage-history-v4-${venueCode}-${motorNumber}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return [];
        }

        const window = await motorWindowStart(venueCode, 90, beforeRaceId);
        if (window.since === null) return [];
        const races = await getRacesForVenueSince(
          venueCode,
          window.since,
          beforeRaceId,
          { includeTarget },
        );
        if (races.length === 0) return [];

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, racer_id, player_name, grade")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data }) => {
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return [];

        const resultChunks = chunkArray(
          entries.map((e) => e.race_id),
          500,
        );
        const resultResults = await Promise.all(
          resultChunks.map((chunk) =>
            supabase
              .from("race_results")
              .select(
                "race_id, rank1, rank2, rank3, rank4, rank5, rank6, race_status",
              )
              .in("race_id", chunk),
          ),
        );
        const resultByRaceId = new Map();
        resultResults.forEach(({ data }) => {
          (data ?? []).forEach((r) => resultByRaceId.set(r.race_id, r));
        });

        const rankOf = (result, boatNumber) =>
          findBoatColumnIndex(result, "rank", boatNumber);

        // race_id昇順に並べ、同一選手が2日以内の間隔で乗り続けている限り同じ節とみなす
        const sorted = [...entries].sort((a, b) =>
          a.race_id.localeCompare(b.race_id),
        );
        const meets = [];
        let current = null;
        sorted.forEach((e) => {
          const date = e.race_id.slice(0, 10);
          if (current && current.racerId === e.racer_id) {
            const gapDays =
              (new Date(date) - new Date(current.lastDate)) / 86400000;
            if (gapDays <= 2) {
              current.entries.push(e);
              current.lastDate = date;
              return;
            }
          }
          if (current) meets.push(current);
          current = {
            racerId: e.racer_id,
            playerName: e.player_name,
            grade: e.grade,
            entries: [e],
            firstDate: date,
            lastDate: date,
          };
        });
        if (current) meets.push(current);

        return meets
          .map((meet) => {
            let hits2 = 0;
            let hits3 = 0;
            let n = 0;
            const races = meet.entries.map((e) => {
              const result = resultByRaceId.get(e.race_id);
              const rank = rankOf(result, e.boat_number);
              // 着順の付かなかった走（失格・転覆等）も、結果の出たレースなら1走に数える。
              // 機力指数・枠番別成績と同じ数え方にそろえる（BOA-549。以前は節の2連率
              // だけ分母から外していて、同じモーターの2連率が画面の中で食い違った）。
              // 公式のモーター2連率は選手責任外の失格（S0）・欠場を数えないが、2026年の
              // データにはそれを見分ける列が無い（実測では着順なしの走の約76%が公式でも
              // 出走に数えられていた）。公式の成績コードの取り込みは別チケット
              if (rank !== null) {
                n += 1;
                if (rank <= 2) hits2 += 1;
                if (rank <= 3) hits3 += 1;
              } else if (isUsableRaceResult(result)) {
                n += 1;
              }
              return { date: e.race_id.slice(0, 10), rank };
            });
            return {
              racerId: meet.racerId,
              playerName: meet.playerName,
              grade: meet.grade,
              firstDate: meet.firstDate,
              lastDate: meet.lastDate,
              races,
              sampleCount: n,
              rate2: n > 0 ? (hits2 / n) * 100 : null,
              rate3: n > 0 ? (hits3 / n) * 100 : null,
            };
          })
          .reverse();
      },
    );
  },

  /**
   * 指定会場・モーター番号の公式サイト発表モーター成績（節数・出走回数・
   * 優出回数・優勝回数等）の最新スナップショットを取得する（BOA-264）。
   * `venue_motor_stats`は日次で会場公式サイトをスクレイピングして書き込まれる
   * （scripts/daily/scrape-venue-motor-stats.js）。会場ごとに公式サイトの
   * 公開項目が異なるため、値が無い項目はnullのまま返す（戸田・平和島は
   * データ自体が無いため常にnull）。「機力指数+16.6だが抽選後8走しかしていない
   * ので信頼度低め」のように、他のモーター指標の信頼度を判断する材料として使う
   *
   * 取得に失敗したときは `{ fetchFailed: true }` を返す（BOA-740）。null（その会場・モーターの行が無い）と
   * 区別し、withCache に保存させない（frontend-data-fetch.md §4）。以前は失敗も null にしていたため、
   * 「会場公式の成績なし」として30分キャッシュに残り、画面も失敗を知らせなかった
   * @returns {Promise<Object|null|{fetchFailed: true}>}
   */
  getVenueMotorStats(venueCode, motorNumber, asOfDate = null) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットを返す
      // （過去レースの一覧表をレース時点の公式値にする、BOA-329）
      asOfDate === null
        ? `venue-motor-stats-${venueCode}-${motorNumber}`
        : `venue-motor-stats-asof-${venueCode}-${motorNumber}-${asOfDate}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return null;
        }

        // このメソッドはRaceDetailの機力指数・モーター調子ドリルダウンの
        // Promise.allに同居させて呼ぶ想定のため、例外（クライアントの .throwOnError()）が
        // Promise.all全体を巻き込んで他の取得済みデータまで消さないよう、内部で捕まえる。
        // ただし null（行なし）には倒さず、失敗と分かる値を返す（BOA-740）
        const failed = { fetchFailed: true };
        try {
          const { data } = await supabase
            .from("venue_motor_stats")
            .select("*")
            .eq("venue_code", venueCode)
            .eq("motor_number", motorNumber)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (!data) return null;

          return {
            scrapedDate: data.scraped_date,
            meetCount: data.meet_count,
            raceCount: data.race_count,
            finalCount: data.final_count,
            championshipCount: data.championship_count,
            firstPlaceCount: data.first_place_count,
            secondPlaceCount: data.second_place_count,
            thirdPlaceCount: data.third_place_count,
            winRate: data.win_rate,
            top2Rate: data.top2_rate,
            top3Rate: data.top3_rate,
            accidentRate: data.accident_rate,
            bestTime: data.best_time,
            avgExhibitionTime: data.avg_exhibition_time,
            statsPeriodStart: data.stats_period_start,
            statsPeriodEnd: data.stats_period_end,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  },

  /**
   * 指定会場・モーター番号が「優勝戦」で実際に1着になった日付・選手を
   * 取得する（BOA-264追加調査、BOA-226のrace_stage列が前提）。
   * venue_motor_statsの優勝数は公式サイト側の集計期間内の合計回数のみで
   * 日付・選手の内訳が無いため、自社データ（race_conditions.race_stage=
   * 優勝戦を含む×race_entries×race_results）から逆算する。
   * race_stageはBOA-226実装後に取得したレースに入るほか、BOA-347の
   * scripts/maintenance/backfill-race-conditions.js で過去分も遡及取得している
   * （2025-12〜2026-02-02分を2026-09-28に実施する方針）。
   *
   * モーターは会場ごとに概ね年1回入れ替わり、番号は再利用されるため、
   * 現行モーターの世代（venue_motor_start_datesの最新の使用開始日以降）の
   * レースに限る。使用開始日が取れない会場（行が無い）は、別モーターの記録を
   * 混ぜないよう履歴を出さず generationStart: null を返す。
   * @returns {Promise<{generationStart: string|null, wins: Array<{raceId:string,date:string,racerId:number|null,playerName:string|null}>, fetchFailed?: boolean}>}
   */
  getVenueMotorChampionshipHistory(
    venueCode,
    motorNumber,
    beforeRaceId = null,
  ) {
    return withCache(
      // 戻り値を配列から{generationStart, wins}に変えたため、キーを変えて
      // localStorageに残る旧形式（配列）を読まない
      `venue-motor-championship-generation-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        const failed = { generationStart: null, wins: [], fetchFailed: true };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return failed;
        }
        try {
          const generationStart = await getMotorGenerationStart(venueCode);
          if (generationStart === null) return { generationStart, wins: [] };

          const { data: stageRows } = await supabase
            .from("race_conditions")
            .select("race_id, race_stage, races!inner(venue_code)")
            // 「優勝戦」で終わるものをDBで粗く絞り、「準優勝戦」「準々優勝戦」の
            // 除外は `isFinalStage` に任せる。完全一致だと会場固有の接頭が付く
            // 「ツッキー優勝戦」「ＭＤ優勝戦」「団体・優勝戦」を取りこぼす
            // （旧コメントは「優勝戦/準優勝戦の2値のみ」と書いていたが、
            //  実データの race_stage は349種あった。BOA-457）
            .like("race_stage", "%優勝戦")
            .eq("races.venue_code", venueCode);
          const raceIds = (stageRows ?? [])
            .filter((r) => isFinalStage(r.race_stage))
            .map((r) => r.race_id)
            .filter((raceId) => isInMotorGeneration(raceId, generationStart))
            // 過去レースのドリルダウンは、そのレースより前の優勝に限る（BOA-521）
            .filter((raceId) => beforeRaceId === null || raceId < beforeRaceId);
          if (raceIds.length === 0) return { generationStart, wins: [] };

          const { data: entries } = await supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name")
            .in("race_id", raceIds)
            .eq("motor_number", motorNumber);
          if (!entries || entries.length === 0) {
            return { generationStart, wins: [] };
          }

          const { data: results } = await supabase
            .from("race_results")
            .select("race_id, rank1")
            .in(
              "race_id",
              entries.map((e) => e.race_id),
            );
          const rank1ByRaceId = new Map(
            (results ?? []).map((r) => [r.race_id, r.rank1]),
          );

          const wins = entries
            .filter((e) => rank1ByRaceId.get(e.race_id) === e.boat_number)
            .map((e) => ({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              racerId: e.racer_id,
              playerName: e.player_name,
            }))
            .sort((a, b) => b.date.localeCompare(a.date));
          return { generationStart, wins };
        } catch (err) {
          // 権限エラー（使用開始日が読めない）は getMotorGenerationStart が
          // null（世代不明）に倒すため、ここに来るのは取得失敗だけ
          console.error("優勝履歴取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  },

  /**
   * 指定会場・モーター番号が、同一会場内の全モーターの中で指標順に何位かを
   * 算出する（BOA-301 FR-1）。venue_motor_stats（会場公式サイト由来、BOA-264）の
   * 最新スクレイピング日1件分のスナップショットのみを対象とし、自社race_results
   * からの再計算は行わない（会場公式値の方が正確という既存合意、spec.md参照）。
   * metricがaccidentRate（事故率）の場合のみ昇順（低いほど良い）でランクする。
   * 値がnullのモーター（会場によって非公開の指標がある）はランキング対象外にし、
   * totalにも含めない
   * @param {number} venueCode
   * @param {number} motorNumber
   * @param {'winRate'|'top2Rate'|'top3Rate'|'accidentRate'} metric
   * @returns {Promise<{rank:number,total:number,metric:string,value:number,scrapedDate:string}|null>}
   */
  getVenueMotorRanking(
    venueCode,
    motorNumber,
    metric = "top2Rate",
    asOfDate = null,
  ) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットで順位を
      // 出す（過去レースのドリルダウン、BOA-521）
      // v2: 同じ値は同じ順位・tied を追加（BOA-529）
      // v3: 出走数 0 のモーターを順位・母数から外す（BOA-428。一覧の6基とそろえる）
      asOfDate === null
        ? `venue-motor-ranking-v3-${venueCode}-${motorNumber}-${metric}`
        : `venue-motor-ranking-v3-asof-${venueCode}-${motorNumber}-${metric}-${asOfDate}`,
      async () => {
        // 会場全体の取得は getVenueMotorSnapshot に任せる（会場×日付でキャッシュ。BOA-428）。
        // 取得の失敗・データ無しは、これまでどおり null（ドリルダウンは出さないだけ）
        const snapshot = await this.getVenueMotorSnapshot(venueCode, asOfDate);
        if (snapshot.state !== "ok") return null;

        const columnByMetric = {
          winRate: "win_rate",
          top2Rate: "top2_rate",
          top3Rate: "top3_rate",
          accidentRate: "accident_rate",
        };
        const column = columnByMetric[metric] ?? "top2_rate";
        // 事故率のみ低いほど良いため昇順、他は降順
        const ascending = metric === "accidentRate";

        // 出走数 0（入れ替え直後で集計前）のモーターは、値が 0 でも順位・母数に入れない。
        // 一覧の6基（getVenueMotorRanks）と同じ扱いにして、同じ画面で母数がずれないようにする（BOA-428）
        const valued = snapshot.rows.filter(
          (row) =>
            row[column] !== null &&
            row[column] !== undefined &&
            row.race_count !== 0,
        );
        const own = valued.find((row) => row.motor_number === motorNumber);
        if (!own) return null;
        // 同じ値は同じ順位（BOA-529）。並べ替えた位置を順位にすると、同値の中の
        // 順位が DB の行順で決まっていた
        const { rank, tied } = competitionRank(
          valued.map((row) => Number(row[column])),
          Number(own[column]),
          { ascending },
        );

        return {
          rank,
          tied,
          total: valued.length,
          metric,
          value: own[column],
          scrapedDate: snapshot.scrapedDate,
        };
      },
    );
  },

  /**
   * 会場の全モーターの会場公式サイトの成績（`venue_motor_stats`）を、1つのスナップショット
   * （その日以前で最新の `scraped_date`）で返す（BOA-428）。2クエリ、会場×日付でキャッシュ。
   *
   * 戻り値は3通り。「無い」と「失敗」を分けるのは、失敗を「データの無い会場」と取り違えて、
   * 違う出典の一覧に差し替えないため（BOA-428 設計レビュー）:
   *   - `{ state: "ok", scrapedDate, rows }`
   *   - `{ state: "empty" }` … 会場にデータが無い（戸田・平和島）、またはその日以前に無い
   *   - `{ state: "error", fetchFailed: true }` … 取得の失敗。fetchFailed なので withCache は保存しない
   * 例外は投げない（ドリルダウンの Promise.all を巻き込まない）。
   * 浜名湖・宮島を出さない判断（VENUE_SITE_STATS_HIDDEN）は呼び出し側で行う。既存のドリルダウン
   * （getVenueMotorRanking）の表示は変えないため
   * @param {number} venueCode
   * @param {string|null} asOfDate YYYY-MM-DD。null なら最新
   */
  getVenueMotorSnapshot(venueCode, asOfDate = null) {
    return withCache(
      `venue-motor-snapshot-v1-${venueCode}-${asOfDate ?? "latest"}`,
      async () => {
        const failed = { state: "error", fetchFailed: true };
        if (!supabase) {
          console.error("Supabase client not initialized");
          return failed;
        }
        try {
          const { data: latestRow } = await supabase
            .from("venue_motor_stats")
            .select("scraped_date")
            .eq("venue_code", venueCode)
            .lte("scraped_date", asOfDate ?? "9999-12-31")
            .order("scraped_date", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (!latestRow) return { state: "empty" };

          const { data } = await supabase
            .from("venue_motor_stats")
            .select(
              "motor_number, win_rate, top2_rate, top3_rate, accident_rate, final_count, championship_count, race_count, stats_period_end",
            )
            .eq("venue_code", venueCode)
            .eq("scraped_date", latestRow.scraped_date);
          if (!data || data.length === 0) return { state: "empty" };
          return {
            state: "ok",
            scrapedDate: latestRow.scraped_date,
            rows: data,
          };
        } catch (err) {
          console.error("venue_motor_stats取得エラー(例外):", err.message);
          return failed;
        }
      },
    );
  },

  /**
   * レースの6基の「会場内順位」（会場公式サイトの2連率、`top2_rate`）をまとめて返す（BOA-428 子1）。
   * 会場全体を1回だけ引く（1基ずつ getVenueMotorRanking を呼ぶと 2クエリ×6）。
   *   - 当日のレースは最新のスナップショット（asOfDate = null）、過去のレースはレース日以前で最新
   *   - 浜名湖・宮島は会場サイトの値を出さない（VENUE_SITE_STATS_HIDDEN、2026-10-02 ユーザー判断）
   * @param {number} venueCode
   * @param {string|null} asOfDate
   *   - 出走数 0（集計前）のモーターは順位に入れない（画面は「-」）
   * @returns {Promise<{state:"ok", scrapedDate:string, periodEnd:string|null, total:number, ranks:Map<number,{rank:number,tied:number}>}|{state:"empty"}|{state:"error"}>}
   */
  async getVenueMotorRanks(venueCode, asOfDate = null) {
    if (VENUE_SITE_STATS_HIDDEN.includes(Number(venueCode))) {
      return { state: "empty" };
    }
    const snapshot = await this.getVenueMotorSnapshot(venueCode, asOfDate);
    if (snapshot.state !== "ok") return { state: snapshot.state };
    // 出走数が 0 のモーター（入れ替え直後でまだ走っていない）は、2連率の 0 が「集計前」なので
    // 順位にも母数にも入れない（唐津は 9/22 時点で65基中19基。「40位タイ」と出ていた。データ精度検証）
    const rows = snapshot.rows.map((row) => ({
      motorNumber: row.motor_number,
      top2Rate: row.race_count === 0 ? null : row.top2_rate,
    }));
    const ranks = rankBy(rows, "top2Rate");
    if (ranks.size === 0) return { state: "empty" };
    // 会場サイトの集計の締め日。びわこ・唐津・大村は節の途中で止まっていて、取得日（10/3）と
    // 中身の時点（9/18 締め等）がずれる。締め日が混ざる会場（びわこは 9/09 と 9/18）は古い方を出す
    // （2026-10-02 ユーザー判断、ファン評価3周目の P1）。締め日の無い会場は null（画面は取得日）
    const periodEnds = snapshot.rows
      .map((row) => row.stats_period_end)
      .filter(Boolean)
      .sort();
    return {
      state: "ok",
      scrapedDate: snapshot.scrapedDate,
      periodEnd: periodEnds[0] ?? null,
      total: ranks.size,
      ranks,
    };
  },

  /**
   * 会場の全モーターの一覧（分析ツール「モーターランキング」、BOA-428 子3）。
   *
   * - 2連率・優出・優勝: 会場公式サイトのモーター成績の最新スナップショット（getVenueMotorSnapshot）
   * - 使用者・前検: `motor_pretest_stats` の会場の最新の前検日1日分（節の全選手がそろう。
   *   出走表の1日分だと、その日に走らない選手のモーターが欠ける）
   * - 会場サイトの値を出さない会場（戸田・平和島はデータが無い、浜名湖・宮島は出さない）は、
   *   前検データに載るモーターだけを BOATRACE 公式の2連率で並べる（source: "pretest"）
   * - 機番のリンク用に、そのモーターが今節走った直近のレース（race_id）を出走表から引く
   *
   * 取得の失敗は `{state:"error"}`。会場サイトの値の失敗を「データが無い」と取り違えて
   * 前検データだけの一覧に差し替えない（設計レビュー）
   * @param {number} venueCode
   * @returns {Promise<{state:"ok", source:"venueSite"|"pretest", scrapedDate:string|null,
   *   pretestDate:string|null, rows:Array<object>}|{state:"error"}>}
   */
  getVenueMotorList(venueCode) {
    const venue = Number(venueCode);
    return withCache(`venue-motor-list-v2-${venue}`, async () => {
      const failed = { state: "error", fetchFailed: true };
      if (!supabase) {
        console.error("Supabase client not initialized");
        return failed;
      }
      const hidden = VENUE_SITE_STATS_HIDDEN.includes(venue);
      try {
        const [snapshot, latestPretest] = await Promise.all([
          hidden
            ? Promise.resolve({ state: "empty" })
            : this.getVenueMotorSnapshot(venue, null),
          supabase
            .from("motor_pretest_stats")
            .select("race_date")
            .eq("venue_code", venue)
            .order("race_date", { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);
        if (snapshot.state === "error") return failed;
        const pretestDate = latestPretest.data?.race_date ?? null;

        let pretestRows = [];
        let riders = new Map();
        let seriesRange = null;
        let nameByRacer = new Map();
        if (pretestDate !== null) {
          // 出走表は、節（最長7日）を含む前検日の8日前から今日まで。会場で絞る（race_id は
          // YYYY-MM-DD-VV-RR）。1日最大72行なので、9日分でも1000行の上限に届かない
          const venuePart = String(venue).padStart(2, "0");
          const [pretest, entries] = await Promise.all([
            supabase
              .from("motor_pretest_stats")
              .select("racer_id, motor_number, motor_2rate, pretest_time")
              .eq("venue_code", venue)
              .eq("race_date", pretestDate),
            supabase
              .from("race_entries")
              .select(
                "race_id, racer_id, motor_number, motor_2rate, player_name",
              )
              .like("race_id", `____-__-__-${venuePart}-%`)
              .gte("race_id", addDaysToDateString(pretestDate, -8))
              .lte("race_id", `${getTodayJST()}-99`),
          ]);
          pretestRows = pretest.data ?? [];
          riders = currentSeriesRiders(entries.data ?? [], pretestDate);
          seriesRange = currentSeriesRange(entries.data ?? [], pretestDate);
          // 出走表に名前が無い選手（まだ走っていない）だけ racer_profiles から引く
          const withoutName = [
            ...new Set(pretestRows.map((r) => r.racer_id)),
          ].filter(
            (id) => ![...riders.values()].some((e) => e.racer_id === id),
          );
          if (withoutName.length > 0) {
            const { data: profiles } = await supabase
              .from("racer_profiles")
              .select("racer_id, name")
              .in("racer_id", withoutName);
            nameByRacer = new Map(
              (profiles ?? []).map((p) => [p.racer_id, p.name]),
            );
          }
        }

        const pretestByMotor = new Map(
          pretestRows.map((r) => [r.motor_number, r]),
        );
        const toNumber = (v) =>
          v === null || v === undefined ? null : Number(v);
        // 使用者は、今の節の出走表で直近に乗った選手（節の途中の入れ替えを反映する）。
        // まだ走っていなければ前検データの選手。前検タイムはモーターの前検の値
        const userOf = (motorNumber) => {
          const p = pretestByMotor.get(motorNumber);
          const e = riders.get(motorNumber);
          const racerId = e?.racer_id ?? p?.racer_id ?? null;
          const name = e?.player_name ?? nameByRacer.get(racerId) ?? null;
          return {
            pretestTime: toNumber(p?.pretest_time),
            racerId,
            racerName: name?.replace(/\s+/g, "") ?? null,
            raceId: e?.race_id ?? null,
          };
        };
        // 今の節で使われたモーター（前検データ ∪ その節の出走表）
        const usedMotors = [
          ...new Set([...pretestByMotor.keys(), ...riders.keys()]),
        ];

        if (snapshot.state === "ok") {
          // スナップショットに無いモーター（丸亀は入れ替え後の一部が欠ける）も、今節使われて
          // いれば一覧に出す（2連率は「-」）
          const motorNumbers = new Set([
            ...snapshot.rows.map((r) => r.motor_number),
            ...usedMotors,
          ]);
          const statsByMotor = new Map(
            snapshot.rows.map((r) => [r.motor_number, r]),
          );
          const rows = [...motorNumbers].map((motorNumber) => {
            const s = statsByMotor.get(motorNumber);
            return {
              motorNumber,
              // 出走数 0（入れ替え直後で集計前）の 0% は値として扱わない。順位・最良にも入れない
              // （6基の会場内順位・ドリルダウンと同じ扱い。BOA-428）
              top2Rate: s?.race_count === 0 ? null : toNumber(s?.top2_rate),
              finalCount: toNumber(s?.final_count),
              championshipCount: toNumber(s?.championship_count),
              // 会場サイトの出走数。入れ替え直後の数走の値が上位に並ぶので、2連率に添える
              // （ファン評価 2026-10-06 P1、ユーザー決定: 新しい列は足さない）
              raceCount: toNumber(s?.race_count),
              ...userOf(motorNumber),
            };
          });
          return {
            state: "ok",
            source: "venueSite",
            scrapedDate: snapshot.scrapedDate,
            pretestDate,
            seriesRange,
            rows,
          };
        }

        // 会場サイトの値を出さない会場: 今節使われたモーターだけを BOATRACE 公式の2連率で
        // （前検データの値。節の途中で入ったモーターは出走表の値）
        return {
          state: "ok",
          source: "pretest",
          scrapedDate: null,
          pretestDate,
          seriesRange,
          rows: usedMotors.map((motorNumber) => ({
            motorNumber,
            top2Rate: toNumber(
              pretestByMotor.get(motorNumber)?.motor_2rate ??
                riders.get(motorNumber)?.motor_2rate,
            ),
            finalCount: null,
            championshipCount: null,
            raceCount: null,
            ...userOf(motorNumber),
          })),
        };
      } catch (err) {
        console.error("会場のモーター一覧の取得エラー(例外):", err.message);
        return failed;
      }
    });
  },

  /**
   * 会場の現行モーター世代の開始日（不明なら null）。画面で「このレースのモーターは
   * 入れ替え前か」を判定するのに使う（日付そのものは画面に出さない、ADR-0067）
   * @returns {Promise<string|null>}
   */
  getMotorGenerationStart(venueCode) {
    return getMotorGenerationStart(venueCode);
  },

  /**
   * 指定会場・モーター番号の枠番（進入コース）別成績・展示タイム推移を、
   * 自社race_entries×race_results×exhibition_dataからライブ集計する
   * （BOA-301 FR-2/FR-3、ADR-0060: 1会場×1モーターに絞り込んだ範囲のため
   * 事前バッチ集計は不要と判断）。
   *
   * 集計期間は現行モーターの世代（venue_motor_start_datesの最新の使用開始日以降）。
   * モーターは会場ごとに概ね年1回入れ替わり番号が再利用されるため、以前は
   * 混在リスクを緩和する暫定策として直近180日に絞っていた（BOA-329）。
   * 使用開始日が不明な会場は、別モーターの成績を混ぜないよう集計しない
   * （generationStart: null。優勝履歴と同じ扱い、ADR-0067 2026-09-28追記）。
   * rowsは常に1〜6コース分（出走が無いコースはraceCount:0・値null）で、
   * UI側で6行固定のグリッドを組みやすくする
   * @returns {Promise<{generationStart:string|null, fetchFailed?:boolean,
   *   rows:Array<{course:number, raceCount:number, winRate:number|null,
   *   top2Rate:number|null, top3Rate:number|null, avgExhibitionTime:number|null,
   *   exhibitionTrend:Array<{raceId:string,time:number}>}>}>}
   */
  getMotorWakuStats(venueCode, motorNumber, beforeRaceId = null) {
    return withCache(
      // 戻り値を配列から{generationStart, rows}に変えたため、キーを変えて
      // localStorageに残る旧形式（配列）を読まない
      `motor-waku-stats-generation-v2-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        const emptyRows = () =>
          Array.from({ length: 6 }, (_, i) => ({
            course: i + 1,
            raceCount: 0,
            winRate: null,
            top2Rate: null,
            top3Rate: null,
            avgExhibitionTime: null,
            exhibitionTrend: [],
          }));

        if (!supabase) {
          console.error("Supabase client not initialized");
          return {
            generationStart: null,
            rows: emptyRows(),
            fetchFailed: true,
          };
        }

        let generationStart;
        try {
          generationStart = await getMotorGenerationStart(venueCode);
        } catch (err) {
          console.error("モーター使用開始日取得エラー:", err.message);
          return {
            generationStart: null,
            rows: emptyRows(),
            fetchFailed: true,
          };
        }
        if (generationStart === null) {
          return { generationStart, rows: emptyRows() };
        }

        const races = await getRacesForVenueSince(
          venueCode,
          generationStart,
          beforeRaceId,
        );
        if (races.length === 0) return { generationStart, rows: emptyRows() };

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data }) => {
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return { generationStart, rows: emptyRows() };

        const [resultRows, exhibitionRows] = await Promise.all([
          fetchAllByIn(
            "race_results",
            "race_id, rank1, rank2, rank3, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
            "race_id",
            entries.map((e) => e.race_id),
          ),
          fetchAllByIn(
            "exhibition_data",
            "race_id, boat_number, exhibition_time",
            "race_id",
            entries.map((e) => e.race_id),
          ),
        ]);
        const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));
        const exhibitionByKey = new Map(
          exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
        );

        const byCourse = new Map(
          Array.from({ length: 6 }, (_, i) => [
            i + 1,
            {
              course: i + 1,
              raceCount: 0,
              firstPlaceCount: 0,
              top2Count: 0,
              top3Count: 0,
              exhibitionTimes: [],
            },
          ]),
        );

        entries.forEach((entry) => {
          const result = resultByRaceId.get(entry.race_id);
          if (!isUsableRaceResult(result)) return;
          const course = courseOfBoat(result, entry.boat_number);
          const stat = byCourse.get(course);
          // courseOfBoat()がnullを返す(欠場等で進入コース無し)場合や、
          // 進入コース値が1-6の範囲外(データ異常)の場合は集計対象外にする
          if (!stat) return;

          stat.raceCount += 1;
          if (result.rank1 === entry.boat_number) stat.firstPlaceCount += 1;
          if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
            stat.top2Count += 1;
          }
          if (
            isShowHit(
              entry.boat_number,
              result.rank1,
              result.rank2,
              result.rank3,
            )
          ) {
            stat.top3Count += 1;
          }
          const exhibition = exhibitionByKey.get(
            `${entry.race_id}-${entry.boat_number}`,
          );
          if (
            exhibition?.exhibition_time !== null &&
            exhibition?.exhibition_time !== undefined
          ) {
            stat.exhibitionTimes.push({
              raceId: entry.race_id,
              time: exhibition.exhibition_time,
            });
          }
        });

        const rows = [...byCourse.values()].map((stat) => {
          const trend = stat.exhibitionTimes.sort((a, b) =>
            a.raceId.localeCompare(b.raceId),
          );
          return {
            course: stat.course,
            raceCount: stat.raceCount,
            winRate:
              stat.raceCount > 0
                ? (stat.firstPlaceCount / stat.raceCount) * 100
                : null,
            top2Rate:
              stat.raceCount > 0
                ? (stat.top2Count / stat.raceCount) * 100
                : null,
            top3Rate:
              stat.raceCount > 0
                ? (stat.top3Count / stat.raceCount) * 100
                : null,
            avgExhibitionTime:
              trend.length > 0
                ? trend.reduce((sum, t) => sum + t.time, 0) / trend.length
                : null,
            exhibitionTrend: trend,
          };
        });
        return { generationStart, rows };
      },
    );
  },

  /**
   * 指定会場・モーター番号を使用した選手ごとの枠番（進入コース）別成績を
   * ライブ集計する（BOA-301 FR-4、選手×モーター×枠）。getMotorWakuStatsと同じ
   * JOIN・集計期間（現行モーターの世代）・進入コース判定にracer_idの
   * グルーピングを加えたもの。サンプル数が小さくなりやすい軸のため、常にnを
   * 返しUI側で小標本表示を判断できるようにする（合否判定・非表示化はしない、
   * BOA-306と同じ方針）。入れ替え直後はnがさらに小さくなるが、扱いは同じ
   * @returns {Promise<{generationStart:string|null, fetchFailed?:boolean,
   *   rows:Array<{racerId:number, playerName:string, course:number,
   *   raceCount:number, winRate:number|null, top2Rate:number|null, top3Rate:number|null}>}>}
   */
  getMotorRacerWakuStats(venueCode, motorNumber, beforeRaceId = null) {
    return withCache(
      // 戻り値の形を変えたためキーも変える（getMotorWakuStatsと同じ理由）
      `motor-racer-waku-stats-generation-v2-${venueCode}-${motorNumber}${beforeKey(beforeRaceId)}`,
      async () => {
        if (!supabase) {
          console.error("Supabase client not initialized");
          return { generationStart: null, rows: [], fetchFailed: true };
        }

        let generationStart;
        try {
          generationStart = await getMotorGenerationStart(venueCode);
        } catch (err) {
          console.error("モーター使用開始日取得エラー:", err.message);
          return { generationStart: null, rows: [], fetchFailed: true };
        }
        if (generationStart === null) return { generationStart, rows: [] };

        const races = await getRacesForVenueSince(
          venueCode,
          generationStart,
          beforeRaceId,
        );
        if (races.length === 0) return { generationStart, rows: [] };

        const raceIds = races.map((r) => r.race_id);
        const chunks = chunkArray(raceIds, 500);
        const entryResults = await Promise.all(
          chunks.map((chunk) =>
            supabase
              .from("race_entries")
              .select("race_id, boat_number, racer_id, player_name")
              .in("race_id", chunk)
              .eq("motor_number", motorNumber),
          ),
        );
        let entries = [];
        entryResults.forEach(({ data }) => {
          entries = entries.concat(data ?? []);
        });
        if (entries.length === 0) return { generationStart, rows: [] };

        const resultRows = await fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, race_status, actual_course_1, actual_course_2, actual_course_3, actual_course_4, actual_course_5, actual_course_6",
          "race_id",
          entries.map((e) => e.race_id),
        );
        const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));

        const byKey = new Map();
        entries.forEach((entry) => {
          if (entry.racer_id === null || entry.racer_id === undefined) return;
          const result = resultByRaceId.get(entry.race_id);
          if (!isUsableRaceResult(result)) return;
          const course = courseOfBoat(result, entry.boat_number);
          // courseOfBoat()がnullを返す(欠場等で進入コース無し)場合はnull<1が
          // trueになりここで除外される。範囲外(データ異常)の場合も同様に除外
          if (course < 1 || course > 6) return;

          const key = `${entry.racer_id}-${course}`;
          if (!byKey.has(key)) {
            byKey.set(key, {
              racerId: entry.racer_id,
              playerName: entry.player_name,
              course,
              raceCount: 0,
              firstPlaceCount: 0,
              top2Count: 0,
              top3Count: 0,
            });
          }
          const stat = byKey.get(key);
          stat.raceCount += 1;
          if (result.rank1 === entry.boat_number) stat.firstPlaceCount += 1;
          if (isPlaceHit(entry.boat_number, result.rank1, result.rank2)) {
            stat.top2Count += 1;
          }
          if (
            isShowHit(
              entry.boat_number,
              result.rank1,
              result.rank2,
              result.rank3,
            )
          ) {
            stat.top3Count += 1;
          }
        });

        const rows = [...byKey.values()]
          .map((stat) => ({
            racerId: stat.racerId,
            playerName: stat.playerName,
            course: stat.course,
            raceCount: stat.raceCount,
            winRate:
              stat.raceCount > 0
                ? (stat.firstPlaceCount / stat.raceCount) * 100
                : null,
            top2Rate:
              stat.raceCount > 0
                ? (stat.top2Count / stat.raceCount) * 100
                : null,
            top3Rate:
              stat.raceCount > 0
                ? (stat.top3Count / stat.raceCount) * 100
                : null,
          }))
          .sort((a, b) => a.course - b.course || b.raceCount - a.raceCount);
        return { generationStart, rows };
      },
    );
  },
  getRaceRacerFormBreakdown,
  getRacerFormTrend,
  getRacerFormSummary,
  getRacerTechniqueProfile,
  getRacerAggregatedStats,
  getRacerOfficialAvgSt,
  getRacerAllPeriodStats,
  getCourseWinRateBaseline,
  getAllRacersLite,
  getRacerGradeCache,
  getAllRacersWithGrade,
  getRacerVenueStats,
  getRacerScopedRaceStats,

  /**
   * 指定選手の「今節（表示中のレースと同じ会場・同じ節で、同じモーターに乗った
   * 当該レースより前の走）」の展示タイム推移を取得する（BOA-304、直前情報タブ
   * 「今節展示情報」）。節の切り方は `groupIntoMeetBeforeRace`（今節タブの
   * basicInfoStats.buildMeetResults と同じ）。節の初戦なら空配列を返す
   * `boatNumber` も返す（追加クエリ0本）。オリジナル展示（BOA-473）は
   * `(race_id, boat_number)` で引くため、呼び出し側がこの2つを組にして使う。
   * @returns {Promise<Array<{raceId: string, boatNumber: number, exhibitionTime: number|null}>>} 昇順（古い→新しい）
   */
  getRacerMeetExhibitionTrendBefore(racerId, motorNumber, beforeRaceId) {
    return withCache(
      // v2: BOA-591 で別会場・前の節の値を返さないようにした。過去レースは7日TTLで
      // localStorage に残るため、旧キーの誤った値を読まないようにキーを変える
      `racer-meet-exhibition-trend-v2-${racerId}-${motorNumber}-${beforeRaceId}`,
      async () => {
        if (!supabase || !racerId || !motorNumber || !beforeRaceId) return [];

        const { data: entries } = await supabase
          .from("race_entries")
          .select("race_id, boat_number")
          .eq("racer_id", racerId)
          .eq("motor_number", motorNumber)
          .lt("race_id", beforeRaceId)
          .order("race_id", { ascending: false })
          .limit(30);

        if (!entries || entries.length === 0) return [];

        // **会場で絞り、表示中のレースを目印に足してから切る**（BOA-591）。
        // モーター番号は会場ごとに振られるので、番号だけで引くと別会場の同じ番号の
        // モーターの節が混ざる。目印が無いと、節の初戦で何ヶ月も前の節を今節として拾う
        const meet = groupIntoMeetBeforeRace(entries, beforeRaceId);
        if (meet.length === 0) return [];
        const raceIds = meet.map((e) => e.race_id);

        const exhibitionRows = await fetchAllByIn(
          "exhibition_data",
          "race_id, boat_number, exhibition_time",
          "race_id",
          raceIds,
        );
        const exhibitionByKey = new Map(
          exhibitionRows.map((r) => [
            `${r.race_id}-${r.boat_number}`,
            r.exhibition_time,
          ]),
        );

        return meet.map((e) => ({
          raceId: e.race_id,
          boatNumber: e.boat_number,
          exhibitionTime:
            exhibitionByKey.get(`${e.race_id}-${e.boat_number}`) ?? null,
        }));
      },
    );
  },

  /**
   * 今節のオリジナル展示（一周・半周ラップ・まわり足・直線）を、**レースIDの集合に対して
   * 1クエリ**で引く（[BOA-473](https://linear.app/boat-ai/issue/BOA-473) / phase a FR-4b の続き）。
   *
   * ## なぜ選手ごとではなく集合で引くか
   *
   * 直前情報タブの「今節展示情報」は選手ごとに
   * `getRacerMeetExhibitionTrendBefore` を呼ぶ（6選手 × 2クエリ）。同じ形で
   * オリジナル展示も選手ごとに引くと **+6本**になり、非機能要件（1タブあたり+3本以内）を
   * 超える。6選手の今節はほぼ同じレース集合なので、**IDを束ねて1本**にする。
   *
   * ## なぜ「今節展示情報」に出すのか
   *
   * 直前情報タブの「展示情報」に出しているオリジナル展示（BOA-452）は、**そのレースの
   * 展示が発表されてからしか出ない**（発走30〜10分前）。それまでの間、機力の内訳は
   * 画面に何も無い。ボートレース日和は同じ画面に「今節展示情報」として前走と節平均を
   * 併記していて、**締切前に読めるのはこちらだけ**。
   *
   * 戻り値の `state` は `getRaceOriginalExhibition` と同じ規約:
   *   "published" 値がある / "empty" まだ無い / "forbidden" 匿名に権限が無い（096未適用）
   * 終端でない状態には `fetchFailed: true` を付けて `withCache` に焼き付けない。
   *
   * @param {string[]} raceIds 今節のレースID（表示中のレースより前）
   * @returns {Promise<{state: string, byKey: Object<string, Object<string, number>>}>}
   *   `byKey` のキーは `` `${raceId}-${boatNumber}` ``、値は `{ 一周: 36.9, ... }`
   */
  getMeetOriginalExhibitionByRaceBoat(raceIds) {
    const ids = [...new Set(raceIds ?? [])].filter(Boolean).sort();
    if (ids.length === 0) {
      return Promise.resolve({ state: "empty", byKey: {}, fetchFailed: true });
    }
    // **IDを全部キーに入れる**。件数＋最後のIDだけだと、同じ節・同じ最終レースで
    // 中身の違う集合（選手の顔ぶれが変わって別のレースが混ざる等）が同じキーに
    // なりうる。全部繋ぐと末尾が `YYYY-MM-DD-VV-RR` のままなので、
    // inferTtlFromKey の過去レース判定（7日TTL）もそのまま効く
    return withCache(`meet-original-exhibition-${ids.join(",")}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }
      let rows;
      try {
        rows = await fetchAllByIn(
          "race_original_exhibition_values",
          "race_id, boat_number, kind, value",
          "race_id",
          ids,
        );
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // 096（匿名へのSELECT公開）が未適用なら行ごと出さない
          return { state: "forbidden", byKey: {}, fetchFailed: true };
        }
        throw error;
      }

      const byKey = {};
      (rows ?? []).forEach((row) => {
        // 欠測（BOATCASTの `--.--`）は NULL で入る。平均の分母に入れない
        if (row.value === null || row.value === undefined) return;
        const key = `${row.race_id}-${row.boat_number}`;
        byKey[key] = { ...(byKey[key] ?? {}), [row.kind]: Number(row.value) };
      });

      if (Object.keys(byKey).length === 0) {
        return { state: "empty", byKey: {}, fetchFailed: true };
      }
      return { state: "published", byKey };
    });
  },
  getRacerRaceHistory,
  getRacerBoatReturnRate,

  /**
   * 指定会場・モーター番号の2連率/3連率の節ごとの推移を取得する（BOA-151）
   * race_entries.motor_2rate/3rate は節単位でのみ更新されるため、
   * 日付単位でdedupeして推移として扱う
   */
  getMotorConditionTrend(
    venueCode,
    motorNumber,
    days = 90,
    beforeRaceId = null,
  ) {
    return withCache(
      // v2: 展示タイム(exhibition_time)を追加(BOA-265軸B)。旧キャッシュ形状には
      // 無いフィールドのため、旧キーのままだと古いキャッシュがしばらく残ってしまう。
      // daysも末尾以外に含める（BOA-283の期間切り替え）
      // v3: 期間を現行モーターの世代で切り詰め、generationUnknown・
      // clippedByGenerationを追加（BOA-329）
      `motor-condition-v3-${venueCode}-${motorNumber}-${days}${beforeKey(beforeRaceId)}`,
      async () => {
        const { window, series } = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
          beforeRaceId,
        );
        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          generationUnknown: window?.generationStart === null,
          clippedByGeneration: window?.clippedByGeneration ?? false,
          trend: series.map((d) => ({
            date: d.date,
            motor_2rate: d.motor_2rate,
            motor_3rate: d.motor_3rate,
            exhibition_time: d.exhibitionTime,
          })),
        };
      },
    );
  },

  /**
   * 指定モーターのプロペラ交換・部品交換の履歴を取得する（BOA-221）
   * 単独では「機力低下のサイン」にも「整備直後の好転サイン」にもなり得るため
   * （チケット参照）、イベント前後の展示タイム平均を比較し、方向感の目安
   * （improved/declined/neutral）を自動判定して添える。展示タイムは日次の
   * 実測値で、motor_2rate（公式サイトの「モーター交換時からの累積」値）と違い
   * イベント前後で単純比較できるため、この目的にはこちらを使う
   */
  getMotorPartsHistory(
    venueCode,
    motorNumber,
    days = 90,
    beforeRaceId = null,
    { includeTarget = false } = {},
  ) {
    return withCache(
      // v2: 期間を現行モーターの世代で切り詰める（BOA-329）
      // v3: 交換が記録されたレース番号（raceNos）を追加（BOA-513）
      `motor-parts-history-v3-${venueCode}-${motorNumber}-${days}${includeKey(beforeRaceId, includeTarget)}${beforeKey(beforeRaceId)}`,
      async () => {
        const { series: dateSeries } = await fetchMotorDailySeries(
          venueCode,
          motorNumber,
          days,
          beforeRaceId,
          { includeTarget },
        );

        const avgOf = (list) => {
          const values = list
            .map((d) => d.exhibitionTime)
            .filter((v) => v !== null);
          return values.length > 0
            ? values.reduce((sum, v) => sum + v, 0) / values.length
            : null;
        };

        const events = [];
        dateSeries.forEach((d, i) => {
          if (!d.propellerChanged && !(d.parts && d.parts.length > 0)) return;

          const before = avgOf(
            dateSeries.slice(Math.max(0, i - INTERPRETATION_WINDOW_DAYS), i),
          );
          const after = avgOf(
            dateSeries.slice(i + 1, i + 1 + INTERPRETATION_WINDOW_DAYS),
          );
          let interpretation = null;
          if (before !== null && after !== null) {
            // 展示タイムは速いほど良い（小さいほど良い）ため、after<beforeは好転
            const diff = before - after;
            if (Math.abs(diff) >= NEUTRAL_EXHIBITION_DIFF_SEC) {
              interpretation = diff > 0 ? "improved" : "declined";
            } else {
              interpretation = "neutral";
            }
          }
          events.push({
            date: d.date,
            raceNos: d.eventRaceNos ?? [],
            propellerChanged: d.propellerChanged,
            parts: d.parts,
            interpretation,
          });
        });

        return {
          venue_code: venueCode,
          motor_number: motorNumber,
          events,
        };
      },
    );
  },
  getRaceStPredictabilityBreakdown,
  getStDeviationTrend,
  getRaceExhibitionTimeBreakdown,

  /**
   * 指定レースのチルト・調整重量・当日体重・前走成績・部品交換/プロペラ交換を
   * 取得する（BOA-221/BOA-289/BOA-304）。展示タイムと同じ行(exhibition_data)の
   * 別列で、履歴平均を出す必要が無い「今回のレースでの設定値・直近の実績値」の
   * ため、getRaceExhibitionTimeBreakdownのような過去90日平均フォールバックは
   * 不要。単純に該当race_idの1回読み取りで足りる
   *
   * propeller_change/parts_changedはtilt/adjustment_weightと同じマイグレーション
   * 056（BOA-221、既に全環境適用済み）の列のため、フォールバック対象には含めない。
   * BOA-289の新列（today_weight/prev_race_no/prev_entry_course/prev_start_timing/
   * prev_finish_rank、マイグレーション059）は未適用環境がありうる。1回のselectに
   * 未適用の列を含めると「column does not exist」でクエリ全体が失敗し、既に動作している
   * tilt/adjustment_weight/propeller_change/parts_changed（マイグレーション056）まで
   * 巻き添えで表示できなくなる。これを避けるため、失敗時は新列を除いた旧列のみで再取得する
   */
  getRaceMotorMaintenanceBreakdown(raceId) {
    // v3: 戻り値を配列から { state, rows } に変えた（BOA-497）。v2 は展示進入等の列を
    // 足したとき（BOA-485）。キーを変えないと localStorage に残った旧形（配列）が返る
    // v4: prev_finish_mark（前走の着順が無いときの公式の記号）を足した（BOA-569）
    return withCache(`race-motor-maintenance-v4-${raceId}`, async () => {
      if (!supabase) {
        throw new Error("Supabase client not initialized");
      }

      // supabaseClient.js が .throwOnError() を既定で適用するため、取得エラーは例外になる。
      // 「新列が未適用」だけは旧列での再取得に倒したいので、ここで捕まえて分岐する
      // （それ以外のエラーはそのまま投げて、空配列＝「データなし」に化けさせない）
      let data;
      try {
        ({ data } = await supabase
          .from("exhibition_data")
          .select(
            // exhibition_course/is_absent/updated_at は直前情報タブの「展示進入」用
            // （BOA-485）。同じ行の別列なので、クエリ本数は増やさない（BOA-357）。
            // exhibition_time はキャッシュしてよいか（展示後か）の判定用（BOA-497）
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed, today_weight, prev_race_no, prev_entry_course, prev_start_timing, prev_finish_rank, prev_finish_mark, exhibition_course, is_absent, updated_at",
          )
          .eq("race_id", raceId));
      } catch (error) {
        if (!/column .* does not exist/i.test(error?.message ?? ""))
          throw error;
        console.warn(
          "exhibition_data: BOA-289の新列が未適用のため旧列のみで再取得します（マイグレーション059未適用の可能性）:",
          error.message,
        );
        const { data: legacyData } = await supabase
          .from("exhibition_data")
          .select(
            "boat_number, exhibition_time, tilt, adjustment_weight, propeller_change, parts_changed",
          )
          .eq("race_id", raceId);
        return toMaintenanceResult(legacyData ?? []);
      }

      return toMaintenanceResult(data ?? []);
    });
  },
  getRaceEntryWeights,
  getRaceExhibitionBasics,
  getExhibitionTimeTrend,
  getRaceRacerStats,
  getRaceOfficialAvgSt,
  getRaceOddsSnapshots,
  getRaceFinalOdds,
  getUnifiedModelAccuracy,
  getUnifiedVolatilityAccuracy,
  getInCautionAccuracy,
  getRaceEntriesDetail,
  getRaceResultSummary,
  getRaceRacerBoatReturnRate,
  getTodaysRacerFormRanking,
  getTodaysVenueRanking,
  getVenueDaySummary,
  getVenueFirstWinRateRanking,
  getRaceTechniqueProfileBreakdown,
  getTopStartStats,
  getLosingTechniqueStats,
  getStCourseBaseline,

  /**
   * 節の全選手の今節得点率と順位を取得する（phase a FR-3 Phase B、BOA-291）。
   *
   * ## なぜ節の全選手が要るのか
   *
   * 得点率は**単独では読めない**。「3.67」と出しても、準優に乗るのかが分からない。
   * ファンが見たいのは「この節の中で今どこにいるか」「準優の枠まであと何点か」で、
   * それには節の全選手（約48名）の得点率が要る。
   *
   * ## 取得は3本
   *
   * `race_id` が `YYYY-MM-DD-VV-RR` の固定長なので、`like("__________-VV-__")` で
   * 会場を厳密に絞れる（実測: 桐生の1節=432行を1クエリ・550ms）。
   * 節の切り出しは日付の連続性（間隔2日以内）で行う。`race_series` は引かない。
   *
   * **1レース詳細あたり+3本**。ただしキーは節単位なので、6艇のどれを開いても
   * 使い回され、同じ節の他のレースを開いても再取得しない。
   *
   * @param {string} raceId 表示中のレース。節ページ（BOA-682）は、その日の全レースを
   *   済みとして扱う架空ID `{日付}-{会場}-99` を渡すことがある
   * @param {number} venueCode
   * @param {{useOfficial?: boolean}} [options] `useOfficial: true` なら、種別に関係なく
   *   公式の得点率一覧（`officialByRacer`・備考の途中帰郷・賞典除外）を使う。節ページが
   *   使う（plan §2.4）: 予選後の夜（架空IDには種別が無く公式値が使われない）と、予選中
   *   （公式の前夜時点の値をそのまま出す。ユーザー決定 2026-10-06、減点・途中帰郷を公式と
   *   一致させるため）。省略時は従来どおり表示中レースの種別で決める（今節タブ）
   * @returns {Promise<{rows: Array, currentStage: string|null,
   *   meetStart: string, meetEnd: string, semifinalSlots: number|null}>}
   */
  getMeetScoreboard(raceId, venueCode, { useOfficial } = {}) {
    const date = (raceId ?? "").slice(0, 10);
    if (!date || venueCode === null || venueCode === undefined) {
      return Promise.resolve(null);
    }
    const vv = String(venueCode).padStart(2, "0");
    // v15: 本番STの「欠」の行を出走に数えない（BOA-504）
    // v16: 推移の走に着順（finish）を足した（BOA-537）
    // v17: 着順の並びの材料に公式の記号（finishMark）を足した（BOA-537）
    // v18: 賞典除外（公式の備考・今節F）を順位から外す理由を足した（BOA-587）
    // v19: 着順の並びでフライングを「F」と出すため、is_flying を足した（BOA-589）
    // v20: 予選終了の日目を series_day から出す（中止の日を数えない、BOA-578）
    // v21: 予選後に今節Fを切った選手（postPrelimFlyingRacerIds）を足した（BOA-626）
    // v22: 丸一日レースが無かった日（noRaceDays）を足した（BOA-636）
    // v23: 節の出場者（meetEntrantIds）を足した（BOA-660）
    // v24: 予選中に帰った選手を予選の翌日から外す・過去のレースは後の日付の前検も使う（BOA-674）
    // v26: 途中帰郷を、前の日まで走っていて表示日に1走も無い選手として全日程で外す。
    //      公式の備考は予選の後だけ使い、その途中帰郷は officialWithdrawn にする（#1149）
    // v28: まだ1走もしていない選手（notYetStartedRacerIds）を足した（BOA-690）
    // v29: 節ページの useOfficial を足した（BOA-682）。キーを分けないと、今節タブと
    //      節ページで公式値の採否が違う結果を取り違える
    // v30: 予選中に公式の前夜の減点・途中帰郷を足した（officialPenaltyByRacer、BOA-782）
    const cacheKey = `meet-scoreboard-v30-${raceId}${useOfficial ? ":of" : ""}`;
    return withCache(cacheKey, async () => {
      if (!supabase) throw new Error("Supabase client not initialized");

      // 節は最長でも7日程度。表示日から9日前までを見れば前節との境目が入る。
      // **窓を広げるときは既定の1000行上限に注意する**。出走表は10日 × 12R × 6艇 =
      // 最大720行で、余裕は280行しか無い（12日ぶんで864行、14日で上限を超える）。
      // 上限に当たっても PostgREST はエラーを返さず黙って切るので、古い日が
      // 落ちて節の境目を見失う。広げるならページングを入れる
      const from = new Date(date);
      from.setDate(from.getDate() - 9);
      const windowStart = from.toISOString().slice(0, 10);
      // 出走表と**窓ぶんの種別**を同時に取る。種別は節の初日を決めるのに要るので
      // `meetStart` より先に要るが、窓の範囲は `meetStart` に依存しないため
      // 往復は増えない（この2本のあとに走る並列の束から種別を外している）
      const [entriesRes, windowConditionsRes] = await Promise.all([
        supabase
          .from("race_entries")
          .select("race_id, boat_number, racer_id, player_name, motor_number")
          .gte("race_id", windowStart)
          // **これから走るレースも含めて**取る（2026-09-28）。得点率の集計は
          // 「結果がまだ無いレースは分母に入れない」で弾いているので混ざらない。
          // 必要得点（ボーダーに届くのに要る点）には**残り何走あるか**が要り、
          // それは番組が出ている予選レースの数から数えるしかない
          .lte("race_id", `${date}-zz`)
          .like("race_id", `__________-${vv}-__`),
        supabase
          .from("race_conditions")
          // `race_title` も取る（追加クエリ0本）。男女Ｗ優勝戦＝1つの節に2シリーズが
          // 同居する開催の検出に使う（BOA-511）。判定材料はこの列だけで足りる
          .select("race_id, race_stage, is_final_day, series_day, race_title")
          .gte("race_id", windowStart)
          .lte("race_id", `${date}-zz`)
          .like("race_id", `__________-${vv}-__`),
      ]);

      const rows = entriesRes.data ?? [];
      if (rows.length === 0) return null;
      const windowConditions = windowConditionsRes.data ?? [];

      // **節の初日は `series_day` から決める**（BOA-508）。
      // 以前は日付の連続性（間が2日を**超えたら**別の節）で切っていたが、
      // 節と節の間が中1日空くと連続する開催日の差がちょうど2日になり、
      // 境目とみなされず**前の節が丸ごと混ざっていた**。2026-09-28 戸田8Rで
      // 節内順位が6艇とも「対象外」になり、出場人数・準優の目安・必要得点が
      // 前の節の値になった（BOA-491）。実測では3,065（会場×日）のうち59件で
      // 前の節を跨いでいた。
      //
      // `race_entries` にしか無い日（種別が未取得）も拾えるよう、日付は出走表側を
      // 基準にし、`series_day` は種別から引く
      // 種別が1行も取れていない日の isFinalDay は null（「分からない」）。meetDaysFromRows が扱う
      const meetStart =
        meetStartFromRows(
          rows.map((r) => r.race_id.slice(0, 10)),
          windowConditions,
          date,
        ) ?? date;
      const meetRows = rows.filter((r) => r.race_id.slice(0, 10) >= meetStart);
      const raceIds = [...new Set(meetRows.map((r) => r.race_id))];
      // 節に絞った種別（以降は今までどおり `conditions` として使う）
      const conditions = windowConditions.filter(
        (c) => c.race_id.slice(0, 10) >= meetStart,
      );

      const [
        results,
        cancellations,
        pretest,
        meetExhibition,
        meetStarts,
        officialSeries,
      ] = await Promise.all([
        fetchAllByIn(
          "race_results",
          "race_id, rank1, rank2, rank3, rank4, rank5, rank6",
          "race_id",
          raceIds,
        ),
        // **中止・順延**（047、BOA-254）。番組に残っているだけで行われなかった
        // レースを、準優の枠数から外すのに使う（BOA-490）。並列の束に入るので
        // 往復は増えず、行数も節の全レース（最大約84行）×2列で済む
        fetchAllByIn(
          "races",
          "race_id, cancellation_status",
          "race_id",
          raceIds,
        ),
        // 前検タイム（FR-4a、`motor_pretest_stats`。095で匿名SELECTを公開済み）。
        // 機力の**起点**。今節の展示順位の推移だけでは「元から悪い舟」なのか
        // 「調整が進んだ」のかが読めない。節の全選手分を1クエリで引く
        supabase
          .from("motor_pretest_stats")
          // `racer_class` も一緒に取る（追加クエリ0本）。級別は「44人中43位」が
          // B2の順当なのかA1の不調なのかを分ける情報で、勝負駆けの読みが変わる
          .select(
            "racer_id, race_date, motor_number, pretest_time, pretest_rank, racer_class",
          )
          .eq("venue_code", venueCode)
          .gte("race_date", meetStart)
          // 過去のレースは**表示日より後の行**も引く（BOA-674）。前検の取得が止まって
          // いた日（9/18〜9/22 初日の節。BOA-679）は初日の行が無く、前検が全部「—」に
          // なった。前検は節の中で変わらないので、後の日付の行でも同じ値。
          // 別の節の行はモーター番号で弾く（pickMeetPretestByRacer）。当日は後の行が
          // まだ無いので、今までどおり表示日まで
          .lte(
            "race_date",
            isPastRace(raceId) ? shiftDate(date, PRETEST_LOOKBACK_DAYS) : date,
          )
          .then(({ data }) => data ?? []),
        // **節の全レース・全艇**の展示タイム（2026-09-27追加、+1本）。
        // 2つの用途を1クエリで賄う:
        //   1. その日の会場平均（水面の重さ。同じ6.90でも日によって意味が違う）
        //   2. 6艇それぞれの今節の展示の推移（選手単位で引くと6本増える）
        // 節は最長7日 × 12R × 6艇 = 504行で、Supabaseの既定上限1000行に収まる
        supabase
          .from("exhibition_data")
          .select("race_id, boat_number, exhibition_time")
          .gte("race_id", meetStart)
          .lt("race_id", raceId)
          .like("race_id", `__________-${vv}-__`)
          .then(({ data }) => data ?? []),
        // 同じく節の全レース・全艇の本番ST（+1本）。6艇のST推移に使う。
        // フライングは異常値なので呼び出し側で落とす
        supabase
          .from("race_start_timings")
          // finish_mark: 欠場の行（「欠」）を出走から外すため（BOA-504）
          .select("race_id, boat_number, start_timing, is_flying, finish_mark")
          .gte("race_id", meetStart)
          .lt("race_id", raceId)
          .like("race_id", `__________-${vv}-__`)
          .then(({ data }) => data ?? []),
        // 公式の得点率一覧のスクレイプ（064）。**備考がそのまま入っている**ので、
        // 「賞典除外」「途中帰郷」で順位の対象外を直接判定できる（推定が要らない）。
        // ただし収録はSG/G1の一部のみ（2026-09-28時点で2開催101行）なので、
        // 無い開催では出走の有無からの推定にフォールバックする
        supabase
          .from("racer_series_points")
          // 備考（賞典除外・途中帰郷）に加えて、**得点率そのもの**も使う。
          // 公式の得点率は `(着順点 − 減点) ÷ 走数` で、当社は減点を持って
          // いないため、減点のある選手とその下の全員の順位がズレる（BOA-475）。
          // 走数の列は無いが `placements` の文字数から出せる
          // scraped_at: 予選中に減点・途中帰郷だけ借りるとき、表の時点が表示中の
          // レースより前かを確かめる（BOA-782、prelimOfficialAdjustments）
          .select(
            "racer_id, remarks, placements, total_points, penalty_points, scraped_at",
          )
          .eq("venue_code", venueCode)
          .eq("meet_start_date", meetStart)
          .then(({ data }) => data ?? []),
      ]);
      const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
      // 中止が**確定**し、結果も無いレース。判定は `isRaceCancelled` に集めてあるので
      // ここで文字列を比べない（`src/utils/raceCancellation.js`。疑いの段階と
      // 確定を各所で書き分けると必ずズレる、というのがあの関数の由来）。
      // 中止の疑い（tentative）は含まれない——疑いで枠数を減らすと、実際は
      // 行われたときにボーダーが狂う。結果の行を渡すので、誤って確定が残った
      // 実施済みのレースも含まれない（BOA-525）。列名だけスネーク→キャメルに合わせる
      const cancelledRaceIds = new Set(
        (cancellations ?? [])
          .filter((r) =>
            isRaceCancelled({
              cancellationStatus: r.cancellation_status,
              result: resultById.get(r.race_id) ?? null,
            }),
          )
          .map((r) => r.race_id),
      );
      const stageById = new Map(
        (conditions ?? []).map((c) => [c.race_id, c.race_stage]),
      );
      // 公式の値を丸ごと使うか（予選の後、または節ページが決めたとき）
      const usesOfficialSeries =
        useOfficial === true ||
        shouldUseOfficialSeries(
          stageById.get(raceId) ?? null,
          raceId,
          prelimEndRaceIdOf(conditions ?? []),
        );
      // 使わないとき（予選中の今節タブ）は、前夜の公式の表から減点と途中帰郷だけを
      // 当社計算に足す（オーナー決定 2026-10-13、BOA-782）。表の時点が表示中の
      // レースの日より前でなければ null（後から過去のレースを開いたときの後出しを防ぐ）
      const prelimOfficial = usesOfficialSeries
        ? null
        : prelimOfficialAdjustments(
            officialSeries,
            officialAsOfDate(
              (officialSeries ?? [])
                .map((r) => r.scraped_at)
                .filter(Boolean)
                .sort()
                .pop() ?? null,
            ),
            date,
          );
      // **男女Ｗ優勝戦の節を2シリーズに分ける**（BOA-511）。同じレースを走った
      // 選手を辿った連結成分がシリーズになる。該当しなければ null。
      // 出走表は節ぶんを既に持っているので追加クエリ0本
      const racersByRace = new Map();
      for (const e of meetRows) {
        if (!racersByRace.has(e.race_id)) racersByRace.set(e.race_id, []);
        if (e.racer_id != null) racersByRace.get(e.race_id).push(e.racer_id);
      }
      const meetSeries = splitMeetSeries(conditions ?? [], racersByRace);
      // 表示中のレースの6艇が属する側。**6艇全員が同じ側に居るときだけ**分ける。
      // 予選終了後の消化レースには両方の選手が乗ることがあり（多摩川に5レース）、
      // 「1人でも居る側」で決めると反対側の艇が表から消える。
      // そういうレースでは分けずに節全体を出す（注記も出さない）
      const currentRacers = (racersByRace.get(raceId) ?? []).filter(
        (r) => r !== null && r !== undefined,
      );
      const currentSeries =
        currentRacers.length > 0
          ? (meetSeries?.find((set) =>
              currentRacers.every((r) => set.has(r)),
            ) ?? null)
          : null;
      // 枠数はシリーズの準優だけから出す。節全体で数えると2シリーズ合計になる
      // 枠数を出すための、この側のレースだけの種別。
      // **1つの準優に両側の選手が混ざらないことが前提**（実データのＷ開催6節では
      // 準優12本すべてが 6+0 か 0+6）。`some` で絞っているので、もし混合の準優が
      // 現れると両側の `seriesConditions` に入り、枠数が反対側の選手ごと数えられる。
      // 予選終了後の消化レースは混ざるが、そちらは `semifinalRaceIdsOf` が
      // 種別で落とすので枠数には効かない
      const seriesConditions = currentSeries
        ? (conditions ?? []).filter((c) =>
            (racersByRace.get(c.race_id) ?? []).some((r) =>
              currentSeries.has(r),
            ),
          )
        : (conditions ?? []);
      // **本番スタートの記録があるか**（欠場の判定。BOA-489）。
      // 着順に載らない走には「失格・落水（走ったが着順が付かない。0点だが
      // 走数に入れる）」と「欠場（走っていない。走数にも入れない）」があり、
      // 区別にはST記録の有無を使う。`meetStarts` は得点率に使う範囲
      // （節の頭〜表示中レースの直前）と同じ窓を引いているので追加クエリ0本。
      //
      // STが1行も無いレースは**取得漏れ**の可能性があるため、全艇を出走扱いに
      // 倒す（欠場扱いにするとレースが丸ごと得点率から消えて、いま直そうと
      // している誤差より大きく狂う）
      // 欠場の艇にも行がある（finish_mark が「欠」）ので、それは出走に数えない（BOA-504）
      const startedKeys = new Set(
        (meetStarts ?? [])
          .filter((r) => !isAbsentStartRow(r))
          .map((r) => `${r.race_id}|${r.boat_number}`),
      );
      const racesWithSt = new Set((meetStarts ?? []).map((r) => r.race_id));
      // 着順が付かない走の公式の記号（落・転・妨など）。着順の並びに記号で出す（BOA-537）
      const markByKey = new Map(
        (meetStarts ?? [])
          .filter((r) => officialMarkOf(r.finish_mark))
          .map((r) => [`${r.race_id}|${r.boat_number}`, r.finish_mark]),
      );
      // フライングの走。着欄の記号（finish_mark）が未取得の走でも「失」と出さず「F」にする（BOA-589）
      const flyingKeys = new Set(
        (meetStarts ?? [])
          .filter((r) => r.is_flying === true)
          .map((r) => `${r.race_id}|${r.boat_number}`),
      );

      return {
        meetStart,
        meetEnd: date,
        // 表示中レースの種別。早見（得点率がどう動くか）の出し分けに使う
        currentStage: stageById.get(raceId) ?? null,
        // **予選の終わり**＝種別が「予選」の最後のレースの race_id。
        // 得点率はここで確定し、以降は算入されない。公式の得点率一覧も
        // 「4日目12R終了時点」で止まる（2026-09-27に若松G1で確認）。
        //
        // 最初の準優を境にすると**予選終了後の一般戦を算入してしまう**。
        // 若松は9/25(4日目)で予選が終わり、9/26は1R〜8Rが一般戦・9R〜11Rが
        // 準優だった。「最初の準優より前」で切ると9/26の一般戦が入り、
        // 52人中32人の得点率が公式とズレた（公式と照合して5/5で確認）。
        // 無い（予選中でまだ予選が終わっていない）なら null
        prelimEndRaceId: prelimEndRaceIdOf(conditions ?? []),
        // **公式の得点率一覧（`racer_series_points`）の行**。
        // `buildMeetRanking` がこれを受け取ると、当社計算ではなく公式の値で
        // 得点率・節内順位・着順の並びを出す（BOA-475）。
        //
        // **予選が終わった後の表示でだけ渡す**。公式の行は節に1行しか無く、
        // 中身は「◯日目１２R終了時点」＝予選終了時点のスナップショットなので、
        // 予選中のレースを開いているときに使うと**まだ走っていない走を含む
        // 得点率・順位**を出してしまう（レース詳細は過去日も開ける）。
        // 予選中は従来どおり当社計算で、減点のズレは残る（公式の行が生えるのも
        // 4日目以降なので、予選中は直しようが無い）
        officialByRacer: (() => {
          // 「使ってよいか」の判断は純関数に切り出してある（回帰テスト可能）。
          // 節ページが公式値を使うと決めたとき（useOfficial）はそちらに従う
          if (!usesOfficialSeries) return null;
          const rows = officialSeries ?? [];
          if (rows.length === 0) return null;
          return Object.fromEntries(rows.map((r) => [r.racer_id, r]));
        })(),
        // 予選中に当社計算へ足す、公式の前夜の減点（BOA-782）。`buildMeetRanking` が引く。
        // 表の時点（YYYY-MM-DD）は画面の注記に使う。使えなければ null
        officialPenaltyByRacer: prelimOfficial?.penaltyByRacer ?? null,
        officialPrelimAsOf: prelimOfficial?.asOf ?? null,
        // **順位の対象から外す選手と、その理由**（途中帰郷・賞典除外）。
        // 公式の順位表はこの選手たちを順位から外すため、当社が全員で順位を
        // 振ると下位ほどズレ、ボーダーの目安も狂う。理由は画面の説明の出し分けに使う
        ...meetExclusionsOf({
          usesOfficialSeries,
          officialSeries,
          conditions,
          meetStarts,
          meetRows,
          prelimOfficial,
          date,
        }),
        // **予選が終わった後のレースで今節Fを切った選手**（BOA-626）。
        // 順位は予選終了で確定しているので順位の対象からは外さない（上の判定は
        // 予選終了までのFだけを見る。公式の得点率一覧も同じ、BOA-649）。同じ
        // 「今節F」で片方は除外・片方は順位付きになる理由を、画面が順位の下で断るのに使う。
        // `meetStarts` は表示中レースの直前までなので、まだ切っていないFは入らない
        postPrelimFlyingRacerIds: postPrelimFlyingRacerIds(
          meetStarts,
          meetRows,
          prelimEndRaceIdOf(conditions ?? []),
        ),
        // **残りの予選走数**（表示中のレースを含む）。公式の「必要得点」は
        // 「準優ボーダーをクリアするために必要な得点」で、実データから
        // 逆算すると `ボーダー × (今の走数 + 残り走数) − 今の得点` だった
        // （公式の図: 篠崎 得点率5.75・残り2走 → 13点／池田 7.00・残り1走 → 1点）。
        // 残り走数は**番組が出ている予選レース**からしか数えられないので、
        // 当社は当日ぶんまでで数える（翌日以降の出走表は未取得のことが多い）。
        // 画面側はその旨を注記する
        //
        // **算入判定は得点率と同じ `countsForSeriesScore` を通す**。
        // 以前は「種別に『予選』を含むレース」だけを数えていたため、
        // 予選期間内でも会場固有名のレース（芦屋「サンライズＸ戦」、桐生
        // 「ドラドキ３」等）が残り走数から漏れ、必要得点が過大になっていた
        // （BOA-457）
        remainingPrelimRunsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] = (byRacer[e.racer_id] ?? 0) + 1;
          }
          return byRacer;
        })(),
        // 残り走で取りうる**最大得点**。残りの本数だけでは出せない（ドリーム戦の
        // 1着は12点、特選は11点）。予選配点の10点で決め打ちすると、ドリーム戦が
        // 残っている選手を「届かず」と誤って出す（BOA-457）
        remainingPrelimMaxPointsByRacer: (() => {
          const byRacer = {};
          const prelimEnd = prelimEndRaceIdOf(conditions ?? []);
          for (const e of meetRows) {
            if (e.race_id < raceId) continue;
            const st = stageById.get(e.race_id) ?? "";
            if (!countsForSeriesScore(st, e.race_id, prelimEnd)) continue;
            byRacer[e.racer_id] =
              (byRacer[e.racer_id] ?? 0) + scoreTableFor(st)[1];
          }
          return byRacer;
        })(),
        // **丸一日レースが無かった日**（全レースが中止・順延、BOA-636）。表示中の日
        // より前だけ。推移の横軸から抜ける理由と、予選終了の日目が日付の数と
        // 合わない理由を、画面が断るのに使う。追加クエリ0本
        noRaceDays: noRaceDaysOf(
          raceIds.filter((id) => id.slice(0, 10) < date),
          cancelledRaceIds,
        ),
        // 予選が終わった日が節の何日目か（公式の「4日目12R終了時点」に合わせる）
        // 中止の日を数えないよう `series_day` を使う（BOA-578、prelimEndDayOf）
        prelimEndDay: prelimEndDayOf(
          prelimEndRaceIdOf(conditions ?? []),
          conditions ?? [],
          raceIds,
          new Set(resultById.keys()),
        ),
        // **この節に組まれた準優勝戦の枠数**。慣例は3個レース=18名で、決められない
        // とき（予選中で準優がまだ番組に出ていない等）は **null**（0ではない）。
        // 画面は `?? SEMIFINAL_DEFAULT_SLOTS` で既定の18枠に落とす。
        // 「準優進出戦」は準優の1つ前の勝ち上がり戦なので数えない（BOA-457）。
        // 中止で流れた準優も数えない。番組に2日ぶん残る中止順延で枠数が倍になり、
        // ボーダー・必要得点・「届かず」まで狂う（BOA-490）
        semifinalSlots: semifinalSlotsOf(seriesConditions, {
          cancelledRaceIds,
          ranRaceIds: new Set(resultById.keys()),
          // 枠数は本数 × 6 ではなく実人数で数える。多摩川のＷ準優戦は
          // 同じ12名が2回走るヒートで、本数で数えると倍になる
          racersByRace,
        }),
        // **男女Ｗ優勝戦の節で、表示中の6艇が属するシリーズの選手**（BOA-511）。
        // null なら通常の節で、画面はこれまでどおり節全体を母集団にする。
        // 2シリーズを混ぜて順位を振ると、節内順位・出場人数・準優の目安が
        // すべて実際の勝ち上がり争いとズレる
        seriesRacerIds: currentSeries ? [...currentSeries] : null,
        // **この節をまだ1走もしていない選手**（BOA-690）。表示中のレースより前に、
        // 結果の出たレースが1つも無い選手。中止で流れたレースは走ったうちに数えない
        // （津 9/22 が丸一日中止で、9/23 に初めて走る選手を「走った」と数えていた）。
        // 「表示中のレース以降に番組がある」には絞らない。絞ると、中止になったレースに
        // しか番組が無かった選手がどこにも数えられず、人数の足し算が合わなかった
        // （津 9/21 の 6R〜12R。ファン評価1周目）。全部の走が欠場の選手は、結果の出た
        // レースに入っているのでここには入らない（absentOnly の側）。
        // この選手がいる間は順位の対象がそろっていないので、画面は準優の目安を伏せ、
        // 人数の行に書き足す。追加クエリ0本
        notYetStartedRacerIds: (() => {
          const ran = new Set();
          const all = new Set();
          for (const e of meetRows) {
            if (e.racer_id == null) continue;
            all.add(e.racer_id);
            if (e.race_id < raceId && resultById.has(e.race_id))
              ran.add(e.racer_id);
          }
          return [...all].filter((id) => !ran.has(id));
        })(),
        // **節の出場者**（表示日までの出走表に載った選手、当日の番組を含む。BOA-660）。
        // 得点率の母集団（表示中のレースより前に走った選手）で数えると、初日の2Rで
        // 「節の出場は6人」になった。追加クエリ0本
        meetEntrantIds: [
          ...new Set(
            meetRows.map((e) => e.racer_id).filter((id) => id != null),
          ),
        ],
        // **節がＷ開催か**（`seriesRacerIds` とは別）。両方の選手が乗るレースでは
        // 分けられないので `seriesRacerIds` が null になるが、そのときも
        // 「なぜ節全体で出しているのか」を画面が断れるようにする（BOA-511）
        isSplitMeet: Boolean(meetSeries),
        // 節の全レースの種別が取れているか（取れていなければ枠数は目安のまま）
        stagesKnown: stageById.size > 0,
        // その日の会場の展示タイム平均（水面の重さ）。同じ6.90でも日によって
        // 意味が変わるため、選手個人の推移を読むときの補正に使う。
        // 実測（若松2026-09-22〜27）で日ごとに 6.829〜6.907 と0.08秒動く
        venueDailyExhibitionAvg: Object.fromEntries(
          [
            ...(meetExhibition ?? [])
              .filter((r) => r.exhibition_time != null)
              .reduce((map, r) => {
                const d = r.race_id.slice(0, 10);
                const cur = map.get(d) ?? { sum: 0, n: 0 };
                cur.sum += Number(r.exhibition_time);
                cur.n += 1;
                map.set(d, cur);
                return map;
              }, new Map()),
          ].map(([d, v]) => [d, v.sum / v.n]),
        ),
        // 6艇それぞれの今節の走（ST・展示）。選手単位で引くと6本増えるため、
        // 節の全レースぶんを2クエリで取って画面側で選手ごとに畳む
        meetRunsByRacer: (() => {
          const exByRace = new Map();
          for (const r of meetExhibition ?? []) {
            if (!exByRace.has(r.race_id)) exByRace.set(r.race_id, new Map());
            exByRace.get(r.race_id).set(r.boat_number, r.exhibition_time);
          }
          const stByRace = new Map();
          for (const r of meetStarts ?? []) {
            if (!stByRace.has(r.race_id)) stByRace.set(r.race_id, new Map());
            stByRace.get(r.race_id).set(r.boat_number, r);
          }
          const byRacer = {};
          for (const e of meetRows) {
            // 推移も**表示中のレースより前**だけ（未実施のレースは
            // 展示もSTも無いので実害は無いが、過去日を開いたときに
            // 同じ日の後のレースを拾わないよう明示的に切る）
            if (e.race_id >= raceId) continue;
            const ex = exByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const stRow = stByRace.get(e.race_id)?.get(e.boat_number) ?? null;
            const st =
              stRow && !stRow.is_flying && stRow.start_timing != null
                ? Number(stRow.start_timing)
                : null;
            // そのレースの中で何番目のSTだったか（1が最速、同着は同順位）。
            // 「毎回ちゃんと届いているか」は平均STより順位の方が直接的で、
            // 日和の「安定率」（当社定義は最速STとの差0.05以内の割合）が
            // 答えようとしている問いに、%より読みやすい形で答えられる。
            // Fの艇は順位から外す（異常値のため）
            const sameRace = [...(stByRace.get(e.race_id)?.values() ?? [])]
              .filter((r) => !r.is_flying && r.start_timing != null)
              .map((r) => Number(r.start_timing));
            (byRacer[e.racer_id] ??= []).push({
              raceId: e.race_id,
              date: e.race_id.slice(0, 10),
              // その走の着順（1〜6・F・欠・転など）。推移の点の下に出す（BOA-537）
              finish: runFinishLabel(
                resultById.get(e.race_id) ?? null,
                e.boat_number,
                stRow,
                stByRace.has(e.race_id),
              ),
              exhibition: ex === null ? null : Number(ex),
              st,
              stRank:
                st === null ? null : sameRace.filter((v) => v < st).length + 1,
            });
          }
          for (const id of Object.keys(byRacer)) {
            byRacer[id].sort((a, b) => a.raceId.localeCompare(b.raceId));
          }
          return byRacer;
        })(),
        // 選手ごとの前検（節の最初の行＝前検日のもの）。
        // 直近は節の中の複数日に行があるため、最も古い日付を採る。
        // 採り方の根拠と、モータ情報タブ（最新の行を採る）と必ず一致することの
        // 実測は src/utils/pretestRows.js を読むこと
        pretestByRacer: Object.fromEntries(
          pickMeetPretestByRacer(
            pretest,
            new Map(
              meetRows
                .filter((e) => e.motor_number != null)
                .map((e) => [e.racer_id, e.motor_number]),
            ),
          ),
        ),
        // 得点率の計算は画面側の純関数（seriesPoints.js）と同じ規則。
        // ここでは素材（着順と種別）だけ渡し、集計は呼び出し側に任せる。
        // **表示中のレースより前だけ**を渡す。過去日を開いているときは
        // 同じ日の後のレースにも結果があるため、範囲を広げたまま渡すと
        // 「5Rを見ているのに9Rの結果まで得点率に入る」状態に戻る
        // （2026-09-28、必要得点のために取得範囲を広げた際に一度再発させた）
        entries: meetRows
          .filter((e) => e.race_id < raceId)
          .map((e) => ({
            raceId: e.race_id,
            boatNumber: e.boat_number,
            racerId: e.racer_id,
            playerName: e.player_name,
            raceStage: stageById.get(e.race_id) ?? null,
            // 欠場を走数から外すための材料（BOA-489）
            finishMark: markByKey.get(`${e.race_id}|${e.boat_number}`) ?? null,
            isFlying: flyingKeys.has(`${e.race_id}|${e.boat_number}`),
            started:
              !racesWithSt.has(e.race_id) ||
              startedKeys.has(`${e.race_id}|${e.boat_number}`),
            ...(resultById.get(e.race_id) ?? {}),
          })),
      };
    });
  },

  /**
   * 節ページ（`/venue/:venueCode/meet/:startDate`、BOA-682）のデータ。
   *
   * 節の日程・段階・基準のレースは `meetPageModel.js` の純関数で決め、得点率・順位・
   * ボーダー・残り走数は今節タブと同じ `getMeetScoreboard` に任せる（計算を書き直さない）。
   *
   * 窓（初日〜+7日）の種別・グレード・結果・出走表は**キャッシュしない**。結果と出走表は
   * 1日の中で増えるので、キャッシュすると基準のレースや勝ち上がりの着順が古いまま残る
   * （design-reviewer 指摘3）。各96行以下で、既定の1000行上限に当たらない。
   * `getMeetScoreboard` は基準のレース単位でキャッシュされる。
   *
   * 設計: docs/design/meet-page/plan.md §2
   *
   * @param {number} venueCode
   * @param {string} startDate 節の初日 YYYY-MM-DD（URL の値）
   * @param {string} today JST の今日 YYYY-MM-DD
   */
  async getMeetPage(venueCode, startDate, today) {
    if (!supabase) throw new Error("Supabase client not initialized");
    const vv = String(venueCode).padStart(2, "0");
    const end = new Date(`${startDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const windowEnd = end.toISOString().slice(0, 10);
    const inWindow = (q) =>
      q
        .gte("race_id", startDate)
        .lte("race_id", `${windowEnd}-zz`)
        .like("race_id", `__________-${vv}-__`);

    const [seriesRes, condRes, racesRes, resultsRes, entriesRes, officialRes] =
      await Promise.all([
        supabase
          .from("race_series")
          .select("start_date, end_date, title, grade")
          .eq("venue_code", venueCode)
          .eq("start_date", startDate)
          .maybeSingle(),
        inWindow(
          supabase
            .from("race_conditions")
            .select(
              "race_id, race_stage, series_day, is_final_day, race_title",
            ),
        ),
        inWindow(
          supabase
            .from("races")
            .select("race_id, race_grade, cancellation_status"),
        ),
        inWindow(
          supabase
            .from("race_results")
            .select("race_id, rank1, rank2, rank3, rank4, rank5, rank6"),
        ),
        inWindow(
          supabase
            .from("race_entries")
            .select("race_id, boat_number, racer_id, player_name"),
        ),
        // 公式の得点率一覧の取得時刻（予選中は公式の前夜時点の表を出す。plan §2.4）
        supabase
          .from("racer_series_points")
          .select("scraped_at")
          .eq("venue_code", venueCode)
          .eq("meet_start_date", startDate)
          .order("scraped_at", { ascending: false })
          .limit(1),
      ]);
    const series = seriesRes.data ?? null;
    const windowConditions = condRes.data ?? [];
    const windowEntries = entriesRes.data ?? [];
    const meetDays = meetDaysOf(startDate, windowConditions, windowEntries);
    const inMeet = (r) => meetDays.includes(r.race_id.slice(0, 10));
    const conditions = windowConditions.filter(inMeet);
    const entries = windowEntries.filter(inMeet);
    const races = (racesRes.data ?? []).filter(inMeet);
    const results = (resultsRes.data ?? []).filter(inMeet);
    const resultById = new Map(results.map((r) => [r.race_id, r]));

    const raceIds = [
      ...new Set([
        ...conditions.map((c) => c.race_id),
        ...entries.map((e) => e.race_id),
      ]),
    ].sort();
    // 済んだレース: 結果がある、または中止が確定した（判定は isRaceCancelled に集めてある）
    const doneRaceIds = new Set([
      ...results.map((r) => r.race_id),
      ...races
        .filter((r) =>
          isRaceCancelled({
            cancellationStatus: r.cancellation_status,
            result: resultById.get(r.race_id) ?? null,
          }),
        )
        .map((r) => r.race_id),
    ]);
    const grade =
      series?.grade ?? races.find((r) => r.race_grade)?.race_grade ?? null;
    const title =
      series?.title ?? conditions.find((c) => c.race_title)?.race_title ?? null;
    const endDate =
      series?.end_date ??
      conditions.find((c) => c.is_final_day)?.race_id.slice(0, 10) ??
      meetDays[meetDays.length - 1] ??
      null;

    const state = meetPageState({
      today,
      startDate,
      meetDays,
      hasEntries: entries.length > 0,
      // 節の日が空でも指定日のグレードは失わない。翌日以降の別の節は使わない。
      startDateGrade:
        (racesRes.data ?? []).find(
          (r) => r.race_id.startsWith(`${startDate}-`) && r.race_grade,
        )?.race_grade ?? null,
      grade,
      title,
      conditions,
      doneRaceIds,
      raceIds,
      // 窓の先頭が初日の日付と同じ日のレースだけを見る（翌日以降に別の節があるだけでは
      // 「見つからない」にしない。開幕前の節の窓に、同じ会場の前の節の最終日は入らない）
      windowHasRaces: [...windowConditions, ...windowEntries].some((r) =>
        r.race_id.startsWith(startDate),
      ),
    });
    const base = {
      state,
      venueCode,
      startDate,
      endDate,
      title,
      grade,
      meetDays,
      // race_series に無く出走表も無い節は、存在するか分からない（未来日の任意の URL）
      knownMeet: Boolean(series) || entries.length > 0,
      seriesDayToday: seriesDayByDate(conditions).get(today)?.seriesDay ?? null,
    };
    if (["preOpen", "notFound", "outOfScope"].includes(state)) {
      return { ...base, board: null, qualifiers: null };
    }

    // 予選中で公式の表があれば、その時点（前夜）の表をそのまま出す（ユーザー決定
    // 2026-10-06）。自社計算は減点・途中帰郷の備考を持たない（ファン評価1周目 P0・P1）
    const officialAsOf = ["prelim", "prelimFinalDay"].includes(state)
      ? officialAsOfDate(officialRes.data?.[0]?.scraped_at ?? null)
      : null;
    const anchor = pickMeetAnchor({
      today,
      meetDays,
      raceIds,
      doneRaceIds,
      venueCode,
      conditions,
      officialAsOf,
    });
    const board = anchor
      ? await this.getMeetScoreboard(anchor.raceId, venueCode, {
          useOfficial: anchor.useOfficial,
        })
      : null;
    // 窓の先頭を初日とみなすので、URL の初日が節の途中だと別の節と食い違う
    if (!board || board.meetStart !== startDate) {
      return { ...base, state: "notFound", board: null, qualifiers: null };
    }
    // 画面に「◯日目終了時点（公式）」と書くための日目。公式の値で出しているときだけ
    const officialAsOfDay =
      officialAsOf && anchor?.useOfficial
        ? (seriesDayByDate(conditions).get(
            meetDays.filter((d) => d <= officialAsOf).pop(),
          )?.seriesDay ?? null)
        : null;
    return {
      ...base,
      board,
      officialAsOfDay,
      // 表が今日の終了時点（その日の夜の取得後）か。画面の「今日の結果は22時ごろ反映」を
      // 出し分ける（反映済みなのに「まだ」と読めた。ファン評価3周目）
      officialAsOfIsToday:
        officialAsOfDay != null &&
        meetDays.filter((d) => d <= officialAsOf).pop() === today,
      qualifiers: buildQualifiers(conditions, entries, results),
    };
  },
  getRacerPeriodStats,
  getRacerAccidentRecords,
  getNigeSimulation,
  getNigeOutcomeDistribution,
  getExhibitionTimeTopStats,
  getUnifiedTrifectaReference,
  getRaceStartTimings,
  getVenueGradeBoatStats,
  getVenuesWithGradeStats,
  getRacePitReport,
  getRaceOriginalExhibition,
  getMorningDigest,
};

/**
 * モータ情報タブ向けに、節の前検タイムを選手ごとに1クエリで引く（BOA-451）。
 * 採る行は「同じ会場・`race_date <= 当日` かつ `>= 当日 - 6日` の最新」。
 * 根拠と、今節タブ（節の最初の行）と必ず一致することの実測は
 * `src/utils/pretestRows.js` に書いてある。
 *
 * 取得の失敗は投げる（`.throwOnError()` の例外をそのまま上に流す）。以前は空のMapへ倒していたが、
 * 呼び出し元の getRaceMotorBreakdown は withCache の中なので、失敗が「この節は前検なし」として
 * 過去レースでは7日間キャッシュに残り、リロードしても前検の列が出なかった（BOA-686）。
 * 例外なら withCache は保存せず、画面は取得失敗を出して取り直せる。
 * @returns {Promise<Map<number, object>>}
 */
async function fetchPretestByRacer(venueCode, date) {
  if (!supabase || !date) return new Map();
  const { data } = await supabase
    .from("motor_pretest_stats")
    .select("racer_id, race_date, pretest_time, pretest_rank")
    .eq("venue_code", venueCode)
    .gte("race_date", shiftDate(date, -PRETEST_LOOKBACK_DAYS))
    .lte("race_date", date);
  return pickLatestPretestByRacer(data ?? []);
}
