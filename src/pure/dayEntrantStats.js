/**
 * 今日出走する選手の勝率の分布（基本情報タブの勝率バーに「今日の真ん中」の線を引く、意味づけ 2026-11-28）。
 * 出走表の表には位置を出さない（オーナー「表には不要、グラフには入れるのはアリかも」）。
 * 物差しは今日の出走者（オーナー 2026-11-28 が決めた）。値はページが既に持つその日の全レース（/api/predictions）から作る
 * （system-architect 2026-11-28: 新しい取得は要らない）。
 * 母集団が200人未満（朝の取り込みの途中など）は出さない（data-scientist の目安、根拠なし）。
 */

export const DAY_MIN_RACERS = 200;

const valueOf = (raw) => {
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/**
 * その日の全レースの出走者を、選手ごとに1つの値にまとめる（同じ日に2走する選手を2回数えない）。
 * racerId が無い行・値が空・0 の選手は外す
 * @param {{players?: {racerId?: number|null, [field: string]: unknown}[]}[]} races
 * @param {string} field
 * @returns {number[]}
 */
export function collectDayEntrantValues(races, field) {
  const byRacer = new Map();
  for (const race of races ?? []) {
    for (const p of race?.players ?? []) {
      if (p?.racerId == null) continue;
      const v = valueOf(p[field]);
      if (v !== null) byRacer.set(p.racerId, v);
    }
  }
  return [...byRacer.values()];
}

/**
 * 分布の最小・最大・真ん中（中央値）。200人未満なら null
 * @returns {{n: number, min: number, max: number, median: number} | null}
 */
export function dayDistribution(values) {
  if ((values?.length ?? 0) < DAY_MIN_RACERS) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { n: sorted.length, min: sorted[0], max: sorted.at(-1), median: Math.round(median * 100) / 100 };
}
