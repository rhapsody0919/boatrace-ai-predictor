#!/usr/bin/env node
/**
 * 推移の図（TrendChart）の日付の横軸（今節タブの6艇の推移 R-43、オーナー 2026-11-26「重ねて日付で」）の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った走で静的に描いて SVG を調べる）。
 *
 * 守ること: 点の xr の位置に置く、breakBefore の前で線を切る、目盛りは xTicks（走の順の目盛りは出さない、印 trc-day）、
 *   最後の日より前に終わった艇の右端の札への引き出し線は点線
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./verifyData/loadComponent.js";

const TrendChart = await loadComponent(
  "src/components/race/basic-info/TrendChart.jsx",
);

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

// 日付の横軸（点が xr を持つ）。図の幅 343 で、横の位置は 30 + 247 * xr
const dated = (b, xrs, breakAt = -1) =>
  xrs.map((xr, i) => ({
    raceId: `2026-09-2${i}-09-0${b}`,
    date: `2026-09-2${i}`,
    value: 0.1 + b / 100 + i / 100,
    mark: 2,
    xr,
    breakBefore: i === breakAt,
    gapDays: null,
    run: null,
  }));
const dateChart = renderToStaticMarkup(
  createElement(TrendChart, {
    seriesByBoat: new Map([
      [1, dated(1, [0, 0.5], 1)],
      [3, dated(3, [0, 0.25, 1])],
    ]),
    metric: "st",
    selected: 3,
    scale: {
      step: 0.05,
      tickStep: 0.05,
      invert: true,
      digits: 2,
      tickDigits: 2,
      unit: "",
      dimOthers: true,
      dotLabel: true,
    },
    xTicks: [
      { xr: 0, label: "9/21" },
      { xr: 1, label: "9/28" },
    ],
  }),
);
const dateGroup = (b) =>
  new RegExp(
    `<g class="trc-line trc-line-${b}[^"]*"[^>]*>([\\s\\S]*?)(?=<g class="trc-line|<g><circle|$)`,
  ).exec(dateChart)?.[0] ?? "";
check(
  "日付の横軸: 点を xr の位置に置く",
  /<polyline class="trc-stroke" points="30,[\d.]+ 91.75,[\d.]+ 277,/.test(
    dateGroup(3),
  ),
);
check(
  "日付の横軸: breakBefore の前で線を切る",
  (dateGroup(1).match(/class="trc-stroke"/g) ?? []).length === 2,
);
check(
  "日付の横軸: 目盛りは xTicks（走の順の目盛りは出さない）",
  /x="30"[^>]*trc-day[^>]*>9\/21</.test(dateChart) &&
    /x="277"[^>]*>9\/28</.test(dateChart) &&
    !dateChart.includes("basicInfo.trend.latest"),
);
check(
  "日付の横軸: 最後の日より前に終わった艇だけ引き出し線が点線",
  (dateChart.match(/class="trc-leader" stroke-dasharray="2 2"/g) ?? [])
    .length === 1,
);

if (failures.length > 0) {
  console.error(`verify-trend-chart-date-axis: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-trend-chart-date-axis: OK");
