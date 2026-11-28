#!/usr/bin/env node
/**
 * モーターの推移（MotorGenerationTrend）が取得を持たず、入口の useMotorGenerationRuns の結果（gen）で描くことの検査（plan.md §13）。
 * DB 接続は不要。部品と hook を esbuild で束ね（i18n・css・取得は偽物）、静的に描いて調べる。
 *
 * 守ること:
 *   - 推移の部品は取得（motorQueries8・supabase）を import しない
 *   - gen が idle・loading なら読み込み中、error なら取得の失敗、ok で6基の線（号機の札つき）
 *   - hook は enabled が偽なら idle（取らない）、真なら最初は loading。号機は艇番の順で、号機の無い行を除く
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fakes = {
  i18n: "export const useTranslation = () => ({ t: (k) => k, i18n: { language: 'ja', exists: () => false } });",
  css: "",
  q8: "globalThis.__genCalls = 0; export const getMotorGenerationRuns = () => { globalThis.__genCalls += 1; return new Promise(() => {}); };",
};
async function load(rel) {
  const r = await build({
    entryPoints: [path.join(root, rel)], bundle: true, write: false, metafile: true, format: "cjs", platform: "node",
    packages: "external", jsx: "automatic",
    plugins: [{
      name: "fakes",
      setup(b) {
        b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "fake" }));
        b.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "fake" }));
        b.onResolve({ filter: /motorQueries8(\.js)?$/ }, () => ({ path: "q8", namespace: "fake" }));
        b.onLoad({ filter: /.*/, namespace: "fake" }, (a) => ({ loader: "js", contents: fakes[a.path] }));
      },
    }],
  });
  const m = { exports: {} };
  new Function("require", "module", "exports", r.outputFiles[0].text)(createRequire(import.meta.url), m, m.exports);
  return { exports: m.exports, inputs: Object.keys(r.metafile.inputs) };
}

const problems = [];
const expectThat = (label, ok, info = "") => ok || problems.push(`${label} ${info}`);

const trend = await load("src/components/analysis/MotorGenerationTrend.jsx");
expectThat("推移の部品は取得を import しない", !trend.inputs.some((f) => /motorQueries8|supabase/.test(f)), trend.inputs.join(","));

const rows = [3, 1, 2, 4, 5, 6].map((b) => ({ boat_number: b, motor_number: b === 4 ? null : 10 + b }));
const draw = (gen) => renderToStaticMarkup(createElement(trend.exports.default, { gen, venueCode: 2, raceId: "2026-11-24-02-07", rows, metric: "top2Rate", onShowNow() {} }));
expectThat("idle は読み込み中", draw({ status: "idle", data: null }).includes("analysis.loading"));
expectThat("loading は読み込み中", draw({ status: "loading", data: null }).includes("analysis.loading"));
expectThat("error は取得の失敗", !draw({ status: "error", data: null }).includes("analysis.loading") && draw({ status: "error", data: null }).length > 0);
const day = (n) => new Date(Date.UTC(2026, 7, 6) + n * 86400000).toISOString().slice(0, 10);
const runsOf = (m) => Array.from({ length: 40 }, (_, i) => ({ raceId: `${day(i * 2)}-02-0${(m % 9) + 1}`, date: day(i * 2), motor2Rate: 30 + (i >= 25 ? m % 7 : 0), motor3Rate: 50, finish: 3 }));
const data = { generationStart: day(0), meets: [], runsByMotor: Object.fromEntries([11, 12, 13, 15, 16].map((m) => [m, runsOf(m)])) };
const ok = draw({ status: "ok", data });
expectThat("ok で線を描き、号機の札を出す", ok.includes("mtc-chart") && ok.includes("analysis.motor.genTrend.motorNo"), ok.slice(0, 300));

const hook = await load("src/hooks/useMotorGenerationRuns.js");
const { useMotorGenerationRuns, generationMotorsOf } = hook.exports;
expectThat("号機は艇番の順で、号機の無い行を除く", generationMotorsOf(rows).join(",") === "11,12,13,15,16", generationMotorsOf(rows).join(","));
const seen = [];
const Probe = ({ enabled }) => { seen.push(useMotorGenerationRuns(2, [11, 12], "2026-11-24-02-07", enabled).status); return null; };
renderToStaticMarkup(createElement(Probe, { enabled: false }));
renderToStaticMarkup(createElement(Probe, { enabled: true }));
expectThat("enabled が偽なら idle、真なら loading", seen.join(",") === "idle,loading", seen.join(","));

if (problems.length > 0) {
  console.error(`verify-motor-generation-trend-entry: NG\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-motor-generation-trend-entry: OK");
