#!/usr/bin/env node
/**
 * モーターの推移の節の点の吹き出し（src/components/analysis/MotorMeetTooltip.jsx）の中身の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った節で静的に描いて HTML を調べる）。
 *
 * 守ること（オーナー 2026-11-25 承認のモック mock-motor-trend/tip/tip-mock.png）:
 *   - 吹き出しは3行（節の期間・会場・グレード・日数／乗った選手とこの節の着順／節の初日の公式の率とそれまでの走数）
 *   - 頭の「節へ →」はその節のページ（/venue/会場/meet/初日）。言語の接頭辞を付ける（en は /en/venue/…）
 *   - 着順の無い走は「-」。率は1桁と %
 *   - 留めたときだけ閉じる印を出す。右寄りの点は左へ出す
 *   - グレード・日数・選手が分からなければ、その語を出さない
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PRODUCT = "src/components/analysis/MotorMeetTooltip.jsx";
const LANG = { current: "ja" };
globalThis.__mtipLang = LANG;
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
      name: "i18n-stub",
      setup(b) {
        b.onResolve({ filter: /^react-i18next$/ }, () => ({ path: "x", namespace: "i18n" }));
        b.onLoad({ filter: /.*/, namespace: "i18n" }, () => ({
          loader: "js",
          contents:
            "export const useTranslation = () => ({ t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), i18n: { resolvedLanguage: globalThis.__mtipLang.current } });",
        }));
      },
    },
  ],
});
const requireHere = createRequire(import.meta.url);
const mod = { exports: {} };
new Function("require", "module", "exports", bundled.text)(requireHere, mod, mod.exports);
const MotorMeetTooltip = mod.exports.default;
const { MemoryRouter } = requireHere("react-router-dom");

const failures = [];
const check = (name, ok, detail = "") => { if (!ok) failures.push(`${name} ${detail}`); };

const tip = (over = {}) => ({
  start: "2026-09-26",
  end: "2026-10-01",
  days: 6,
  grade: "G1",
  racerName: "山田 太郎",
  finishes: [3, 1, null, 5, 1, 4],
  ...over,
});
const html = (props) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(MotorMeetTooltip, {
        tip: tip(),
        point: { value: 39.64, runs: 82 },
        venueCode: 2,
        metric: "top2Rate",
        leftPct: 30,
        pinned: false,
        onClose: () => {},
        ...props,
      }),
    ),
  );

const base = html({});
check("3行", (base.match(/class="trc-tip-line/g) ?? []).length === 3, base);
check("飛び先はその節のページ", base.includes('href="/venue/2/meet/2026-09-26"'), base);
check("期間・会場・グレード・日数", base.includes("9/26〜10/01") && base.includes("venues.2") && base.includes("G1") && base.includes('tipDays:{&quot;n&quot;:6}'), base);
check("選手名は空白を詰める", base.includes("山田太郎"), base);
check("着順の無い走は -", base.includes("3-1---5-1-4"), base);
check("率は1桁と % とそれまでの走数", base.includes("39.6%") && base.includes("&quot;runs&quot;:82"), base);
check("重ねただけは閉じる印なし", !base.includes("trc-tip-close"));
check("左寄りの点は右へ出す", !base.includes("is-flip"));

const pinned = html({ pinned: true, leftPct: 80 });
check("留めたら閉じる印", pinned.includes("trc-tip-close") && pinned.includes("is-pinned"));
check("右寄りの点は左へ出す", pinned.includes("is-flip"));

const bare = html({ tip: tip({ grade: null, days: null, racerName: null }) });
check("分からない語は出さない", !bare.includes("tipDays") && !bare.includes("tipRacer") && !bare.includes(" G1"), bare);
check("一般戦は公式の呼び名", html({ tip: tip({ grade: "ippan" }) }).includes("一般戦"));

LANG.current = "en";
check("言語の接頭辞", html({}).includes('href="/en/venue/2/meet/2026-09-26"'));
LANG.current = "ja";

if (failures.length > 0) {
  console.error(`verify-motor-meet-tooltip: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-motor-meet-tooltip: OK");
