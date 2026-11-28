/**
 * facts の RPC（get_racer_runs、マイグレーション 212・213、ADR-0113）が返す選手1人の走から、選手ページの履歴の行
 * （getRacerRaceHistory の返り値、racerRaceHistoryRows.js の buildRacerRaceHistoryRows と同じ形）を組み立てる（純関数）。
 *
 * - 着の並び（rank1〜6）は race.finish_order（race_results.rank1〜6 のまま）。他の艇の ST・展示は boats（同じレースの6艇）
 * - ST 順位は今と同じ deriveRaceStContext（F を除く、同タイムは同順位）、他の5艇の展示の平均も今と同じ式
 * - 結果が使えない走（不成立・rank1 なし）と会場の無い走は除く（isUsableRaceResult、今と同じ）
 * - 今の画面と字が変わりうる所（facts の規則が広く埋める。ADR-0113 決定1・190 と同じ規則）:
 *   グレード（race_series・class_code の読み替え）・題（race_series.title）・着欄（成績コードから）・進入（1〜6 の外は null）
 * racerRaceHistoryRows.js と同じ理由で src/pure/ に置かない（依存が src/utils にある）
 */
import { deriveRaceStContext } from "../utils/stConsideration.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";
import { isUnrankedFinishMark } from "./racerRaceHistoryRows.js";

const nullable = (v) => (v === undefined ? null : v);

/** 同じレースの他の艇の展示タイムの平均（展示の無い艇は数えない。他に無ければ null） */
function othersExhibitionAvgOf(boats, boatNumber) {
  const others = boats.filter((b) => b.boat_number !== boatNumber && b.exhibition_time != null);
  if (others.length === 0) return null;
  return others.reduce((a, b) => a + Number(b.exhibition_time), 0) / others.length;
}

/** 1つの走 → 履歴の1行（使えない走は null） */
function historyRowOf(run) {
  const race = run.race ?? {};
  const order = Array.isArray(race.finish_order) ? race.finish_order : [];
  const result = { rank1: nullable(order[0]), race_status: nullable(race.race_status) };
  if (!race.venue_code || !isUsableRaceResult(result)) return null;
  const boats = Array.isArray(run.boats) ? run.boats : [];
  return {
    raceId: run.race_id,
    venueCode: race.venue_code,
    raceGrade: nullable(race.race_grade),
    raceStage: nullable(race.stage_raw),
    raceTitle: nullable(race.race_title),
    weather: nullable(race.weather),
    windSpeed: nullable(race.wind_speed),
    waveHeight: nullable(race.wave_height),
    boatNumber: run.boat_number,
    rank1: nullable(order[0]),
    rank2: nullable(order[1]),
    rank3: nullable(order[2]),
    rank4: nullable(order[3]),
    rank5: nullable(order[4]),
    rank6: nullable(order[5]),
    winningTechnique: nullable(race.technique),
    payoutWin: nullable(race.payout_win),
    payoutPlace1: nullable(race.payout_place_1),
    payoutPlace2: nullable(race.payout_place_2),
    exhibitionTime: nullable(run.exhibition_time),
    othersExhibitionAvg: othersExhibitionAvgOf(boats, run.boat_number),
    startTiming: nullable(run.start_timing),
    isFlying: run.is_flying === true,
    finishMark: nullable(run.finish_mark),
    entryCourse: nullable(run.course),
    stRank: deriveRaceStContext(boats, null).byBoat.get(run.boat_number)?.stRank ?? null,
    unranked: isUnrankedFinishMark(run.finish_mark),
  };
}

/**
 * @param {Array<object>} runs get_racer_runs の返り値（本人の走、各走に race と boats）
 * @returns {Array<object>} raceId の昇順
 */
export function buildRacerHistoryRowsFromFacts(runs) {
  if (!Array.isArray(runs)) throw new Error("get_racer_runs の返り値が配列ではない");
  return runs
    .map(historyRowOf)
    .filter(Boolean)
    .sort((a, b) => a.raceId.localeCompare(b.raceId));
}
