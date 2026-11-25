#!/usr/bin/env node
/**
 * 6基のモーターの推移の線（src/components/analysis/MotorTrendChart.jsx）の描き方の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った点で静的に描いて SVG を調べる）。
 *
 * 守ること（オーナー 2026-11-25 承認のモック改訂2）:
 *   - 横は入れ替えの日から今日まで。左端に「M/D 入れ替え」、右端に「今日」。6基とも同じ横
 *   - 線は艇ごとに1本。選んだ艇だけ太線（3）。率なら選んだ艇だけ節の点を打ち、延ばした右端には打たない
 *   - 描き始める前の区間を塗り、「N走たまるまで描かない」と書く
 *   - 1号艇・2号艇・5号艇の線に縁
 *   - 右端の値は率なら小数1桁、展示タイムは小数2桁。展示タイムは小さいほど上で「↑速い」
 *   - 右端の札は図の上下からはみ出さない
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const bundled = await bundle({
  stdin: {
    contents: 'export { default as MotorTrendChart } from "./MotorTrendChart.jsx";',
    resolveDir: path.join(ROOT, "src/components/analysis"),
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
        b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "offline" }));
        b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents:
            "export const useTranslation = () => ({ t: (k, v = {}) => k.endsWith('.swapped') ? `${v.date} 入れ替え` : k.endsWith('.notYet') ? `${v.n}走たまるまで描かない` : k.endsWith('.today') ? '今日' : k.endsWith('.faster') ? '↑速い' : k });",
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { MotorTrendChart } = mod.exports;

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const day = (n) => new Date(Date.UTC(2026, 7, 6) + n * 86400000).toISOString().slice(0, 10);
const START = day(0);
const TODAY = day(110);
// 率: 艇ごとに 25 日目から8日ごとの節の点、右端は今日まで延ばす。艇 b の値は 28+2b 付近。6号艇だけ同じ値
const rateSeries = () =>
  new Map(
    [1, 2, 3, 4, 5, 6].map((b) => {
      const pts = [];
      for (let d = 25 + b; d < 110; d += 8) pts.push({ date: day(d), value: 28 + 2 * b + (d % 3), extended: false });
      pts.push({ ...pts[pts.length - 1], date: TODAY, extended: true });
      return [b, pts];
    }),
  );
const exSeries = () =>
  new Map([1, 2, 3, 4, 5, 6].map((b) => [b, Array.from({ length: 60 }, (_, i) => ({ date: day(40 + i), value: 6.7 + b / 100 }))]));
const svgOf = (seriesByBoat, metric, minRuns) =>
  renderToStaticMarkup(createElement(MotorTrendChart, { seriesByBoat, metric, selected: 3, generationStart: START, today: TODAY, minRuns }));

const rate = svgOf(rateSeries(), "top2Rate", 20);
const strokes = [...rate.matchAll(/<polyline class="trc-stroke"[^>]*stroke-width="([\d.]+)"/g)].map((m) => Number(m[1]));
check("線は6本", strokes.length === 6, String(strokes.length));
check("太線は1本（3）", strokes.filter((w) => w === 3).length === 1, JSON.stringify(strokes));
check("1・2・5号艇に縁", (rate.match(/class="trc-halo"/g) ?? []).length === 3);
const dots = (rate.match(/r="2.6"/g) ?? []).length;
const selPts = rateSeries().get(3).filter((p) => !p.extended).length;
check("率は選んだ艇だけ節の点（延ばした右端は打たない）", dots === selPts, `${dots}/${selPts}`);
check("左端に入れ替えの日", rate.includes("8/06 入れ替え"));
check("右端に今日", rate.includes(">今日<"));
check("描き始める前の区間を塗る", /class="mtc-before"/.test(rate));
check("描かない区間の札", rate.includes("20走たまるまで描かない"));
check("率の右端は小数1桁", /class="trc-end"[^>]*>\d+\.\d</.test(rate));
const labelYs = [...rate.matchAll(/<text x="[\d.]+" y="([\d.]+)" class="trc-end"/g)].map((m) => Number(m[1]));
check("右端の札は図に収まる", labelYs.length === 6 && labelYs.every((v) => v >= 24 && v <= 250 - 36 + 4), JSON.stringify(labelYs));
const sorted = [...labelYs].sort((a, b) => a - b);
check("右端の札は重ならない", sorted.every((v, i) => i === 0 || v - sorted[i - 1] >= 16 - 1e-9), JSON.stringify(sorted));

const ex = svgOf(exSeries(), "exhibition", 24);
check("展示の右端は小数2桁", /class="trc-end"[^>]*>6\.\d\d</.test(ex));
check("展示は「↑速い」", ex.includes("↑速い") && ex.includes("24走たまるまで描かない"));
check("展示は点を打たない", !ex.includes('r="2.6"'));
// 艇ごとの右端の点の y（艇 b の展示は 6.7+b/100 なので、艇番が小さいほど速く上）
const endY = (b) => Number(ex.match(new RegExp(`trc-line-${b}"[\\s\\S]*?<circle cx="[\\d.]+" cy="([\\d.]+)" r="(?:3|4\\.5)"`))?.[1]);
const ends = [1, 2, 3, 4, 5, 6].map(endY);
check("展示は小さいほど上", ends.every((v, i) => i === 0 || v > ends[i - 1]), JSON.stringify(ends));

if (failures.length > 0) {
  console.error("verify-motor-trend-chart: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log("verify-motor-trend-chart: OK");
