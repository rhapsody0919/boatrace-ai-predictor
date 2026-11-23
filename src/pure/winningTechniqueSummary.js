/**
 * 決まり手タブの結論の一言と枠ごとの1着率（#3258 の #5）。
 * winning_technique_stats の total_races は「その枠が1着になった数」なので、6枠の和が会場の母数になる
 * （中止・不成立・1着の艇が無い・決まり手が無いレースを除いた過去90日。docs/design/racer-wt-uiux-2026-11/analysis/number-scope.md）。
 */

/** 1着がこれ未満の枠は、割合でなく回数で書く（docs/knowledge/number-wording.md「30件未満は件数だけ」） */
export const SMALL_WIN_COUNT = 30;

const BOATS = [1, 2, 3, 4, 5, 6];

/**
 * @param {Record<number, {total_races:number, techniques:Array<{technique:string, count:number}>}>} data
 * @returns {{ total:number, boats:Array<{boat:number, wins:number, pct:number|null, small:boolean}>, boat1Nige:number|null }}
 */
export function winningTechniqueSummary(data) {
  const present = BOATS.filter((boat) => data?.[boat]);
  const total = present.reduce((sum, boat) => sum + (data[boat].total_races ?? 0), 0);
  const boats = present.map((boat) => {
    const wins = data[boat].total_races ?? 0;
    return {
      boat,
      wins,
      pct: total > 0 ? Math.round((wins / total) * 1000) / 10 : null,
      small: wins < SMALL_WIN_COUNT,
    };
  });
  const nige = data?.[1]?.techniques?.find((tech) => tech.technique === "逃げ");
  return { total, boats, boat1Nige: data?.[1] ? (nige?.count ?? 0) : null };
}
