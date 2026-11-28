/**
 * 選手の走の RPC（get_racer_runs、マイグレーション 212・213、ADR-0113）の差し替えの共通部品。
 * 選手ページの履歴（getRacerRaceHistory）は facts の RPC から読む（#3689）。古い表の読み
 * （race_entries → races・race_results・exhibition_data・race_conditions・race_start_timings）の差し替えと
 * 同じ入力から、RPC の応答（本人の走に race と同じレースの6艇の boats）を組み立てる。
 * 古い表の読みの差し替えと並べて置けば、移す前（RPC を呼ばない）と移した後のどちらでも同じ入力が届く。
 */

export const RACER_RUNS = /\/rest\/v1\/rpc\/get_racer_runs/;

export const isRacerRunsRequest = (url) =>
  new URL(url).pathname.endsWith("/rest/v1/rpc/get_racer_runs");

// 入力に無い値は null（古い差し替えが返さなかった列と同じ）
const RUN_DEFAULTS = {
  racerId: 4320, raceGrade: null, raceStage: null, raceTitle: null, weather: null, windSpeed: null, waveHeight: null,
  technique: null, payoutWin: null, payoutPlace1: null, payoutPlace2: null, raceStatus: null, exhibitionTime: null,
  startTiming: null, isFlying: false, finishMark: null, course: null,
};

const otherBoat = (b) => ({
  boat_number: b, racer_id: 9000 + b, course: null, start_timing: null, is_flying: false,
  finish_mark: null, finish_rank: null, exhibition_time: null,
});

/**
 * 1走の入力 → get_racer_runs の1要素。他の艇の ST・展示は入力に無ければ null（古い差し替えが本人の行だけを返したのと同じ）
 * @param {{ raceId: string, boat: number, racerId?: number, order: Array<number|null>, raceGrade?: string|null,
 *   raceStage?: string|null, raceTitle?: string|null, weather?: string|null, windSpeed?: number|null,
 *   waveHeight?: number|null, technique?: string|null, payoutWin?: number|null, payoutPlace1?: number|null,
 *   payoutPlace2?: number|null, raceStatus?: string|null, exhibitionTime?: number|null, startTiming?: number|null,
 *   isFlying?: boolean, finishMark?: string|null, course?: number|null }} input
 */
export function racerRunOf(input) {
  const run = { ...RUN_DEFAULTS, ...input };
  const at = run.order.indexOf(run.boat);
  const own = {
    boat_number: run.boat,
    racer_id: run.racerId,
    course: run.course,
    start_timing: run.startTiming,
    is_flying: run.isFlying === true,
    finish_mark: run.finishMark,
    finish_rank: at >= 0 ? at + 1 : null,
    exhibition_time: run.exhibitionTime,
  };
  const boats = [1, 2, 3, 4, 5, 6].map((b) => (b === run.boat ? own : otherBoat(b)));
  return {
    race_id: run.raceId,
    ...own,
    race: {
      venue_code: Number(run.raceId.slice(11, 13)),
      race_number: Number(run.raceId.slice(14, 16)),
      race_grade: run.raceGrade,
      stage_raw: run.raceStage,
      race_title: run.raceTitle,
      weather: run.weather,
      wind_speed: run.windSpeed,
      wave_height: run.waveHeight,
      technique: run.technique,
      payout_win: run.payoutWin,
      payout_place_1: run.payoutPlace1,
      payout_place_2: run.payoutPlace2,
      race_status: run.raceStatus,
      finish_order: run.order,
      racer_ids: boats.map((b) => b.racer_id),
    },
    boats,
  };
}

/** get_racer_runs をこの入力で答える（どの選手・期間で呼ばれても同じ走） */
export async function stubRacerRuns(page, runs) {
  await page.route(RACER_RUNS, (route) => route.fulfill({ json: runs.map(racerRunOf) }));
}
