/**
 * 選手ページの枠番別回収率（表と、枠番ごとの通算の推移）を、絞り込みが効く走ごとの履歴から数える
 * （G2、オーナー承認 2026-11-26。side-session-notes の g2-racer/rr2・rr3）。
 * 払戻の積み方は src/utils/racerVenueBoatStats.js の addPayouts と同じ: 1着なら単勝と複勝の1着側、
 * 2着なら複勝の2着側。着順の付かない走（F・欠など、unranked）は払戻なし。
 * 回収率は払戻金（100円あたり）の合計 ÷（走数×100円）。走数の線で隠さない（オーナー 2026-11-24）
 */

/** 推移の線に印を付ける単勝の払戻金（円、100円あたり）の下限。目安（根拠なし） */
export const BIG_WIN_PAYOUT = 1000;

const BOATS = [1, 2, 3, 4, 5, 6];

/**
 * 会場・枠番・グレード・レース種別の完全一致（null は絞り込みなし）。
 * racerVenueBoatStats.js の matchesRacerFilter と同じ
 */
function matchesFilter(row, { venueCode, boatNumber, raceGrade, raceStage }) {
  if (venueCode && row.venueCode !== venueCode) return false;
  if (boatNumber && row.boatNumber !== boatNumber) return false;
  if (raceGrade && row.raceGrade !== raceGrade) return false;
  if (raceStage && row.raceStage !== raceStage) return false;
  return true;
}

/** 1走の単勝・複勝の払戻金（100円あたり）と1着か */
function payoutsOf(row) {
  if (row.unranked) return { win: 0, place: 0, isWin: false };
  if (row.rank1 === row.boatNumber) {
    return { win: row.payoutWin ?? 0, place: row.payoutPlace1 ?? 0, isWin: true };
  }
  if (row.rank2 === row.boatNumber) {
    return { win: 0, place: row.payoutPlace2 ?? 0, isWin: false };
  }
  return { win: 0, place: 0, isWin: false };
}

const rateOf = (sum, n) => (n > 0 ? (sum / (n * 100)) * 100 : null);

/**
 * 枠番ごとの走数・1着の回数・単勝と複勝の回収率（%）。枠番を固定しているときはその1行だけ
 * @param {Array<Object>|null|undefined} history getRacerRaceHistory の走（raceId の昇順）
 * @param {{venueCode:number|null, boatNumber:number|null, raceGrade:string|null, raceStage:string|null}} filter
 * @returns {Array<{boat:number, n:number, wins:number, winReturn:number|null, placeReturn:number|null, topWinShare:number|null}>}
 *   topWinShare は単勝の払戻のうち最大の1回が占める割合（0〜1。1着が無ければ null）
 */
export function boatReturnRows(history, filter) {
  const boats = filter.boatNumber ? [filter.boatNumber] : BOATS;
  const acc = new Map(boats.map((b) => [b, { n: 0, wins: 0, win: 0, place: 0, topWin: 0 }]));
  for (const row of history ?? []) {
    const a = acc.get(row.boatNumber);
    if (!a || !matchesFilter(row, filter)) continue;
    const p = payoutsOf(row);
    a.n += 1;
    a.wins += p.isWin ? 1 : 0;
    a.win += p.win;
    a.topWin = Math.max(a.topWin, p.win);
    a.place += p.place;
  }
  return boats.map((boat) => {
    const a = acc.get(boat);
    return {
      boat,
      n: a.n,
      wins: a.wins,
      winReturn: rateOf(a.win, a.n),
      placeReturn: rateOf(a.place, a.n),
      topWinShare: a.win > 0 ? a.topWin / a.win : null,
    };
  });
}

/**
 * 1つの枠番の、各走の時点までの通算の回収率（%）。古い順
 * @returns {Array<{raceId:string, date:string, win:number, place:number, bigWin:number|null}>}
 *   date は MM/DD。bigWin は単勝の払戻金が BIG_WIN_PAYOUT 以上だった走のその払戻金
 */
export function boatReturnSeries(history, filter, boat) {
  let n = 0;
  let win = 0;
  let place = 0;
  const points = [];
  for (const row of history ?? []) {
    if (row.boatNumber !== boat || !matchesFilter(row, filter)) continue;
    const p = payoutsOf(row);
    n += 1;
    win += p.win;
    place += p.place;
    points.push({
      raceId: row.raceId,
      date: `${row.raceId.slice(5, 7)}/${row.raceId.slice(8, 10)}`,
      win: rateOf(win, n),
      place: rateOf(place, n),
      bigWin: p.isWin && p.win >= BIG_WIN_PAYOUT ? p.win : null,
    });
  }
  return points;
}
