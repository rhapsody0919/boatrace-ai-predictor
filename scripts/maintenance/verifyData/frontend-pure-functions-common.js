/**
 * verify-frontend-pure-functions.js の共通の道具（frontend-pure-functions-common.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { getDaysAgoJST } from "../../../src/utils/dateUtils.js";

export const show = (v) => JSON.stringify(v);

export const r2 = (v) =>
  v === null || v === undefined ? v : Math.round(v * 100) / 100;

// JST の今日から days 日前（BOA-554: 以前はローカル時刻で setDate したあと toISOString（UTC）で
// 取り出しており、JST 0〜9時は1日古くなった。境界から離して使うので実害は無かった）
export const daysAgo = (days) => getDaysAgoJST(days);

/**
 * getRacerScopedRaceStats の1行と同じ形のレコードを作る。
 * ranks は [1着艇, 2着艇, ..., 6着艇]（未取得・欠場の着は null）
 */
export function rec({
  raceId,
  date = raceId.slice(0, 10),
  venueCode = Number(raceId.slice(11, 13)),
  boatNumber,
  ranks = [1, 2, 3, 4, 5, 6],
  raceGrade = "ippan",
  startTiming = null,
  actualCourse = null,
  ...rest
}) {
  return {
    raceId,
    date,
    venueCode,
    boatNumber,
    raceGrade,
    rank1: ranks[0] ?? null,
    rank2: ranks[1] ?? null,
    rank3: ranks[2] ?? null,
    rank4: ranks[3] ?? null,
    rank5: ranks[4] ?? null,
    rank6: ranks[5] ?? null,
    startTiming,
    actualCourse,
    raceTitle: null,
    raceStage: null,
    winningTechnique: null,
    payoutWin: null,
    ...rest,
  };
}
