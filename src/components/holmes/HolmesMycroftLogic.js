/**
 * HolmesMycroft の純な計算（移すだけ）
 */

// #ca8a04は白文字で2.94:1しかなくAA未達のため濃色に変更（axe-core検出、Holmes.jsxのTABS配列と統一）
export const THEME = "#92400e";

export function formatJstTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch {
    return null;
  }
}

export function formatTop1(info) {
  return info.metrics
    ? `${(info.metrics.top1_hit_rate * 100).toFixed(1)}%`
    : "—";
}

export function formatVsWatson(info) {
  return info.vsWatson
    ? `ワトソン: ${(info.vsWatson.top1_hit_rate * 100).toFixed(1)}%`
    : "（本命艇が1着になる率）";
}

export function formatGain(gain) {
  return gain != null ? `${gain >= 0 ? "+" : ""}${gain.toFixed(4)}` : "—";
}

export function formatDeltaR2(info) {
  return info.deltaR2 != null
    ? `${info.deltaR2 >= 0 ? "+" : ""}${info.deltaR2.toFixed(3)}`
    : "—";
}

export function formatNRaces(info) {
  return info.nRaces?.toLocaleString() ?? "—";
}

export function formatTrainedAt(info) {
  return info.trainedAt ? info.trainedAt.slice(0, 10) : "—";
}

export function barWidth(prob, maxProb) {
  return `${Math.max((prob / maxProb) * 100, 2)}%`;
}

export function formatPercent(prob) {
  return `${(prob * 100).toFixed(1)}%`;
}

export function memoryWeights(items) {
  const maxWeight = Math.max(...items.map((it) => it.weight), 1e-6);
  return items.map((it) => `${(it.weight / maxWeight) * 100}%`);
}

export function raceTopInfo(race) {
  const topBoat = race.rankOrder[0];
  const topProb = race.winProbs[String(topBoat)] ?? 0;
  return { topBoat, topProb, maxProb: Math.max(topProb, 1e-6) };
}

export function summaryUpdatedAt(races) {
  return races.length > 0 ? formatJstTime(races[0].predictedAt) : null;
}
