#!/usr/bin/env node
/**
 * 勝率の期ごとの段（src/components/race/basic-info/WinRateStepChart.jsx）の描き方の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った期の値で静的に描いて SVG を調べる）。
 *
 * 守ること（オーナー 2026-11-24「勝率は期ごとの段」、モック3の審査 2026-11-25）:
 *   - 段は艇ごとに1組。選んだ艇だけ太線（3）、ほかは細線
 *   - 期の変わり目の縦は、選んでいない艇では細く薄く（値の横を主役にする）
 *   - 記録の無い期で線を切る（その期の横を描かず、前後をつながない）
 *   - 右端の値は小数2桁。期は1つおきに帯を敷く
 *   - 札は算出期間（同じ年は終わりの月、年またぎは YY/MM）、その下に選んだ艇の走数（記録なしはその旨）
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LABELS = {
  "basicInfo.trend.stepFrom": (v) => `${v.from}〜`,
  "basicInfo.trend.stepMonth": (v) => `${v.month}月`,
  "basicInfo.trend.starts": (v) => `${v.n}走`,
};
globalThis.__stepLabels = LABELS;
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
        "export const useTranslation = () => ({ t: (k, v) => (globalThis.__stepLabels[k] ? globalThis.__stepLabels[k](v) : k) });",
    }));
  },
};
const out = await bundle({
  entryPoints: [
    path.join(ROOT, "src/components/race/basic-info/WinRateStepChart.jsx"),
  ],
  plugins: [i18nStub],
  jsx: "automatic",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(
  createRequire(import.meta.url),
  mod,
  mod.exports,
);
const WinRateStepChart = mod.exports.default;

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

const periods = [
  { calcFrom: "2024-05-01", calcTo: "2024-10-31" },
  { calcFrom: "2024-11-01", calcTo: "2025-04-30" },
  { calcFrom: "2025-05-01", calcTo: "2025-10-31" },
  { calcFrom: "2025-11-01", calcTo: "2026-04-30" },
  { calcFrom: "2026-05-01", calcTo: "2026-10-31" },
];
const s = (winRate, starts = 100) => ({ winRate, starts });
const stepsByBoat = new Map([
  [1, [s(6.1, 118), s(6.4, 121), s(6.85, 115), s(6.71, 119), s(7.02, 117)]],
  [2, [s(5.1), s(5.32), null, s(5.05), s(5.48)]],
  [3, [s(4.2, 112), null, s(5.33, 121), s(5.9, 118), s(6.41, 116)]],
  [4, [s(6.9), s(6.62), s(6.35), s(6.1), s(5.88)]],
  [5, [s(3.95), s(4.1), s(4.05), s(4.32), s(4.2)]],
  [6, [s(2.8), s(3.15), s(3.4), s(3.1), s(3.62)]],
]);
const svg = renderToStaticMarkup(
  createElement(WinRateStepChart, { stepsByBoat, periods, selected: 3 }),
);
const groups = [
  ...svg.matchAll(/<g class="trc-line trc-line-(\d)">([\s\S]*?)<\/g>/g),
];
check("段は6組", groups.length === 6, String(groups.length));
const flatW = groups.map(([, b, body]) => [
  Number(b),
  Number(/class="trc-stroke"[^>]*stroke-width="([\d.]+)"/.exec(body)?.[1]),
]);
check(
  "太線は選んだ艇だけ",
  flatW
    .filter(([, w]) => w === 3)
    .map(([b]) => b)
    .join() === "3",
  JSON.stringify(flatW),
);
const rise = (b) =>
  /class="trc-stroke trc-rise"[^>]*/.exec(
    groups.find(([, x]) => Number(x) === b)[2],
  )[0];
check(
  "選んでいない艇の縦は薄い",
  /opacity="0.45"/.test(rise(4)) && /stroke-width="0.8"/.test(rise(4)),
  rise(4),
);
check("選んだ艇の縦は濃い", /opacity="1"/.test(rise(3)), rise(3));
const flatD = (b) =>
  /<path class="trc-stroke" d="([^"]*)"/.exec(
    groups.find(([, x]) => Number(x) === b)[2],
  )[1];
check(
  "記録の無い期の横は描かない",
  (flatD(2).match(/M/g) ?? []).length === 4,
  flatD(2),
);
const riseD = (b) =>
  /class="trc-stroke trc-rise" d="([^"]*)"/.exec(
    groups.find(([, x]) => Number(x) === b)[2],
  )[1];
check(
  "記録の無い期の前後をつながない",
  (riseD(2).match(/M/g) ?? []).length === 2,
  riseD(2),
);
check("右端の値は2桁", svg.includes(">6.41<") && svg.includes(">7.02<"));
check("帯は1つおき", (svg.match(/class="trc-band"/g) ?? []).length === 3);
check(
  "同じ年の期は終わりの月",
  svg.includes(">26/05〜<") && svg.includes(">10月<"),
);
check(
  "年またぎの期は YY/MM",
  svg.includes(">25/11〜<") && svg.includes(">26/04<"),
);
check("選んだ艇の走数", svg.includes(">116走<") && !svg.includes(">117走<"));
check("選んだ艇の記録なし", svg.includes(">basicInfo.trend.noRecord<"));

if (failures.length > 0) {
  console.error(`verify-winrate-step-chart: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-winrate-step-chart: OK");
