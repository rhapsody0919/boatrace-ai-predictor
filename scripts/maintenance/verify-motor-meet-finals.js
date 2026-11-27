#!/usr/bin/env node
/**
 * モーターの推移の節の点に優出・優勝の印を付けること（時系列の振り分け F-044）の検査。本番 DB には繋がない。
 * 取得（src/services/motorQueries8.js）は偽の supabase の上、印の計算（src/pure/motorGenerationTrend.js の motorMeetFinals）は純関数、
 * 図（src/components/analysis/MotorTrendChart.jsx）は esbuild で束ねて静的に描く。
 *
 * 守ること:
 *   - 走に「優勝戦か」（race_conditions.race_stage を isFinalStage で判定。準優勝戦は入らない）を isFinal で付ける
 *   - 節の中に優勝戦の走があれば優出、その走が1着で公式の記号（F 等）が無ければ優勝。優勝戦の無い節は印なし
 *   - 図は選んだ艇の節の点（今日まで延ばした右端は除く）の上にだけ印を描く。印を渡さなければ描かない
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();
installLocalStorage();
const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };
console.log = console.warn = () => {};

// --- 取得: 走に優勝戦かを付ける
const V = 2;
const day = (n) => new Date(Date.UTC(2026, 8, 1) + n * 86400000).toISOString().slice(0, 10);
const rid = (n, no) => `${day(n)}-02-${String(no).padStart(2, "0")}`;
const races = [];
const entries = [];
const conditions = [];
for (let n = 0; n < 6; n += 1)
  for (let no = 1; no <= 12; no += 1) {
    races.push({ race_id: rid(n, no), race_date: day(n), venue_code: V });
    conditions.push({ race_id: rid(n, no), race_stage: no === 12 && n === 5 ? "優勝戦" : no === 11 && n === 4 ? "準優勝戦" : "予選" });
    for (let boat = 1; boat <= 6; boat += 1)
      entries.push({ race_id: rid(n, no), boat_number: boat, motor_number: boat * 10, motor_2rate: 30, motor_3rate: 50, player_name: `選手${boat}`, grade: "A1" });
  }
setFakeSupabase(createFakeSupabase({
  venue_motor_start_dates: [{ venue_code: V, start_date: day(0) }],
  races,
  race_entries: entries,
  exhibition_data: [],
  race_results: [],
  race_series: [],
  race_start_timings: [],
  race_conditions: conditions,
}, { scramble: true, project: true, maxRows: 1000 }));
const { getMotorGenerationRuns } = await import("../../src/services/motorQueries8.js");
const got = (await getMotorGenerationRuns(V, [10], rid(6, 1))).runsByMotor[10] ?? [];
check("優勝戦の走だけ isFinal", got.length === 72 && got.filter((r) => r.isFinal).map((r) => r.raceId).join(",") === rid(5, 12), JSON.stringify(got.filter((r) => r.isFinal)));
check("準優勝戦は優勝戦に入らない", got.find((r) => r.raceId === rid(4, 11))?.isFinal === false);

// --- 印の計算
const { motorMeetFinals } = await import("../../src/pure/motorGenerationTrend.js");
const run = (n, o = {}) => ({ raceId: `${day(n)}-02-01`, date: day(n), motor2Rate: 30, finish: 3, finishMark: null, isFinal: false, ...o });
// 節は日が4日以上あくか、選手が替わると次（motorMeets）。0〜2日・10〜12日・20〜22日の3節
const runs = [
  run(0), run(1), run(2, { isFinal: true, finish: 1 }),
  run(10), run(11), run(12, { isFinal: true, finish: 4 }),
  run(20), run(21), run(22),
];
const finals = motorMeetFinals(runs);
check("優勝戦で1着の節は優勝", finals.get(day(0)) === "win", JSON.stringify([...finals]));
check("優勝戦を走って1着でない節は優出", finals.get(day(10)) === "final");
check("優勝戦の無い節は印なし", !finals.has(day(20)) && finals.size === 2);
check("1着でも公式の記号があれば優出", motorMeetFinals([run(0, { isFinal: true, finish: 1, finishMark: "F" })]).get(day(0)) === "final");
check("走が無ければ空", motorMeetFinals([]).size === 0);

// --- 図: 選んだ艇の節の点の上にだけ印
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = await bundle({
  stdin: { contents: 'export { default } from "./src/components/analysis/MotorTrendChart.jsx";', resolveDir: ROOT, loader: "js" },
  write: false, bundle: true, format: "cjs", platform: "node", packages: "external", jsx: "automatic",
  plugins: [{ name: "i18n", setup: (b) => {
    b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "fake" }));
    b.onLoad({ filter: /^i18n$/, namespace: "fake" }, () => ({ contents: "export const useTranslation = () => ({ t: (k) => k });", loader: "js" }));
  } }],
});
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const pts = (v) => [{ date: day(0), value: v, runs: 20 }, { date: day(10), value: v + 2, runs: 30 }, { date: day(30), value: v + 2, runs: 40, extended: true }];
const html = (finalLabels) =>
  renderToStaticMarkup(createElement(mod.exports.default, {
    seriesByBoat: new Map([[1, pts(30)], [2, pts(40)]]),
    metric: "top2Rate", selected: 2, generationStart: day(0), today: day(30), minRuns: 20, finalLabels,
  }));
const labels = (h) => [...h.matchAll(/class="trc-axisnote mtc-final"[^>]*>([^<]*)</g)].map((m) => m[1]);
check("選んだ艇の節の点に印", labels(html(new Map([[day(0), "優勝"], [day(10), "優出"]]))).join("/") === "優勝/優出", labels(html(new Map([[day(0), "優勝"]]))).join("/"));
check("今日まで延ばした右端には印を付けない", labels(html(new Map([[day(30), "優出"]]))).length === 0);
check("印を渡さなければ描かない", labels(html(null)).length === 0);

if (failures.length > 0) {
  console.error(`verify-motor-meet-finals: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
process.stdout.write("verify-motor-meet-finals: OK\n");
