/**
 * 選手ページの「3着以内のレースの3連単配当」（表と通算の推移）を、絞り込みが効く走ごとの履歴から数える
 * （G2、オーナー承認 2026-11-26。side-session-notes の g2-racer/tri。ファン4人の議論で形を決めた）。
 * - 表の行は 1着・2着・3着・全体。回数・1走あたり配当（その行の3連単の配当の合計 ÷ 絞り込みに合う全ての出走数）・
 *   配当の中央値（2回以下は値そのもの）・万舟（10,000円以上）の回数
 * - 「1走あたり配当」は舟券1点の成績ではない。円で出し、回収率・% と並べない（data-scientist 2026-11-26）
 * - 着順の付かない走（F・欠など）は3着以内に数えない。配当が無い走（null）は回数に入れ、配当の集計から外す
 */
import { matchesFilter } from "./racerBoatReturns.js";

/** 万舟とみなす3連単の配当（円、100円あたり）。ファンの通称 */
export const MANSHU_PAYOUT = 10000;
/** 推移の線を引き始める走（それより前は1回の配当で大きく揺れる。visual-designer・data-scientist 2026-11-26） */
export const TRIFECTA_TREND_START = 30;

/** その走で選手が何着か（1〜3）。3着以内でなければ 0 */
function positionOf(row) {
  if (row.unranked) return 0;
  const i = [row.rank1, row.rank2, row.rank3].indexOf(row.boatNumber);
  return i + 1;
}

function medianOf(values) {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function summarize(key, picked, runs) {
  const paid = picked.map((r) => r.payoutTrifecta).filter((v) => typeof v === "number");
  const sum = paid.reduce((a, b) => a + b, 0);
  return {
    key,
    count: picked.length,
    perRun: runs > 0 ? sum / runs : null,
    // 2回以下は中央値に意味が薄いので値そのもの（data-scientist 2026-11-26）
    median: paid.length > 2 ? medianOf(paid) : null,
    values: paid.length > 0 && paid.length <= 2 ? paid : null,
    manshu: paid.filter((v) => v >= MANSHU_PAYOUT).length,
  };
}

/**
 * @param {Array<Object>|null|undefined} history getRacerRaceHistory の走（raceId の昇順。payoutTrifecta を持つ）
 * @param {{venueCode:number|null, boatNumber:number|null, raceGrade:string|null, raceStage:string|null}} filter
 * @returns {{runs:number, rows:Array<{key:1|2|3|"all", count:number, perRun:number|null, median:number|null, values:number[]|null, manshu:number}>}}
 */
export function trifectaInvolvementRows(history, filter) {
  const matched = (history ?? []).filter((row) => matchesFilter(row, filter));
  const withPos = matched.map((row) => ({ ...row, pos: positionOf(row) }));
  const rows = [1, 2, 3].map((pos) => summarize(pos, withPos.filter((r) => r.pos === pos), matched.length));
  rows.push(summarize("all", withPos.filter((r) => r.pos > 0), matched.length));
  return { runs: matched.length, rows };
}

/**
 * 3着以内に入った走の3連単の配当の、各走の時点までの通算の1走あたり配当。TRIFECTA_TREND_START 走目から
 * @returns {Array<{raceId:string, date:string, value:number, manshu:number|null}>} 古い順。manshu は万舟の走のその配当
 */
export function trifectaInvolvementSeries(history, filter, start = TRIFECTA_TREND_START) {
  let n = 0;
  let sum = 0;
  const points = [];
  for (const row of history ?? []) {
    if (!matchesFilter(row, filter)) continue;
    const v = positionOf(row) > 0 && typeof row.payoutTrifecta === "number" ? row.payoutTrifecta : 0;
    n += 1;
    sum += v;
    if (n < start) continue;
    points.push({
      raceId: row.raceId,
      date: `${row.raceId.slice(5, 7)}/${row.raceId.slice(8, 10)}`,
      value: sum / n,
      manshu: v >= MANSHU_PAYOUT ? v : null,
    });
  }
  return points;
}
