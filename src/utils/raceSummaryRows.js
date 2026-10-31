/**
 * レース詳細の上の「6艇の要約」の行（BOA-1189 GS01-c、2026-10-31 オーナー決定）。純関数。
 *
 * - 並びは艇番のまま。色付けはしない（1号艇は同じ選手でも展示タイムが約0.017秒速く出るので、
 *   順位の色で「1号艇の足が良い」と読ませない。docs/knowledge/stat-findings.md「直前情報・展示」）
 * - 展示タイムの順位は小さいほど上。同タイムは同じ順位（競技順位方式、method=min。
 *   準優・優勝戦の1号艇は23%が他艇と同タイム。docs/knowledge/data-definitions.md）
 * - 着順は確定後だけ。結果に載っていない艇（失格・欠場等）は null
 */
import { competitionRank } from "./competitionRank.js";

const validTime = (v) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * @param {Array<{number: number, name?: string, racerId?: number|null, grade?: string}>} players
 * @param {Array<{boat_number: number, exhibition_time: number|null}>|null} exhibitionData
 * @param {{rank1?: number|null, rank2?: number|null, rank3?: number|null, rank4?: number|null, rank5?: number|null, rank6?: number|null}|null} result
 * @returns {{rows: Array<{number: number, name: string, racerId: number|null, grade: string|null, exhTime: number|null, exhRank: number|null, exhTied: boolean, finish: number|null}>, hasExhibition: boolean, hasResult: boolean}}
 */
export function buildRaceSummaryRows(players, exhibitionData, result) {
  const timeOf = new Map(
    (exhibitionData ?? []).map((e) => [
      Number(e.boat_number),
      validTime(e.exhibition_time),
    ]),
  );
  const times = [...timeOf.values()].filter((v) => v != null);
  const finishOf = new Map();
  if (result?.rank1) {
    [1, 2, 3, 4, 5, 6].forEach((pos) => {
      const boat = result[`rank${pos}`];
      if (boat != null && !finishOf.has(Number(boat)))
        finishOf.set(Number(boat), pos);
    });
  }
  const rows = (players ?? [])
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((p) => {
      const exhTime = timeOf.get(Number(p.number)) ?? null;
      const ranked =
        exhTime != null
          ? competitionRank(times, exhTime, { ascending: true })
          : null;
      return {
        number: p.number,
        name: (p.name ?? "").replace(/\s+/g, ""),
        racerId: p.racerId ?? null,
        grade: p.grade || null,
        exhTime,
        exhRank: ranked?.rank ?? null,
        exhTied: (ranked?.tied ?? 0) > 1,
        finish: finishOf.get(Number(p.number)) ?? null,
      };
    });
  return {
    rows,
    hasExhibition: times.length > 0,
    hasResult: finishOf.size > 0,
  };
}
