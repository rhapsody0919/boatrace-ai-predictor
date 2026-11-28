/**
 * 選手の出走履歴の行（getRacerRaceHistory の返り値）の整形（純関数）。
 *
 * `supabaseDataService.getRacerRaceHistory` の中で、取得した5つの配列から返り値の行を組み立てていた部分を、
 * 手を加えずに移した（2026-10-25 hq 依頼、FT01。全貌動画の材料
 * sns-video-studio/remotion/scripts/full-picture/fetch-materials.mjs が選手ページのレース条件別の成績
 * （src/utils/racerConditionStats.js）と同じ行を作るため）。入力は取得済みの配列だけで、SQL・キャッシュは持たない。
 * racerScopedRaceRows.js と同じ理由で src/pure/ に置かない（依存が共有の根の外にある）。
 *
 * Node から読むため、import は拡張子付き。
 */

import { deriveRaceStContext } from "../utils/stConsideration.js";
import { isUsableRaceResult } from "../utils/raceResultUsable.js";

// 公式の着欄の記号が数字でない（着順が付かない走）か。記号が無い（未取得）ときは着順に従う
export function isUnrankedFinishMark(mark) {
  return typeof mark === "string" && mark !== "" && !/^[1-6]$/.test(mark);
}

/**
 * @param {{ entries: Array<object>, raceRows: Array<object>, resultRows: Array<object>,
 *   exhibitionRows: Array<object>, conditionRows: Array<object>, stRows: Array<object> }} input
 * @returns {Array<object>} raceId の昇順。会場の無い走と、結果が使えない走（isUsableRaceResult が偽）は除く
 */
export function buildRacerRaceHistoryRows({
  entries,
  raceRows,
  resultRows,
  exhibitionRows,
  conditionRows,
  stRows,
}) {
  const raceInfoByRaceId = new Map(raceRows.map((r) => [r.race_id, r]));
  const resultByRaceId = new Map(resultRows.map((r) => [r.race_id, r]));
  const exhibitionByKey = new Map(
    exhibitionRows.map((e) => [`${e.race_id}-${e.boat_number}`, e]),
  );
  const conditionByRaceId = new Map(conditionRows.map((c) => [c.race_id, c]));
  const stByKey = new Map(
    stRows.map((r) => [`${r.race_id}-${r.boat_number}`, r]),
  );
  // レース内のST順位（Fを除く。同タイムは同順位）。今節タブ・直近10走と同じ規則
  // （deriveRaceStContext）。レース一覧の「ST」に順位を添える（BOA-623）
  const stRowsByRace = new Map();
  stRows.forEach((r) => {
    if (!stRowsByRace.has(r.race_id)) stRowsByRace.set(r.race_id, []);
    stRowsByRace.get(r.race_id).push(r);
  });
  // 同じレースの他の5艇の展示タイムの平均。会場・日・風がそろう比べる相手（選手ページの展示の推移の破線。
  // オーナー 2026-11-27・ファン4人の議論）。他の艇に展示が1つも無ければ null
  const exRowsByRace = new Map();
  exhibitionRows.forEach((e) => {
    if (e.exhibition_time == null) return;
    if (!exRowsByRace.has(e.race_id)) exRowsByRace.set(e.race_id, []);
    exRowsByRace.get(e.race_id).push(e);
  });
  const othersExhibitionAvgOf = (raceId, boatNumber) => {
    const others = (exRowsByRace.get(raceId) ?? []).filter(
      (e) => e.boat_number !== boatNumber,
    );
    if (others.length === 0) return null;
    return (
      others.reduce((a, e) => a + Number(e.exhibition_time), 0) / others.length
    );
  };
  const stRankOf = (raceId, boatNumber) =>
    deriveRaceStContext(stRowsByRace.get(raceId) ?? [], null).byBoat.get(
      boatNumber,
    )?.stRank ?? null;

  return entries
    .map((entry) => {
      const raceInfo = raceInfoByRaceId.get(entry.race_id);
      const result = resultByRaceId.get(entry.race_id);
      const exhibition = exhibitionByKey.get(
        `${entry.race_id}-${entry.boat_number}`,
      );
      const condition = conditionByRaceId.get(entry.race_id);
      const st = stByKey.get(`${entry.race_id}-${entry.boat_number}`);
      if (!raceInfo?.venue_code || !isUsableRaceResult(result)) return null;
      return {
        raceId: entry.race_id,
        venueCode: raceInfo.venue_code,
        raceGrade: raceInfo.race_grade ?? null,
        raceStage: condition?.race_stage ?? null,
        raceTitle: condition?.race_title ?? null,
        // レース直前の発表値（BOA-336）。race_conditions の行が無い走は null
        weather: condition?.weather ?? null,
        windSpeed: condition?.wind_speed ?? null,
        waveHeight: condition?.wave_height ?? null,
        boatNumber: entry.boat_number,
        rank1: result.rank1,
        rank2: result.rank2,
        rank3: result.rank3,
        rank4: result.rank4,
        rank5: result.rank5,
        rank6: result.rank6,
        winningTechnique: result.winning_technique ?? null,
        payoutWin: result.payout_win ?? null,
        payoutPlace1: result.payout_place_1 ?? null,
        payoutPlace2: result.payout_place_2 ?? null,
        exhibitionTime: exhibition?.exhibition_time ?? null,
        othersExhibitionAvg: othersExhibitionAvgOf(
          entry.race_id,
          entry.boat_number,
        ),
        startTiming: st?.start_timing ?? null,
        isFlying: st?.is_flying === true,
        finishMark: st?.finish_mark ?? null,
        // 進入コースとST順位（BOA-623）。進入は本番STの進入を先に、無ければ Kファイル
        entryCourse:
          st?.entry_course ??
          result[`actual_course_${entry.boat_number}`] ??
          null,
        stRank: stRankOf(entry.race_id, entry.boat_number),
        // 公式の着欄が数字でない（F・L・欠・落・転・妨・エ・不・失・沈・＿ など）走は着順が付かない。
        // race_results の rank1〜6 には、完走が3艇未満のレースで返還艇（F等）が入っていることがある
        // （43件、BOA-576 のデータ精度検証）。着欄の記号を優先し、着順・勝率には数えない
        unranked: isUnrankedFinishMark(st?.finish_mark),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.raceId.localeCompare(b.raceId));
}

/**
 * facts の RPC（get_racer_runs、マイグレーション 212・213、ADR-0113）が返す選手1人の走から、上と同じ形の履歴の行を組み立てる。
 * - 着の並び（rank1〜6）は race.finish_order（race_results.rank1〜6 のまま）。他の艇の ST・展示は boats（同じレースの6艇）
 * - ST 順位・他の5艇の展示の平均・使えない走の除き方は上と同じ
 * - 今の画面と字が変わりうる所（facts の規則が広く埋める。190 と同じ規則）: グレード（race_series・class_code の読み替え）・
 *   題（race_series.title）・着欄（成績コードから）・進入（1〜6 の外は null）
 */
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
