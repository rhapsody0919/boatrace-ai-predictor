/**
 * グランプリの特集（/grandprix）の日数の帯と金額の書き方（BOA-1724）。日付は JST の暦の日（YYYY-MM-DD）で数える。
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const toUtc = (ymd) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10)));

/**
 * @param {string} today - JST の今日（YYYY-MM-DD）
 * @param {{startDate: string, endDate: string}} edition
 * @returns {{phase: "before", days: number} | {phase: "during", day: number} | {phase: "after"}}
 */
export function grandPrixPhase(today, { startDate, endDate }) {
  const t = toUtc(today);
  if (t < toUtc(startDate)) return { phase: "before", days: Math.round((toUtc(startDate) - t) / DAY_MS) };
  if (t > toUtc(endDate)) return { phase: "after" };
  return { phase: "during", day: Math.round((t - toUtc(startDate)) / DAY_MS) + 1 };
}

/** 円を「1億9,659万」「9,576万」の形に（万円未満は四捨五入、丸めは1回だけ） */
export function formatYenMan(yen) {
  const man = Math.round(yen / 10000);
  const oku = Math.floor(man / 10000);
  const rest = man % 10000;
  if (oku === 0) return `${rest.toLocaleString("ja-JP")}万`;
  return rest === 0 ? `${oku}億` : `${oku}億${rest.toLocaleString("ja-JP")}万`;
}
