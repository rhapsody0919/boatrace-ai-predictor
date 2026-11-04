/**
 * モーターの機力指数（BOA-265）と、その集計の期間（BOA-329）の純関数（BOA-1245）。
 *
 * supabaseDataService の getMotorPowerIndex・motorWindowStart の中にあった計算を、手を加えずに移した。
 * 画面（モーター調子・レース詳細のモータ情報・選手ページ）と龍神ボート番付
 * （scripts/sns/rank-data.js --dataset=motor_power）の両方がこれを使う。入力は取得済みの行だけ。
 *
 * Node から読むため、import は拡張子付き（ここは import なし）。
 */

/**
 * モーターの成績を「過去 days 日」で集計するときの開始日。現行モーターの世代（使用開始日以降）で切り詰める。
 * - since: max(使用開始日, 基準日−days)。使用開始日が不明なら null（集計しない）
 * - clippedByGeneration: 使用開始日で切り詰めたか
 * @param {string|null} generationStart YYYY-MM-DD
 * @param {number} days
 * @param {string} baseDate 基準日 YYYY-MM-DD（画面は JST の今日、過去レースはそのレースの日）
 * @returns {{since: string|null, generationStart: string|null, clippedByGeneration: boolean}}
 */
export function motorWindowFrom(generationStart, days, baseDate) {
  if (generationStart === null) {
    return { since: null, generationStart, clippedByGeneration: false };
  }
  const daysAgo = new Date(`${baseDate}T00:00:00Z`);
  daysAgo.setUTCDate(daysAgo.getUTCDate() - days);
  const windowStart = daysAgo.toISOString().split("T")[0];
  const clippedByGeneration = generationStart > windowStart;
  return {
    since: clippedByGeneration ? generationStart : windowStart,
    generationStart,
    clippedByGeneration,
  };
}

/**
 * 1機の機力指数。このモーターの出走ごとに「2着以内なら100、外なら0」から、その時に乗った選手の
 * 全国2連率（race_entries.global_2rate）を引き、平均する。結果の行が無い走・global_2rate の無い走は数えない。
 * 出走が無ければ null
 * @param {ReadonlyArray<{race_id: string, boat_number: number, global_2rate: number|null}>} entries
 * @param {Map<string, {rank1: number|null, rank2: number|null, rank3: number|null}>} resultByRaceId
 * @returns {{sample_count: number, actual_rate2: number, actual_rate3: number,
 *   avg_baseline_rate2: number, power_index: number}|null}
 */
export function computeMotorPowerIndex(entries, resultByRaceId) {
  const residuals = [];
  let actualHits2 = 0;
  let actualHits3 = 0;
  let baselineSum = 0;
  (entries ?? []).forEach((e) => {
    const result = resultByRaceId.get(e.race_id);
    if (!result || e.global_2rate === null) return;
    const isTop2 =
      result.rank1 === e.boat_number || result.rank2 === e.boat_number;
    const isTop3 = isTop2 || result.rank3 === e.boat_number;
    if (isTop2) actualHits2 += 1;
    if (isTop3) actualHits3 += 1;
    residuals.push((isTop2 ? 100 : 0) - e.global_2rate);
    baselineSum += e.global_2rate;
  });
  if (residuals.length === 0) return null;

  const powerIndex =
    residuals.reduce((sum, v) => sum + v, 0) / residuals.length;
  const avgBaseline = baselineSum / residuals.length;
  return {
    sample_count: residuals.length,
    actual_rate2: (actualHits2 / residuals.length) * 100,
    actual_rate3: (actualHits3 / residuals.length) * 100,
    avg_baseline_rate2: avgBaseline,
    power_index: powerIndex,
  };
}

/**
 * 会場の全機の機力指数（番付用）。entries は会場の期間のレースの全艇（motor_number つき）。
 * 機ごとに computeMotorPowerIndex を通す。出走の無い機（null）は返さない
 * @param {ReadonlyArray<{race_id: string, boat_number: number, motor_number: number|null, global_2rate: number|null}>} entries
 * @param {Map<string, {rank1: number|null, rank2: number|null, rank3: number|null}>} resultByRaceId
 * @returns {Array<{motor_number: number} & NonNullable<ReturnType<typeof computeMotorPowerIndex>>>} 機の番号の順
 */
export function computeVenueMotorPowerIndexes(entries, resultByRaceId) {
  const byMotor = new Map();
  (entries ?? []).forEach((e) => {
    if (e.motor_number === null || e.motor_number === undefined) return;
    if (!byMotor.has(e.motor_number)) byMotor.set(e.motor_number, []);
    byMotor.get(e.motor_number).push(e);
  });
  return [...byMotor.entries()]
    .map(([motorNumber, rows]) => {
      const index = computeMotorPowerIndex(rows, resultByRaceId);
      return index ? { motor_number: motorNumber, ...index } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.motor_number - b.motor_number);
}
