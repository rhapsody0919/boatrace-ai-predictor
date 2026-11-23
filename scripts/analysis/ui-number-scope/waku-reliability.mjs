// 会場の枠番別1着率の会場差の信頼性（既存の venue-course-win-rate.json の by_waku から。DB に接続しない）
// 使い方: node scripts/analysis/ui-number-scope/waku-reliability.mjs [入力JSON] [出力JSON]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
const input = process.argv[2] ?? "data/analysis/venue-course-win-rate/venue-course-win-rate.json";
const output = process.argv[3] ?? "data/analysis/ui-number-scope/waku-reliability.json";
const src = JSON.parse(readFileSync(input, "utf8"));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const pvar = (a) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };
const wilsonHalf = (k, n, z = 1.96) => { const p = k / n, d = 1 + z * z / n; return (z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d; };
const r1 = (x) => Math.round(x * 10) / 10;
const periods = Object.fromEntries(Object.entries(src.periods).map(([key, P]) => {
  const venues = Object.values(P.venues);
  const ns = venues.map((v) => v.races).sort((a, b) => a - b);
  const byWaku = [1, 2, 3, 4, 5, 6].map((w) => {
    const cells = venues.map((v) => { const k = v.by_waku.find((x) => x.waku === w).wins; return { k, n: v.races, p: k / v.races }; });
    const obs = pvar(cells.map((c) => c.p));
    const noise = mean(cells.map((c) => c.p * (1 - c.p) / c.n));
    const halves = cells.map((c) => wilsonHalf(c.k, c.n)).sort((a, b) => a - b);
    return {
      waku: w,
      national_pct: r1(P.all.by_waku[w - 1].rate * 100),
      venue_min_pct: r1(Math.min(...cells.map((c) => c.p)) * 100),
      venue_max_pct: r1(Math.max(...cells.map((c) => c.p)) * 100),
      reliability: Math.round(Math.max(0, 1 - noise / obs) * 100) / 100,
      wilson95_halfwidth_median_pt: r1(halves[Math.floor(halves.length / 2)] * 100),
    };
  });
  return [key, { from: P.from, to: P.to, venues: venues.length, races_all: P.all.races, races_min: ns[0], races_median: ns[Math.floor(ns.length / 2)], by_waku: byWaku }];
}));
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({
  generated_at: new Date().toISOString(),
  source: input, source_sha256: src.content_sha256, source_generated_at: src.generated_at,
  definition: "1着艇の枠番（艇番）。分母は結果のあるレース（不成立を除く）。信頼性 = 1 − 二項の分散の平均 ÷ 会場間の観測分散",
  periods,
}, null, 2) + "\n");
console.log(JSON.stringify(periods["3m"].by_waku));
