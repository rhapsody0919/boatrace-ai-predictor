/**
 * レース詳細のタブの上の出走6艇（BOA-1189 GS01-c）の行。艇番順、選手名は空白を詰める。
 * 画面（RaceEntrantsSummary）とボット向け HTML（api/_lib/botRace.js）が同じ行を出すため、ここで1回だけ組む。
 * Node からも import するため、ブラウザ専用の依存を持ち込まない
 *
 * @param {{number: number, name?: string|null, racerId?: number|null, grade?: string|null}[]|null|undefined} players
 * @returns {{number: number, name: string, racerId: number|null, grade: string|null}[]}
 */
export function entrantRowsOf(players) {
  // 艇番が無い行は並べられないので外す（並びが壊れ、key も重なるため）
  return (players ?? [])
    .filter((p) => Number.isInteger(p?.number))
    .map((p) => ({
      number: p.number,
      name: (p.name ?? "").replace(/\s+/g, ""),
      racerId: p.racerId ?? null,
      grade: p.grade || null,
    }))
    .sort((a, b) => a.number - b.number);
}
