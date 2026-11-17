// #059669は白文字で3.77:1しかなくAA未達のため濃色に変更（axe-core検出、Holmes.jsxのTABS配列と統一）
export const THEME = "#047857";

/**
 * HolmesSherlock の純な計算（移すだけ）
 */

/** オッズ取得済みのレース数 */
export function countWithOdds(races) {
  return races.filter((r) => r.hasOdds).length;
}

/** EV≥1.15 の妙味候補（元の並びのまま） */
export function selectEvPicks(races) {
  return races.filter((r) => r.bestEv != null && r.bestEv >= 1.15);
}

/** 妙味候補の EV 降順上位5件（入力は壊さない） */
export function topEvPicks(evPicks) {
  return evPicks
    .slice()
    .sort((a, b) => b.bestEv - a.bestEv)
    .slice(0, 5);
}

/** 確率バーの幅（%）。最小 2% */
export function barWidthPct(pct) {
  return Math.max(pct, 2);
}

/** 発走時刻の表示（HH:MM） */
export function formatStartTime(startTime) {
  return startTime ? startTime.slice(0, 5) : "";
}
