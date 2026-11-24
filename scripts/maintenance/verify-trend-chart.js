#!/usr/bin/env node
/**
 * 6艇の推移の線（src/components/race/basic-info/TrendChart.jsx）の描き方の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った点で静的に描いて SVG を調べる）。
 *
 * 守ること（オーナー 2026-11-24 承認のモック改訂3）:
 *   - 線は艇ごとに1本。選んだ艇だけ太線（3）、ほかは細線
 *   - 1号艇・2号艇の線には縁を付ける（白・黒が地に溶けるため）
 *   - 選んだ艇の30日以上の空きに「◯日あき」の印。ほかの艇の空きには付けない
 *   - 右端の値は率なら小数1桁、平均ST は小数2桁。平均ST は小さいほど上に描く
 *   - 偶然の幅の帯は描かない（多角形を描かない）
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trendSeries } from "../../src/pure/racerTrendSeries.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundled = await bundle({
  stdin: {
    contents: 'export { default as TrendChart } from "./TrendChart.jsx";',
    resolveDir: path.join(ROOT, "src/components/race/basic-info"),
    loader: "js",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "offline",
      setup(b) {
        b.onResolve({ filter: /^react-i18next$/ }, () => ({
          path: "i18n",
          namespace: "offline",
        }));
        b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents:
            "export const useTranslation = () => ({ t: (k, v = {}) => k === 'basicInfo.trend.gap' ? `${v.days}日あき` : k });",
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const { TrendChart } = mod.exports;

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

const day = (n) =>
  new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
// 艇 b の走。gapAt の走の前に45日空ける。ST は艇ごとに一定
const runs = (b, gapAt = -1) =>
  Array.from({ length: 70 }, (_, i) => ({
    raceId: `${day(i + (gapAt >= 0 && i >= gapAt ? 45 : 0))}-02-01`,
    boatNumber: 1,
    rank1: 3,
    rank2: (i + b) % 3 === 0 ? 1 : 4,
    rank3: 5,
    startTiming: 0.1 + b / 100,
  }));
const seriesFor = (metric, gapBoat) =>
  new Map(
    [1, 2, 3, 4, 5, 6].map((b) => [
      b,
      trendSeries(runs(b, b === gapBoat ? 60 : -1), metric),
    ]),
  );
const svgOf = (metric, selected, gapBoat) =>
  renderToStaticMarkup(
    createElement(TrendChart, {
      seriesByBoat: seriesFor(metric, gapBoat),
      metric,
      selected,
    }),
  );

const svg = svgOf("top3Rate", 3, 3);
const strokes = [
  ...svg.matchAll(/<polyline class="trc-stroke"[^>]*stroke-width="([\d.]+)"/g),
].map((m) => Number(m[1]));
check("線は6本", strokes.length === 6, String(strokes.length));
check(
  "太線は1本（3）",
  strokes.filter((w) => w === 3).length === 1,
  JSON.stringify(strokes),
);
check(
  "1号艇・2号艇だけ縁",
  (svg.match(/class="trc-halo"/g) ?? []).length === 2,
);
// 前の走から46日（45日の空き＋1日おき）
check("選んだ艇の空きに印", svg.includes("46日あき"));
check("帯（多角形）を描かない", !svg.includes("<polygon"));
check("率の右端は小数1桁", /class="trc-end"[^>]*>\d+\.\d</.test(svg));

check(
  "ほかの艇の空きには印を付けない",
  !svgOf("top3Rate", 1, 3).includes("日あき"),
);

const st = svgOf("avgSt", 1, -1);
check("平均ST の右端は小数2桁", /class="trc-end"[^>]*>0\.\d\d</.test(st));
// 右端の点（r=3 か 4.5 の円）の y を艇の順に取る。ST は艇番が小さいほど速い（小さい）ので上（y が小さい）
const ends = [
  ...st.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)" r="(?:3|4\.5)"/g),
].map((m) => Number(m[1]));
check(
  "平均ST は小さいほど上",
  ends.length === 6 && [...ends].sort((a, b) => a - b).join() === ends.join(),
  JSON.stringify(ends),
);

if (failures.length > 0) {
  console.error("verify-trend-chart: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify-trend-chart: OK");
