#!/usr/bin/env node
/**
 * 選手の推移の線の下の段（節ごとのモーター）を、推移（src/components/race/basic-info/BasicInfoTrend.jsx）が値で受け取って描くことの検査。
 * DB 接続は不要（製品の部品を esbuild で束ね、作った走の記録で静的に描いて HTML を調べる）。
 *
 * 守ること（部品の作り方 plan.md §13: 取りの hook は入口の RaceBasicInfoTab だけ、下の部品は props で受け取る）:
 *   - 推移の部品は取得を import しない（束ねた中に supabase・racerQueries7 が無い）
 *   - 段は、受け取った値（motorBand）の走が図の選んだ艇の点と同じときだけ描く（艇を替えた直後の古い段を出さない）
 *   - 値が無ければ段を描かない。取得の失敗は段の代わりに失敗の文
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { trendSeries } from "../../src/pure/racerTrendSeries.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRODUCT = "src/components/race/basic-info/BasicInfoTrend.jsx";
const { outputFiles, metafile } = await bundle({
  entryPoints: [path.join(ROOT, PRODUCT)],
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i18n", namespace: "stub" }));
        b.onResolve({ filter: /\.css$/ }, () => ({ path: "css", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          loader: "js",
          contents: a.path === "i18n" ? "export const useTranslation = () => ({ t: (k) => k, i18n: { language: 'ja', exists: () => true } });" : "",
        }));
      },
    },
  ],
  jsx: "automatic",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  write: false,
  metafile: true,
});
const mod = { exports: {} };
new Function("require", "module", "exports", outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const BasicInfoTrend = mod.exports.default;

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const inputs = Object.keys(metafile.inputs);
check("推移の部品は取得を import しない", !inputs.some((f) => /supabaseClient|racerQueries7/.test(f)), inputs.filter((f) => f.includes("services")).join(","));

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);
const runs = Array.from({ length: 40 }, (_, i) => ({ raceId: `${day(i)}-02-01`, venueCode: "02", boatNumber: 1, rank1: i % 3 === 0 ? 1 : 3, rank2: 4, rank3: 5, startTiming: 0.15 }));
const players = [1, 2, 3, 4, 5, 6].map((n) => ({ number: n, racerId: 4000 + n }));
const selIds = trendSeries(runs, "top3Rate").map((p) => p.raceId);
const band = [{ venue: 2, start: day(29), end: day(39), from: 0, to: selIds.length - 1, motorNumber: 41, tier: "high", pct: 0.9, motor2Rate: 45 }];
const html = (motorBand) =>
  renderToStaticMarkup(
    createElement(BasicInfoTrend, {
      metric: "top3Rate",
      scope: "national",
      grade: "all",
      venueCode: "02",
      sortedPlayers: players,
      recordsOf: () => runs,
      selectedBoat: 1,
      onSelectBoat: () => {},
      motorBand,
    }),
  );

const same = html({ raceIds: selIds, band, failed: false });
// 枠の字は位置（上・中・下）でなく節の初日の公式2連率（plan.md §14、オーナー 2026-11-28）
check("選んだ艇の点と同じ走なら段を描く", same.includes('class="rmb-svg"') && same.includes(">41<") && same.includes(">45.0<") && !same.includes("motorBand.tier."), same.slice(-600));
check("走が違えば段を描かない（艇を替えた直後）", !html({ raceIds: selIds.slice(1), band, failed: false }).includes("rmb-svg"));
check("値が無ければ段を描かない", !html(null).includes("rmb-svg") && !html(undefined).includes("rmb-"));
const failed = html({ raceIds: selIds, band: null, failed: true });
check("取得の失敗は失敗の文", failed.includes("motorBand.failed") && !failed.includes("rmb-svg"));
const loading = html({ raceIds: selIds, band: null, failed: false });
check("取得中は段の高さを取る（枠なし）", loading.includes("rmb-svg") && !loading.includes("rmb-seg"));

if (failures.length > 0) {
  console.error(`verify-basic-info-trend-motor-band: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-basic-info-trend-motor-band: OK");
