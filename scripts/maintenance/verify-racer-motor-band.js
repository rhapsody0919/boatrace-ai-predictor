#!/usr/bin/env node
/**
 * 選手の推移の線の下の段（src/components/race/basic-info/RacerMotorBand.jsx）の描き方の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った節で静的に描いて SVG を調べる）。
 *
 * 守ること（オーナー 2026-11-25 承認のモック mock-motor-trend/mock.html の afterB。2026-11-28 の plan.md §14 で字と色を直した）:
 *   - 節ごとに1つの枠。横は図と同じ x(i, len) で、節の最初の走の半歩前から最後の走の半歩後まで（両端は図の端で止める）
 *   - 枠は位置（上・中・下）の印も字も持たず、節の初日の公式2連率と号機を出す。狭い節（1走）は枠だけで字を出さない
 *   - 2連率の無い節は点線の枠（--none）で、2連率の字を出さず号機だけ出す
 *   - 左に「2連率」「号機」の見出し。図と同じ幅の viewBox。段の説明は下の「?」の中
 *   - 取得の失敗は段の代わりに失敗の文を出す。段が空なら何も出さない。取得中は段の高さと注記を取っておく
 *   - 節を押すと、下の行に期間・会場・号機・位置を出し、もう一度押すと消す
 *   - 押した行: 期間は月/日、位置は上から何%（いちばん上でも 1%）。2連率か位置が無ければ位置なしの文
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
              ? "export const useTranslation = () => ({ t: (k, a) => (a ? `${k}|${JSON.stringify(a)}` : k), i18n: { exists: () => true } });"
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
const { RacerMotorBandView, PickedLine } = mod.exports;

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const W = 400;
const x = (i, len) => 30 + (300 * i) / (len - 1);
const sel = Array.from({ length: 61 }, (_, i) => ({ raceId: `2026-09-${String(1 + (i % 28)).padStart(2, "0")}-02-01` }));
const band = [
  { venue: 2, start: "2026-09-01", from: 0, to: 29, motorNumber: 18, tier: "high", motor2Rate: 45.5, pct: 0.9 },
  { venue: 5, start: "2026-09-06", from: 30, to: 30, motorNumber: 52, tier: "low", motor2Rate: 30, pct: 0.2 },
  { venue: 3, start: "2026-09-07", from: 31, to: 60, motorNumber: 41, tier: null, motor2Rate: 0, pct: null },
];
const html = (props) => renderToStaticMarkup(createElement(RacerMotorBandView, { x, W, pad: { l: 30 }, sel, band, failed: false, ...props }));
const base = html({});
const rects = [...base.matchAll(/<rect x="([\d.]+)" y="2" width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
check("節ごとに1つの枠", rects.length === 3, base);
check("最初の節は図の左端から最後の走の半歩後まで", Math.abs(rects[0][0] - 30.5) < 1e-6 && Math.abs(rects[0][0] - 0.5 + rects[0][1] + 1.5 - x(29.5, 61)) < 1e-6, JSON.stringify(rects[0]));
check("最後の節は図の右端で止める", Math.abs(rects[2][0] - 0.5 + rects[2][1] + 1.5 - x(60, 61)) < 1e-6, JSON.stringify(rects[2]));
check("位置の印は付けず、2連率の無い節だけ点線", !/rmb-seg--(high|mid|low)/.test(base) && (base.match(/rmb-seg--none/g) ?? []).length === 1, base);
check("2連率の字と号機（位置の字は出さない）", base.includes(">45.5<") && base.includes(">18<") && base.includes(">41<") && !base.includes("motorBand.tier."), base);
check("狭い節は字を出さない", !base.includes(">52<") && !base.includes(">30.0<"), base);
check("2連率の無い節は2連率の字なし", (base.match(/class="rmb-tier"/g) ?? []).length === 1);
check("見出しと図と同じ幅", base.includes("motorBand.rate") && base.includes("motorBand.motor") && base.includes('viewBox="0 0 400 '));
check("段の説明は「?」の中（注記の文は出さない）", base.includes("term-hint__button") && !base.includes("motorBand.note"));
const failed = html({ failed: true, band: null });
check("失敗は失敗の文", failed.includes("motorBand.failed") && !failed.includes("<svg"), failed);
check("空なら何も出さない", html({ band: [] }) === "");
const loading = html({ band: null });
check("取得中は枠なしで段の高さと「?」を取っておく（下の札が跳ねない）", loading.includes("<svg") && !loading.includes("rmb-seg") && loading.includes("term-hint__button"), loading);

const pick = (meet) => renderToStaticMarkup(createElement(PickedLine, { meet }));
const argsOf = (h) => JSON.parse(h.replace(/^.*?\|/, "").replace(/<\/p>$/, "").replaceAll("&quot;", '"'));
const p1 = pick({ venue: 2, start: "2026-09-01", end: "2026-09-12", motorNumber: 18, motor2Rate: 45.5, pct: 0.9 });
check("押した行は位置つきの文", p1.includes("motorBand.tipRate|") && !p1.includes("tipNoRank"), p1);
const a1 = argsOf(p1);
check("押した行の期間・会場・号機・2連率", a1.range === "9/01〜9/12" && a1.venue === "venues.2" && a1.no === 18 && a1.rate === "45.5", p1);
check("位置は上から何%（下からの 0.9 は上から 10%）", a1.top === 10, p1);
check("いちばん上でも 0% と出さず 1%", argsOf(pick({ venue: 2, start: "2026-10-03", end: "2026-10-08", motorNumber: 7, motor2Rate: 60, pct: 1 })).top === 1);
check("中ほどは丸める（0.333 は 67%）", argsOf(pick({ venue: 2, start: "2026-10-03", end: "2026-10-08", motorNumber: 7, motor2Rate: 30, pct: 0.333 })).top === 67);
const p2 = pick({ venue: 3, start: "2026-11-20", end: "2026-11-25", motorNumber: null, motor2Rate: 0, pct: null });
const a2 = argsOf(p2);
check("2連率の無い節は位置なしの文・号機は -", p2.includes("motorBand.tipNoRank|") && a2.no === "-" && a2.rate === "" && a2.top === "" && a2.range === "11/20〜11/25", p2);
const p3 = pick({ venue: 3, start: "2026-11-20", end: "2026-11-25", motorNumber: 9, motor2Rate: 40, pct: null });
check("2連率があっても位置が無ければ位置なしの文", p3.includes("motorBand.tipNoRank|") && argsOf(p3).rate === "40.0", p3);

if (failures.length > 0) {
  console.error(`verify-racer-motor-band: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-racer-motor-band: OK");
