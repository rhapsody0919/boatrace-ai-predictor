/**
 * 選手の推移の線の下の段（レーン B の after B、オーナー 2026-11-25 承認のモック mock-motor-trend/mock.html の afterB）の計算。
 * 選んだ艇の走を節に分け、節ごとにその選手が乗ったモーターの号機と、その節の会場の中のモーター2連率の順位（上・中・下）を出す。
 *
 * 検証（scripts/analysis/motor-trend-window/racer_motor_change.py、docs/design/indicator-parts/analysis/motor-trend-window.md）と同じ定義:
 * - 選手の節: 会場が替わるか、前の走から4日以上あいたら次の節
 * - 順位: 出走表のモーター2連率（0 より大きい行だけ）の、会場×節の全ての行の中のパーセンタイル（同じ値は平均の順位）
 * - 3区分: 1/3 以下が下・2/3 以下が中・それより上が上
 */

/** 同じ節とみなす走の間の日数の上限（検証の gap > 3 で次の節） */
export const MEET_GAP_DAYS = 3;

const dayOf = (raceId) => Date.parse(`${raceId.slice(0, 10)}T00:00:00Z`);
const venueOf = (raceId) => Number(raceId.slice(11, 13));

/**
 * 走（raceId の昇順）を選手の節に分ける。
 * @param {string[]} raceIds YYYY-MM-DD-VV-RR の昇順（推移の線の点の順）
 * @returns {Array<{venue:number, start:string, end:string, from:number, to:number, raceIds:string[]}>}
 *   from・to は raceIds の添字（両端を含む）
 */
export function racerMeetsOf(raceIds) {
  const meets = [];
  raceIds.forEach((raceId, i) => {
    const last = meets.at(-1);
    const prev = raceIds[i - 1];
    const same =
      last &&
      venueOf(raceId) === last.venue &&
      (dayOf(raceId) - dayOf(prev)) / 86400000 <= MEET_GAP_DAYS;
    if (same) {
      last.end = raceId.slice(0, 10);
      last.to = i;
      last.raceIds.push(raceId);
    } else {
      meets.push({ venue: venueOf(raceId), start: raceId.slice(0, 10), end: raceId.slice(0, 10), from: i, to: i, raceIds: [raceId] });
    }
  });
  return meets;
}

const isRate = (v) => typeof v === "number" && Number.isFinite(v) && v > 0;

/**
 * 値の、行の集まりの中のパーセンタイル（pandas の rank(pct=True)、同じ値は平均の順位）。
 * @param {number[]} pool 会場×節の行のモーター2連率（0 以下・null は数えない）
 * @param {number} value
 * @returns {number|null} 0〜1。値か行が無ければ null
 */
export function motorRankPct(pool, value) {
  const rates = pool.filter(isRate);
  if (!isRate(value) || rates.length === 0) return null;
  const below = rates.filter((r) => r < value).length;
  const same = rates.filter((r) => r === value).length;
  // 値そのものが行に無いとき（集まりの外の値）は、その位置に1行足した順位にする
  const n = same === 0 ? rates.length + 1 : rates.length;
  return (below + (Math.max(same, 1) + 1) / 2) / n;
}

/** パーセンタイルの3区分（検証の pd.cut(mrank, [0, 1/3, 2/3, 1])） */
export function motorRankTier(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct <= 1 / 3) return "low";
  if (pct <= 2 / 3) return "mid";
  return "high";
}

/**
 * 節ごとの段。
 * @param {string[]} raceIds 推移の線の点の raceId（昇順）
 * @param {Map<string, {motorNumber:number|null, motor2Rate:number|null}>} ownByRace その選手の走の出走表の行
 * @param {(meet: ReturnType<typeof racerMeetsOf>[number]) => number[]} poolOf その節の会場の全ての行のモーター2連率
 * @returns {Array<ReturnType<typeof racerMeetsOf>[number] & {motorNumber:number|null, motor2Rate:number|null, pct:number|null, tier:"low"|"mid"|"high"|null}>}
 *   号機と2連率は節の最初の、行のある走から（節の中で替わるのは 0.47%）
 */
export function meetMotorBand(raceIds, ownByRace, poolOf) {
  return racerMeetsOf(raceIds).map((meet) => {
    const own = meet.raceIds.map((id) => ownByRace.get(id)).find((r) => r && r.motorNumber != null) ?? null;
    const motor2Rate = own?.motor2Rate ?? null;
    const pct = isRate(motor2Rate) ? motorRankPct(poolOf(meet), motor2Rate) : null;
    return { ...meet, motorNumber: own?.motorNumber ?? null, motor2Rate, pct, tier: motorRankTier(pct) };
  });
}
