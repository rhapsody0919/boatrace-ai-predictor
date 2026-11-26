#!/usr/bin/env node
/**
 * 推移の図（TrendChart）の、走ごとの生の値の見え方（尺度 st、オーナー 2026-11-26 承認の R-36）の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った走で静的に描いて SVG を調べる）。
 *
 * 守ること:
 *   - 値の無い走（F・L）で線を切る（前後をつながない）
 *   - 選んだ艇の F・L は上の帯に艇の色の枠の札、ほかの艇は小さな点
 *   - 選んだ艇の最新の走が F なら、右端の札は値でなく「F」（直前の値を最新に読ませない）
 *   - 選んでいない艇は薄く（0.35）、その縁は付けない。選んだ艇は点を打つ
 *   - 縦軸は 0 より下に伸ばさず、目盛りの数字は1つおき、値は .12 の書き方
 *   - 使う側の口: renderOver は図の中で線より下に、renderBelow は図の外の下に、同じ横の座標で描く
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const requireHere = createRequire(import.meta.url);
const i18nStub = {
  name: "i18n-stub",
  setup(build) {
    build.onResolve({ filter: /^react-i18next$/ }, () => ({
      path: "x",
      namespace: "i18n",
    }));
    build.onLoad({ filter: /.*/, namespace: "i18n" }, () => ({
      loader: "js",
      contents:
        "export const useTranslation = () => ({ t: (k) => k, i18n: { resolvedLanguage: 'ja' } });",
    }));
  },
};
const {
  outputFiles: [chart],
} = await bundle({
  entryPoints: [
    path.join(ROOT, "src/components/race/basic-info/TrendChart.jsx"),
  ],
  write: false,
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  plugins: [i18nStub],
});
const loaded = { exports: {} };
new Function("require", "module", "exports", chart.text)(
  requireHere,
  loaded,
  loaded.exports,
);
const TrendChart = loaded.exports.default;

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

const day = (n) =>
  new Date(Date.UTC(2026, 3, 1) + n * 86400000).toISOString().slice(0, 10);
// 艇 b の走。flagAt の走は F（値なし）、lateAt は L
const runs = (b, { flagAt = [], lateAt = [] } = {}) =>
  Array.from({ length: 12 }, (_, i) => ({
    raceId: `${day(i * 4)}-0${b}-0${(i % 9) + 1}`,
    date: day(i * 4),
    value:
      flagAt.includes(i) || lateAt.includes(i)
        ? null
        : 0.08 + b / 100 + (i % 3) / 100,
    flag: flagAt.includes(i) ? "F" : lateAt.includes(i) ? "L" : null,
    gapDays: i === 0 ? null : 4,
    run: null,
  }));
const seriesByBoat = new Map([
  [1, runs(1, { flagAt: [11], lateAt: [5] })],
  [2, runs(2, { flagAt: [3] })],
  [3, runs(3)],
]);
const svg = renderToStaticMarkup(
  createElement(TrendChart, { seriesByBoat, metric: "st", selected: 1 }),
);
const group = (b) =>
  new RegExp(
    `<g class="trc-line trc-line-${b}"[^>]*>([\\s\\S]*?)(?=<g class="trc-line|<g><circle|$)`,
  ).exec(svg)?.[0] ?? "";

check(
  "選んだ艇は線を F・L で切る（2本に分かれる）",
  (group(1).match(/class="trc-stroke"/g) ?? []).length === 2,
  String((group(1).match(/class="trc-stroke"/g) ?? []).length),
);
check(
  "選んだ艇の印は枠の札",
  (group(1).match(/class="trc-flag-tag"/g) ?? []).length === 2,
);
check(
  "選んだ艇の印に F と L",
  group(1).includes(">F<") && group(1).includes(">L<"),
);
check("選んだ艇に点", group(1).includes('r="2"'));
check("ほかの艇は薄い", /trc-line-2" opacity="0.35"/.test(svg));
check("ほかの艇の印は小さな点", group(2).includes('opacity="0.4"'));
check("薄くした艇に縁を付けない", !group(2).includes("trc-halo"));
check("選んだ1号艇の縁はある", group(1).includes("trc-halo"));
check(
  "最新が F なら右端の札も F",
  /class="trc-end trc-end-flag trc-flag-F"[^>]*>F</.test(svg),
);
check("値は .12 の書き方", /class="trc-end"[^>]*>\.1\d</.test(svg));
const ticks = [...svg.matchAll(/class="trc-tick"[^>]*>([^<]*)</g)].map(
  (m) => m[1],
);
check(
  "縦軸は 0 より下に伸ばさない",
  !ticks.some((x) => x.startsWith("-")),
  JSON.stringify(ticks),
);
check(
  "目盛りの数字は1つおき",
  ticks.includes("") && ticks.includes(".00"),
  JSON.stringify(ticks),
);

// 使う側の口（会場平均の線・走ごとの行を載せる）
const slots = renderToStaticMarkup(
  createElement(TrendChart, {
    seriesByBoat,
    metric: "st",
    selected: 1,
    label: "LBL",
    renderOver: ({ x, sel }) =>
      createElement("line", { className: "slot-over", x1: x(3, sel.length) }),
    renderBelow: ({ x, sel }) =>
      createElement("div", {
        className: "slot-below",
        "data-x": x(3, sel.length),
      }),
  }),
);
const overX = /class="slot-over" x1="([\d.]+)"/.exec(slots)?.[1];
check(
  "renderOver は線より前（下）",
  slots.indexOf("slot-over") > 0 &&
    slots.indexOf("slot-over") < slots.indexOf('<g class="trc-line'),
);
check(
  "renderBelow は svg の外の後",
  slots.indexOf("slot-below") > slots.indexOf("</svg>"),
);
check(
  "renderBelow の横の座標は図と同じ",
  overX !== undefined && slots.includes(`data-x="${overX}"`),
  String(overX),
);
check("label が aria-label になる", slots.includes('aria-label="LBL"'));

if (failures.length > 0) {
  console.error(`verify-trend-chart-flags: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-trend-chart-flags: OK");
