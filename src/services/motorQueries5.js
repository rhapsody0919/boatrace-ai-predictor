// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { supabase } from "./supabaseClient";
import { isPlaceHit, isShowHit } from "../../scripts/lib/hitCalculator.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import { chunkArray, fetchAllByIn, withCache } from "./core.js";
import {
  beforeKey,
  courseOfBoat,
  fetchMotorDailySeries,
  getMotorGenerationStart,
  getRacesForVenueSince,
} from "./motorQueries.js";

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
export function getMotorWakuStats(venueCode, motorNumber, beforeRaceId = null) {
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
  }

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
export function getMotorRacerWakuStats(venueCode, motorNumber, beforeRaceId = null) {
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
  }

/**
 * 指定会場・モーター番号の2連率/3連率の節ごとの推移を取得する（BOA-151）
 * race_entries.motor_2rate/3rate は節単位でのみ更新されるため、
 * 日付単位でdedupeして推移として扱う
 */
export function getMotorConditionTrend(
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
  }
