#!/usr/bin/env node
/**
 * モーターの推移の節の吹き出しで、乗った選手にそのレース時点の級（A1〜B2）を添えること（時系列の振り分け F-049）の検査。
 * 取得（src/services/motorQueries8.js）は偽の supabase の上、吹き出し（MotorMeetTooltip.jsx）は esbuild で束ねて静的に描く。本番 DB には繋がない。
 *
 * 守ること:
 *   - 走に出走表の行の級（race_entries.grade）を racerGrade で付ける（無ければ null）
 *   - 節の吹き出しの級は、名前を取った走と同じ走の級（motorMeetTip）
 *   - 吹き出しは「名前 級」と出し、級が無ければ名前だけ
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

// --- 取得: 走に級を付ける
const V = 2;
const day = (n) => new Date(Date.UTC(2026, 8, 1) + n * 86400000).toISOString().slice(0, 10);
const rid = (n, no) => `${day(n)}-02-${String(no).padStart(2, "0")}`;
const races = [];
const entries = [];
for (let n = 0; n < 6; n += 1)
  for (let no = 1; no <= 12; no += 1) {
    races.push({ race_id: rid(n, no), race_date: day(n), venue_code: V });
    for (let boat = 1; boat <= 6; boat += 1)
      entries.push({ race_id: rid(n, no), boat_number: boat, motor_number: boat * 10 + (no % 2), motor_2rate: 30, motor_3rate: 50, player_name: `選手${boat}`, grade: boat === 2 ? null : ["A1", "A2", "B1", "B2"][boat % 4] });
  }
setFakeSupabase(createFakeSupabase({
  venue_motor_start_dates: [{ venue_code: V, start_date: day(0) }],
  races,
  race_entries: entries,
  exhibition_data: [],
  race_results: [],
  race_series: [],
  race_start_timings: [],
}, { scramble: true, project: true, maxRows: 1000 }));
const { getMotorGenerationRuns } = await import("../../src/services/motorQueries8.js");
const got = await getMotorGenerationRuns(V, [11, 21], rid(5, 12));
const r11 = got.runsByMotor[11] ?? [];
const r21 = got.runsByMotor[21] ?? [];
check("走に出走表の級を付ける", r11.length > 0 && r11.every((r) => r.racerGrade === "A2"), JSON.stringify(r11[0]));
check("級の無い行は null", r21.length > 0 && r21.every((r) => r.racerGrade === null), JSON.stringify(r21[0]));

// --- 節の吹き出しの値: 名前を取った走と同じ走の級
const { motorMeetTip } = await import("../../src/pure/motorGenerationTrend.js");
const run = (d, name, grade) => ({ raceId: `${d}-02-01`, date: d, motor2Rate: 30, racerName: name, racerGrade: grade, finish: 1 });
const tip = motorMeetTip([run(day(0), null, "B2"), run(day(0), "山田 太郎", "A1"), run(day(1), "佐藤 次郎", "B1")], day(0), []);
check("級は名前を取った走と同じ走から", tip?.racerName === "山田 太郎" && tip?.racerGrade === "A1", JSON.stringify(tip));
check("級の無い走は null", motorMeetTip([run(day(0), "山田 太郎", undefined)], day(0), [])?.racerGrade === null);

// --- 吹き出しの字（訳は鍵と値をそのまま返す偽物。部品と描く関数を1つの束にして読む）
const I18N = "export const useTranslation = () => ({ t: (k, v) => (v ? k + ':' + JSON.stringify(v) : k), i18n: { resolvedLanguage: 'ja' } });";
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = await bundle({
  stdin: {
    contents: 'export { default } from "./src/components/analysis/MotorMeetTooltip.jsx";',
    resolveDir: ROOT,
    loader: "js",
  },
  write: false, bundle: true, format: "cjs", platform: "node", packages: "external", jsx: "automatic",
  plugins: [{ name: "i18n", setup: (b) => {
    b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "fake" }));
    b.onLoad({ filter: /^i18n$/, namespace: "fake" }, () => ({ contents: I18N, loader: "js" }));
  } }],
});
const requireHere = createRequire(import.meta.url);
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(requireHere, mod, mod.exports);
const { MemoryRouter } = requireHere("react-router-dom");
const html = (over) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, createElement(mod.exports.default, {
    tip: { start: day(0), end: day(5), days: 6, grade: null, racerName: "山田 太郎", racerGrade: "A1", byDay: [{ date: day(0), results: [1] }], ongoing: false, ...over },
    point: { value: 40, runs: 30 }, venueCode: V, metric: "top2Rate", leftPct: 30, pinned: false, onClose: () => {},
  })));
check("吹き出しは名前と級", html({}).includes("&quot;name&quot;:&quot;山田太郎 A1&quot;"), html({}));
check("級が無ければ名前だけ", html({ racerGrade: null }).includes("&quot;name&quot;:&quot;山田太郎&quot;"));

if (failures.length > 0) {
  console.error(`verify-motor-tip-racer-grade: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
process.stdout.write("verify-motor-tip-racer-grade: OK\n");
