/**
 * 新しいモーターの最初の開催で、公式の2連率が 0 のときに何を出すか（BOA-830、
 * 2026-10-11 ユーザー決定「艇ごとに、公式が0のときだけ自前の値」）。
 *
 * 公式の出走表のモーター2連率・3連率は、入れ替え後の最初の節の間は全艇 0 のまま
 * （2節目の初日から入り、節の途中は固定）。そのまま出すと全行 0.0% になる。
 *
 * - 公式 > 0 → 公式。入れ替えから90日以内は「前の節までの走り（N走）」を添える
 * - 公式 = 0 で、この世代でこのレースより前に 0走 → 「まだ走っていません」
 * - 公式 = 0 で、走ったが2着以内 0回 → 「0%（N走）」
 * - 公式 = 0 で、2着以内 1回以上 → 自前の値（現世代の開始日以降・このレースより前）に印
 *
 * 自前の値は getRaceMotorBreakdown の generation_* 列（getMotorPowerIndex の
 * beforeRaceId）。世代が分からない・入れ替え前のレースでは列が null で、公式のまま出す。
 */

/** 入れ替えから何日以内なら、公式の値に「前の節までの走り（N走）」を添えるか */
export const FRESH_MOTOR_WINDOW_DAYS = 90;

/**
 * 入れ替えから FRESH_MOTOR_WINDOW_DAYS 日以内か（使用開始日の当日を0日目とする）
 * @param {string|null} generationStart YYYY-MM-DD
 * @param {string} raceDate YYYY-MM-DD
 * @returns {boolean}
 */
export function isWithinFreshMotorWindow(generationStart, raceDate) {
  if (!generationStart || raceDate < generationStart) return false;
  const elapsed =
    (new Date(`${raceDate}T00:00:00Z`) -
      new Date(`${generationStart}T00:00:00Z`)) /
    86400000;
  return elapsed <= FRESH_MOTOR_WINDOW_DAYS;
}

function toRate(v) {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * 一覧の2連率（公式の列）に出すもの。
 * @param {object} row getRaceMotorBreakdown の行
 * @returns {{kind: "official", value: number|null, priorRuns: number|null}
 *   | {kind: "notRun"}
 *   | {kind: "zero", runs: number}
 *   | {kind: "own", value: number, runs: number}}
 */
export function motorRateView(row) {
  const official =
    row.rate_source === "official"
      ? toRate(row.motor_2rate)
      : toRate(row.official_2rate);
  const runs = row.generation_runs;
  // 自前の値が無い（世代が分からない・入れ替え前のレース）か、公式が出ている
  if (official !== 0 || runs === null || runs === undefined) {
    return {
      kind: "official",
      value: official,
      priorRuns: official !== null ? (row.prior_meet_runs ?? null) : null,
    };
  }
  if (runs === 0) return { kind: "notRun" };
  const own2 = toRate(row.generation_rate2);
  if (own2 === null || own2 === 0) return { kind: "zero", runs };
  return { kind: "own", value: own2, runs };
}

/**
 * 過去レースの3連率の列（公式の値）に出すもの。2連率と同じ決まりを3連率に当てる
 * （公式 > 0 なら公式、0 なら自前）。2連率だけ差し替えると、同じ行の3連率の 0.0 が
 * 「3着以内が一度も無い」と読まれる
 * @param {object} row
 * @returns {{kind: "official"|"own", value: number|null} | {kind: "notRun"}}
 */
export function motorRate3View(row) {
  const official = toRate(row.motor_3rate);
  const runs = row.generation_runs;
  if (official !== 0 || runs === null || runs === undefined) {
    return { kind: "official", value: official };
  }
  if (runs === 0) return { kind: "notRun" };
  return { kind: "own", value: toRate(row.generation_rate3) };
}
