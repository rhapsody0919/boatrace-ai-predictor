#!/usr/bin/env node
/**
 * 選手の成績比較の推移の中身（src/components/race/basic-info/BasicInfoTrend.jsx）の出し分けの検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った走の記録で静的に描いて HTML を調べる）。
 *
 * 守ること:
 *   - 勝率は走ごとの線にしない（公式の期ごとの段で出す。今は準備中の1行）
 *   - 取得中（undefined）は「読み込み中」。取得の失敗（null）は role="alert" で出し、「記録が足りない」にしない
 *   - 記録が窓（30走）に満たなければ「記録が足りない」
 *   - 足りれば線を描き、線の無い艇のボタンは押せない
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
    contents:
      'export { default as BasicInfoTrend } from "./BasicInfoTrend.jsx";',
    resolveDir: path.join(ROOT, "src/components/race/basic-info"),
    loader: "js",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  packages: "external",
  jsx: "automatic",
  loader: { ".css": "empty" },
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
            "export const useTranslation = () => ({ t: (k) => k, i18n: { language: 'ja' } });",
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
const { BasicInfoTrend } = mod.exports;

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

const day = (n) =>
  new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const runs = (count) =>
  Array.from({ length: count }, (_, i) => ({
    raceId: `${day(i)}-02-01`,
    venueCode: "02",
    boatNumber: 1,
    rank1: i % 3 === 0 ? 1 : 3,
    rank2: 4,
    rank3: 5,
    startTiming: 0.15,
  }));
const players = [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, racerId: 4000 + n }));
const html = (metric, recordsByBoat) =>
  renderToStaticMarkup(
    createElement(BasicInfoTrend, {
      metric,
      scope: "national",
      grade: "all",
      venueCode: "02",
      sortedPlayers: players,
      recordsOf: (racerId) => recordsByBoat[racerId - 4000],
      selectedBoat: 1,
      onSelectBoat: () => {},
    }),
  );
const allOf = (v) => Object.fromEntries([1, 2, 3, 4, 5, 6].map((b) => [b, v]));

const pending = html("winRate", allOf(runs(60)));
check("勝率は準備中", pending.includes("basicInfo.trend.winRatePending"));
check("勝率は線を描かない", !pending.includes("<svg"));

const loading = html("top2Rate", { ...allOf(runs(60)), 4: undefined });
check("取得中は読み込み中", loading.includes("basicInfo.loading"));

const failed = html("top2Rate", { ...allOf(runs(10)), 3: null });
check("失敗は alert", failed.includes('role="alert"'));
check(
  "失敗を記録不足にしない",
  !failed.includes("basicInfo.trend.notEnough"),
);

const short = html("top2Rate", allOf(runs(29)));
check("29走は記録不足", short.includes("basicInfo.trend.notEnough"));
check("記録不足は線なし", !short.includes("<svg"));

const drawn = html("top2Rate", { ...allOf(runs(60)), 6: runs(5) });
check("足りれば線", drawn.includes("<svg"));
check("失敗が無ければ alert なし", !drawn.includes('role="alert"'));
const disabled = [...drawn.matchAll(/<button[^>]*disabled=""[^>]*>/g)];
check("線の無い艇だけ押せない", disabled.length === 1, String(disabled.length));

if (failures.length > 0) {
  console.error(`verify-basic-info-trend: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-basic-info-trend: OK");
