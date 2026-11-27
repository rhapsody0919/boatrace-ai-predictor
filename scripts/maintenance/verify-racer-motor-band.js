#!/usr/bin/env node
/**
 * 選手の推移の線の下の段（src/components/race/basic-info/RacerMotorBand.jsx）の描き方の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った節で静的に描いて SVG を調べる）。
 *
 * 守ること（オーナー 2026-11-25 承認のモック mock-motor-trend/mock.html の afterB）:
 *   - 節ごとに1つの枠。横は図と同じ x(i, len) で、節の最初の走の半歩前から最後の走の半歩後まで（両端は図の端で止める）
 *   - 枠は区分の印（上・中・下・無し）を持ち、区分の字と号機を出す。狭い節（1走）は枠だけで字を出さない
 *   - 順位の分からない節は区分の字を出さず、号機だけ出す
 *   - 左に「順位」「号機」の見出し。図と同じ幅の viewBox。下に段の説明の注記
 *   - 取得の失敗は段の代わりに失敗の文を出す。段が空なら何も出さない。取得中は段の高さと注記を取っておく
 *   - 節を押すと、下の行に期間・会場・号機・位置を出し、もう一度押すと消す
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRODUCT = "src/components/race/basic-info/RacerMotorBand.jsx";
const {
  outputFiles: [bundled],
} = await bundle({
  entryPoints: [path.join(ROOT, PRODUCT)],
  write: false,
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  plugins: [
    {
      name: "stub",
      setup(b) {
        b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "i", namespace: "stub" }));
        b.onResolve({ filter: /racerQueries7\.js$/ }, () => ({ path: "q", namespace: "stub" }));
        b.onResolve({ filter: /\.css$/ }, () => ({ path: "c", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          loader: "js",
          contents:
            a.path === "i"
              ? "export const useTranslation = () => ({ t: (k) => k });"
              : a.path === "q"
                ? "export const getRacerMeetMotors = () => new Promise(() => {});"
                : "",
        }));
      },
    },
  ],
});
const requireHere = createRequire(import.meta.url);
const mod = { exports: {} };
new Function("require", "module", "exports", bundled.text)(requireHere, mod, mod.exports);
const { RacerMotorBandView } = mod.exports;

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const W = 400;
const x = (i, len) => 30 + (300 * i) / (len - 1);
const sel = Array.from({ length: 61 }, (_, i) => ({ raceId: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}-02-01` }));
const band = [
  { venue: 2, start: "2026-09-01", from: 0, to: 29, motorNumber: 18, tier: "high" },
  { venue: 5, start: "2026-09-06", from: 30, to: 30, motorNumber: 52, tier: "low" },
  { venue: 3, start: "2026-09-07", from: 31, to: 60, motorNumber: 41, tier: null },
];
const html = (props) => renderToStaticMarkup(createElement(RacerMotorBandView, { x, W, pad: { l: 30 }, sel, band, failed: false, ...props }));
const base = html({});
const rects = [...base.matchAll(/<rect x="([\d.]+)" y="2" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
check("節ごとに1つの枠", rects.length === 3, base);
check("最初の節は図の左端から最後の走の半歩後まで", Math.abs(rects[0][0] - 30.5) < 1e-6 && Math.abs(rects[0][0] - 0.5 + rects[0][1] + 1.5 - x(29.5, 61)) < 1e-6, JSON.stringify(rects[0]));
check("最後の節は図の右端で止める", Math.abs(rects[2][0] - 0.5 + rects[2][1] + 1.5 - x(60, 61)) < 1e-6, JSON.stringify(rects[2]));
check("区分の印", base.includes("rmb-seg--high") && base.includes("rmb-seg--low") && base.includes("rmb-seg--none"));
check("区分の字と号機", base.includes("basicInfo.trend.motorBand.tier.high") && base.includes(">18<") && base.includes(">41<"), base);
check("狭い節は字を出さない", !base.includes(">52<") && !base.includes("tier.low"), base);
check("順位の分からない節は区分の字なし", (base.match(/class="rmb-tier"/g) ?? []).length === 1);
check("見出しと図と同じ幅", base.includes("motorBand.rank") && base.includes("motorBand.motor") && base.includes('viewBox="0 0 400 '));
check("段の説明の注記", base.includes("motorBand.note"));
const failed = html({ failed: true, band: null });
check("失敗は失敗の文", failed.includes("motorBand.failed") && !failed.includes("<svg"), failed);
check("空なら何も出さない", html({ band: [] }) === "");
const loading = html({ band: null });
check("取得中は枠なしで段の高さと注記を取っておく（下の札が跳ねない）", loading.includes("<svg") && !loading.includes("rmb-seg") && loading.includes("motorBand.note"), loading);

if (failures.length > 0) {
  console.error(`verify-racer-motor-band: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-racer-motor-band: OK");
