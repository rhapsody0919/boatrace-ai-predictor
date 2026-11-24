/**
 * 選手の勝率の推移を公式の期ごとの段で出すための形（2026-11-24 オーナー決定「勝率は期ごとの段」）。
 * 値は公式の期別成績（racer_period_stats、fan）の勝率。横の札は算出期間（成績を取った期間）で書く。
 * 公式の「Y年前期・後期」は級を使う期の名前で、算出期間とは半年ずれるため札に使わない。
 * 出走表の全国勝率は期の値ではない（直近の成績から算出した値）ので、段に混ぜない。
 *
 * 期は「レース日より前に終わった期」の直近5つ（getRacerPeriodStats が取る範囲）。
 * 直前に終わった期をまだ取り込んでいないとき（latestImported が false）はその期を外し、残りの4つを出して
 * pending に外した期を入れる（PeriodBox の前期と同じ判定。src/pure/basicInfoStatsPeriodMeet.js）。
 */
import {
  periodsEndedBefore,
  RECENT_PERIOD_COUNT,
} from "./basicInfoStatsPeriodMeet.js";

/**
 * @param {{rows: Array<Object>, latestImported?: boolean}|null|undefined} result getRacerPeriodStats の戻り値
 * @param {Array<number>} racerIds 6艇の登録番号
 * @param {string} raceDate `YYYY-MM-DD`
 * @returns {{periods: Array<{calcFrom: string, calcTo: string}>,
 *            byRacer: Map<number, Array<{winRate: number, starts: number|null}|null>>,
 *            pending: {calcFrom: string, calcTo: string}|null}|null}
 *   periods は古い順。byRacer の各配列は periods と同じ並びで、記録の無い期（出走0・休み・登録前）は null。
 *   取得前・取得できない（rows が無い）ときは null
 */
export function winRateSteps(result, racerIds, raceDate) {
  if (!Array.isArray(result?.rows)) return null;
  const all = periodsEndedBefore(raceDate, RECENT_PERIOD_COUNT + 1);
  if (all.length === 0) return null;
  const notYet = result.latestImported === false;
  const shown = (notYet ? all.slice(1) : all).slice().reverse();
  const byRacer = new Map(
    racerIds.filter(Boolean).map((id) => [
      id,
      shown.map((p) => {
        const row = result.rows.find(
          (r) =>
            r.racer_id === id &&
            r.period_year === p.periodYear &&
            r.period_no === p.periodNo,
        );
        // 出走0の期は win_rate が NULL（fanPeriodRows）。段を描かない
        return row && row.win_rate !== null && row.win_rate !== undefined
          ? { winRate: Number(row.win_rate), starts: row.starts ?? null }
          : null;
      }),
    ]),
  );
  return {
    periods: shown.map(({ calcFrom, calcTo }) => ({ calcFrom, calcTo })),
    byRacer,
    pending: notYet
      ? { calcFrom: all[0].calcFrom, calcTo: all[0].calcTo }
      : null,
  };
}

/**
 * 段の札の2行の部品（例 24/05〜10月、年をまたぐ期は 24/11〜25/04。visual-designer 11/25）。
 * 文字（「〜」「月」）は呼び手が訳の文で付ける
 * @param {{calcFrom: string, calcTo: string}} period
 * @returns {{from: string, to: string, month: number|null}} month は同じ年に終わる期の終わりの月（to は使わない）
 */
export function stepLabelParts({ calcFrom, calcTo }) {
  const ym = (d) => `${d.slice(2, 4)}/${d.slice(5, 7)}`;
  const sameYear = calcFrom.slice(0, 4) === calcTo.slice(0, 4);
  return {
    from: ym(calcFrom),
    to: ym(calcTo),
    month: sameYear ? Number(calcTo.slice(5, 7)) : null,
  };
}
