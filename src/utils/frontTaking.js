/**
 * 「イン屋」の判定（前付けの割合、BOA-1422・BOA-1250。#2169 の作り直し）。純関数で、DB・追加のクエリは持たない。
 *
 * 入力は getRacerScopedRaceStats の行（boatNumber・actualCourse・raceId）。
 * - 前付け = 枠番より内のコースに入った走。1号艇はこれより内が無いので母数に入れない
 * - 母数 = 2〜6号艇で出て、進入コース（actualCourse）が記録されている走
 * - beforeRaceId を渡すと、そのレースより前の走だけを使う（レース詳細で、そのレース自身や
 *   後の結果を札の判定に混ぜない）
 */

// 札を付ける下限。母数が少ないと数走の前付けで札が付くので、走数の下限を置く
export const FRONT_TAKING_MIN_RUNS = 20;
// 前付けの割合（%）がこれ以上で札を付ける
export const FRONT_TAKING_MIN_RATE = 30;

// 2〜6号艇の走か（1号艇はこれより内が無いので母数に入れない）
const isOuterBoat = (r) => Number.isInteger(r?.boatNumber) && r.boatNumber >= 2;

// beforeRaceId より前のレースか（beforeRaceId が無ければ全部）
const isBefore = (r, beforeRaceId) => !beforeRaceId || r.raceId < beforeRaceId;

// 進入コースが 1〜6 で記録されているか
const hasValidCourse = (r) =>
  Number.isInteger(r.actualCourse) &&
  r.actualCourse >= 1 &&
  r.actualCourse <= 6;

// 母数に入る走か
const isCountedRun = (r, beforeRaceId) =>
  isOuterBoat(r) && isBefore(r, beforeRaceId) && hasValidCourse(r);

// 前付け = 枠番より内のコースに入った走
const isFrontTaken = (r) => r.actualCourse < r.boatNumber;

// 前付けの走をコース別に数える（byCourse[i] はコース i+1）
const countByCourse = (takenRuns) =>
  takenRuns.reduce(
    (acc, r) => {
      acc[r.actualCourse - 1] += 1;
      return acc;
    },
    [0, 0, 0, 0, 0],
  );

const isInyaRate = (runs, rate) =>
  runs >= FRONT_TAKING_MIN_RUNS &&
  rate !== null &&
  rate >= FRONT_TAKING_MIN_RATE;

/**
 * @param {Array<{raceId: string, boatNumber: number, actualCourse: number|null}>|null|undefined} records
 * @param {{beforeRaceId?: string|null}} [options]
 * @returns {{runs: number, taken: number, rate: number|null,
 *   byCourse: number[], isInya: boolean}}
 *   byCourse[i] はコース i+1 に入った前付けの走数（1〜5コース）
 */
export function summarizeFrontTaking(records, { beforeRaceId = null } = {}) {
  const counted = [...(records ?? [])].filter((r) =>
    isCountedRun(r, beforeRaceId),
  );
  const takenRuns = counted.filter(isFrontTaken);
  const runs = counted.length;
  const taken = takenRuns.length;
  const rate = runs > 0 ? (taken / runs) * 100 : null;
  return {
    runs,
    taken,
    rate,
    byCourse: countByCourse(takenRuns),
    isInya: isInyaRate(runs, rate),
  };
}
