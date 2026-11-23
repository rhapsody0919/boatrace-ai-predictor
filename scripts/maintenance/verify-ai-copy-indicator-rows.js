#!/usr/bin/env node
/**
 * 「AI用にコピー」の行と、データ出走表の行が、同じ指標の定義（登録簿、ADR-0108）から同じ字を作ることの検査。
 * DB 接続は不要（取得のフックは差し替え、行の作り方は製品のコードを esbuild で束ねて呼ぶ）。
 *
 * 守ること（勝率・当地勝率・2連率・モーター・調子・平均ST 2行・ST のズレ）:
 *   - コピーの値が、出走表のセルに出ている字と同じ（勝率は級別の後ろの値、ST のズレは「±」つき）
 *   - 値の無い艇は「—」。モーターは全艇 0 のとき全艇「—」（交換直後）
 *   - 走数0の ST のズレは「—」
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatIndicatorParts, getIndicator } from "../../src/pure/indicatorRegistry.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const bundled = await bundle({
  stdin: {
    contents:
      'export { buildAiCopyRows } from "./useAiCopyText.js";' +
      '\nexport { buildBasicIndicatorRows } from "../components/race/raceIndicators";',
    resolveDir: path.join(ROOT, "src/hooks"),
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
        b.onResolve(
          { filter: /(?:useRaceAnalysisData|useRaceEntryFlyingRows|useCurrentMeetFlyingBoats|useSixBoatCourseStats|(?:^|\/)(?:core|[A-Za-z0-9_]*Queries)[A-Za-z0-9_]*|analogyService)(?:\.js)?$/ },
          (args) => ({ path: args.path, namespace: "offline" }),
        );
        b.onLoad({ filter: /.*/, namespace: "offline" }, (args) => ({
          contents:
            args.path === "i18n"
              ? 'export const useTranslation = () => ({ t: (k) => k, i18n: { resolvedLanguage: "ja" } });'
              : 'const forbidden = () => { throw new Error("DB access forbidden"); };' +
                " export const getRaceOriginalExhibition = forbidden; export const useRaceAnalysisData = forbidden;" +
                " export const useRaceEntryFlyingRows = forbidden; export const useCurrentMeetFlyingBoats = forbidden;" +
                " export const useSixBoatCourseStats = forbidden; export const getRaceSt30 = forbidden;",
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function("require", "module", "exports", bundled.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const { buildAiCopyRows, buildBasicIndicatorRows } = mod.exports;

const t = (key) => key;
const players = [
  { number: 1, grade: "A1", winRate: "6.53", localWinRate: "5.64", global2Rate: "49.46", motor2Rate: "26.1" },
  { number: 2, grade: "B1", winRate: "5.52", localWinRate: null, global2Rate: "35.2", motor2Rate: "30.5" },
  { number: 3, grade: "B1", winRate: "", localWinRate: "5.92", global2Rate: "24.0", motor2Rate: null },
];
const analysis = {
  motor: [{ boat_number: 1, motor_2rate: 31.04 }],
  racerForm: [{ boat_number: 1, delta: 0.5 }, { boat_number: 2, delta: -0.25 }],
  officialAvgSt: { rows: [{ boatNumber: 1, avgSt: 0.15 }, { boatNumber: 2, avgSt: 0.17 }] },
  st30: [{ boatNumber: 1, st30: 0.131 }, { boatNumber: 3, st30: 0.2 }],
  stPredictability: [
    { boat_number: 1, sample_count: 4, avg_deviation: 0.04 },
    { boat_number: 2, sample_count: 0, avg_deviation: 0.01 },
  ],
};

const failures = [];
const check = (name, ok) => { if (!ok) failures.push(name); };
const flying = { rows: new Map(), currentMeet: new Set() };
const copyRows = buildAiCopyRows(t, players, analysis, flying, "2026-10-09-20-09", null);
const tableRows = buildBasicIndicatorRows({ t, players, analysis, pending: {} });
const text = (node) => renderToStaticMarkup(createElement("div", null, node)).replace(/<[^>]*>/g, "");

const KEYS = ["winRate", "localWinRate", "twoRate", "motor", "form", "avgSt", "avgSt30", "st"];
for (const key of KEYS) {
  const copy = copyRows.find((r) => r.key === key);
  const table = tableRows.find((r) => r.key === key);
  check(`${key}: コピーと出走表の両方に行がある`, Boolean(copy && table));
  if (!copy || !table) continue;
  players.forEach((p, i) => {
    const cell = text(table.render(p));
    const value = copy.values[i];
    // 勝率は級別の後ろの値だけを比べる（コピーは「A1 6.53」、値が無ければ級別だけ。表は値が無ければ「—」）
    const valueOf = (s) => s.replace(p.grade, "").trim() || "—";
    const same = key === "winRate" ? valueOf(value) === valueOf(cell) : value === cell;
    check(`${key} ${p.number}号艇: コピー「${value}」と出走表「${cell}」が同じ`, same);
  });
}
const values = (key) => copyRows.find((r) => r.key === key)?.values;
// 登録簿の定義の書き方そのもの（コピーと出走表の両方がこれを通る）
const ids = { localWinRate: "racer.localWinRate.official", twoRate: "racer.twoRate.official", avgSt30: "racer.avgSt.last30" };
for (const [key, id] of Object.entries(ids)) {
  const def = getIndicator(id);
  const v = def.select({ players, analysis }).get(1)?.value ?? null;
  const { text, unit } = formatIndicatorParts(def, v);
  check(`${key}: 1号艇のコピーが登録簿の書き方「${text}${unit}」と同じ`, values(key)?.[0] === `${text}${unit}`);
}
check("当地勝率の空は —", values("localWinRate")?.[1] === "—");
check("2連率は % つき1桁", values("twoRate")?.[0] === "49.5%");
check("モーターは自社の再計算を先に", values("motor")?.[0] === "31.0%");
check("ST のズレは ± つき、走数0は —", values("st")?.[0] === "±0.04" && values("st")?.[1] === "—");
check("30走の ST は3桁", values("avgSt30")?.[0] === "0.131");
const zero = buildAiCopyRows(t, players.map((p) => ({ ...p, motor2Rate: "0" })), { ...analysis, motor: [] }, flying, "2026-10-09-20-09", null);
check("モーターが全艇0なら全艇 —", zero.find((r) => r.key === "motor")?.values.every((v) => v === "—"));

if (failures.length > 0) {
  console.error("verify-ai-copy-indicator-rows: 失敗");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(`verify-ai-copy-indicator-rows: OK（${KEYS.length}行 × ${players.length}艇）`);
