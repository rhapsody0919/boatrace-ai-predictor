/**
 * BOA-822 イン崩れ注意度: 朝の生成（generate-unified-predictions.js）がレースごとの値を決める純関数。
 * docs/design/in-collapse-caution/plan.md §1。DB には繋がない。
 *
 * - toInCautionRates: RPC get_in_caution_band_rates の行 → (ラウンド, 帯) ごとの合計と、表が欠けていないかの判定
 * - computeInCaution: 出走表（race_entries）とレースの名前 → feature_contributions.inCaution か、出さない理由（skip）
 *
 * 段・帯の判定は画面と同じ src/utils/inCautionLevel.js（DRY、生成と画面で同じ関数）。
 */
import { IN_CAUTION_CONFIG } from "../../src/constants/inCautionConfig.js";
import {
  bandOf,
  levelOf,
  pctOf,
  rateCents,
  roundOf,
} from "../../src/utils/inCautionLevel.js";

const MS_PER_DAY = 86400000;
const STALE_DAYS = 3; // last_date が前日より3日以上古ければ表が欠けているとみなす

const daysBetween = (a, b) =>
  Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / MS_PER_DAY,
  );

/**
 * RPC の行 → 生成が使う形。usable が false なら全レースを出さない（rates_unavailable）。
 * 表が欠けている: first_date が config の from より後、last_date が前日より3日以上古い、合計の n が minTotalN 未満
 * （初回の full の前・full の失敗後に、直近14日分だけの表から、もっともらしいが違う率を書かない。system-architect M2）
 *
 * @param {Array<{round_grp:string, gap_band:number, n:number|string, non_win:number|string,
 *   first_date:string, last_date:string}>} rows
 * @param {string} previousDay 対象日の前日（YYYY-MM-DD、JST）
 * @returns {{cells: Map<string, {n:number, nonWin:number}>, base: {n:number, nonWin:number},
 *   through: string|null, usable: boolean, reason: string|null}}
 */
export function toInCautionRates(rows, previousDay) {
  const cells = new Map();
  const base = { n: 0, nonWin: 0 };
  for (const r of rows ?? []) {
    const n = Number(r.n);
    const nonWin = Number(r.non_win);
    cells.set(`${r.round_grp}|${Number(r.gap_band)}`, { n, nonWin });
    base.n += n;
    base.nonWin += nonWin;
  }
  const first = rows?.[0]?.first_date ?? null;
  const through = rows?.[0]?.last_date ?? null;
  const { from, minTotalN } = IN_CAUTION_CONFIG;
  let reason = null;
  if (!through) reason = "表が空";
  else if (first > from) reason = `最初の日 ${first} が ${from} より後`;
  else if (daysBetween(through, previousDay) >= STALE_DAYS)
    reason = `最後の日 ${through} が前日 ${previousDay} より${STALE_DAYS}日以上古い`;
  else if (base.n < minTotalN)
    reason = `合計の件数 ${base.n} が ${minTotalN} 未満`;
  return { cells, base, through, usable: reason === null, reason };
}

/**
 * レースの注意度。出さないときは inCaution: null と理由（監視用。画面は読まない）。
 *
 * @param {{entries: Array<{boat_number:number, win_rate:number|string|null, is_absent?:boolean|null}>,
 *   raceStage: string|null|undefined, rates: ReturnType<typeof toInCautionRates>|null}} params
 * @returns {{inCaution: object|null, skip: string|null}}
 */
export function computeInCaution({ entries, raceStage, rates }) {
  const skip = (reason) => ({ inCaution: null, skip: reason });
  const boat1 = entries.find((e) => e.boat_number === 1);
  if (!boat1 || boat1.is_absent === true) return skip("boat1_absent");
  // 勝率が無い＝NULL だけ。0.00 は勝率（新人。統計検証も 0.00 を数えている）
  const b1 = rateCents(boat1.win_rate);
  if (b1 === null) return skip("boat1_no_rate");

  const others = entries.filter(
    (e) => e.boat_number >= 2 && e.boat_number <= 6,
  );
  const absentBoats = others
    .filter((e) => e.is_absent === true)
    .map((e) => e.boat_number)
    .sort((a, b) => a - b);
  if (absentBoats.length >= 2) return skip("multi_absent");

  // 最大が同点なら艇番の小さい方
  let top = null;
  for (const e of [...others].sort((a, b) => a.boat_number - b.boat_number)) {
    if (e.is_absent === true) continue;
    const c = rateCents(e.win_rate);
    if (c !== null && (top === null || c > top.cents))
      top = { boat: e.boat_number, cents: c, rate: Number(e.win_rate) };
  }
  if (top === null) return skip("others_no_rate");

  if (!rates?.usable) return skip("rates_unavailable");

  const gapCents = b1 - top.cents;
  const band = bandOf(gapCents);
  const round = roundOf(raceStage);
  const cell = rates.cells.get(`${round}|${band}`);
  // セルが無い・件数が少ないセル（準優・優勝戦の端の帯）は出さない（2026-10-13 ユーザー決定）
  if (!cell || cell.n < IN_CAUTION_CONFIG.minCellN) return skip("sparse_cell");

  const pct = pctOf(cell.nonWin, cell.n);
  return {
    inCaution: {
      pct,
      n: cell.n,
      nonWin: cell.nonWin,
      level: levelOf(pct),
      gapCents,
      band,
      round,
      boat1WinRate: Number(boat1.win_rate),
      topOtherBoat: top.boat,
      topOtherWinRate: top.rate,
      basePct: pctOf(rates.base.nonWin, rates.base.n),
      absentBoats,
      lowSample: cell.n < IN_CAUTION_CONFIG.lowSampleN,
      through: rates.through,
      def: IN_CAUTION_CONFIG.def,
    },
    skip: null,
  };
}
