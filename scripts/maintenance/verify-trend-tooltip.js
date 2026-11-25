#!/usr/bin/env node
/**
 * 推移の線の点の吹き出し（src/components/race/basic-info/TrendTooltip.jsx）の中身の検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った走で静的に描いて HTML を調べる）。
 *
 * 守ること（オーナー 2026-11-25 承認、ファン4人の最終案。棚卸しの追補 timeseries-hover-links.md の「走」）:
 *   - 吹き出しは3行（日付・会場・R・グレード／艇番→進入コース・着順・ST／直近30走の値）
 *   - 頭の「レースへ →」はその走のレース詳細。言語の接頭辞を付ける（en は /en/race/…）
 *   - ST は公式の表記（.12・F.03）。率は % を付け、平均ST は付けない
 *   - 着順が無い走は欠場・公式の記号を出す
 *   - 留めたときだけ閉じる印を出す。右寄りの点は左へ出す
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LANG = { current: "ja" };
globalThis.__tipLang = LANG;
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
        "export const useTranslation = () => ({ t: (k, v) => (v ? `${k}:${JSON.stringify(v)}` : k), i18n: { resolvedLanguage: globalThis.__tipLang.current } });",
    }));
  },
};
const requireHere = createRequire(import.meta.url);
// 束ねた CommonJS の文から export を取り出す
const exportsOf = (code) => {
  const m = { exports: {} };
  new Function("require", "module", "exports", code)(requireHere, m, m.exports);
  return m.exports;
};
const {
  outputFiles: [bundled],
} = await bundle({
  entryPoints: [
    path.join(ROOT, "src/components/race/basic-info/TrendTooltip.jsx"),
  ],
  write: false,
  bundle: true,
  format: "cjs",
  platform: "node",
  packages: "external",
  jsx: "automatic",
  plugins: [i18nStub],
});
const TrendTooltip = exportsOf(bundled.text).default;
const { MemoryRouter } = requireHere("react-router-dom");

const failures = [];
const check = (name, ok, detail = "") => {
  if (!ok) failures.push(`${name} ${detail}`);
};

const run = (over = {}) => ({
  raceId: "2026-09-10-06-06",
  date: "2026-09-10",
  venueCode: "06",
  raceNo: 6,
  raceGrade: "SG",
  boatNumber: 5,
  entryCourse: 4,
  finishRank: 2,
  absent: false,
  finishMark: null,
  startTiming: 0.12,
  isFlying: false,
  ...over,
});
const html = (props) =>
  renderToStaticMarkup(
    createElement(
      MemoryRouter,
      null,
      createElement(TrendTooltip, {
        metric: "top3Rate",
        leftPct: 30,
        pinned: false,
        onClose: () => {},
        ...props,
      }),
    ),
  );

const base = html({ point: { value: 46.66, run: run() } });
check("3行", (base.match(/class="trc-tip-line/g) ?? []).length === 3, base);
check("飛び先はその走", base.includes('href="/race/2026-09-10-06-06"'));
check("会場名と R", base.includes("venues.6") && base.includes("6R"));
check("グレード", base.includes("SG"));
check("ST は先頭の 0 を省く", base.includes("ST .12"));
check("率は1桁と %", base.includes("46.7%"));
check("重ねただけは閉じる印なし", !base.includes("trc-tip-close"));
check("左寄りの点は右へ出す", !base.includes("is-flip"));

const pinned = html({
  point: { value: 46.66, run: run() },
  pinned: true,
  leftPct: 80,
});
check("留めたら閉じる印", pinned.includes("trc-tip-close"));
check("右寄りの点は左へ出す", pinned.includes("is-flip"));
check("留めた印", pinned.includes("is-pinned"));

const flying = html({
  point: {
    value: 0.153,
    run: run({
      startTiming: 0.03,
      isFlying: true,
      finishRank: null,
      finishMark: "F",
    }),
  },
  metric: "avgSt",
});
check("F は記号を前に", flying.includes("ST F.03"));
check(
  "平均ST は2桁で % なし",
  flying.includes("0.15") && !flying.includes("0.15%"),
);
check("着順の無い走は公式の記号", flying.includes("F ST"));

const absent = html({
  point: { value: 30, run: run({ finishRank: null, absent: true }) },
});
check("欠場", absent.includes("basicInfo.finishAbsent"));

LANG.current = "en";
const en = html({ point: { value: 30, run: run() } });
check("言語の接頭辞", en.includes('href="/en/race/2026-09-10-06-06"'), en);
LANG.current = "ja";

const noRun = html({ point: { value: 30, run: null } });
check(
  "走の無い点は値の行だけ",
  (noRun.match(/class="trc-tip-line/g) ?? []).length === 1 &&
    !noRun.includes("href"),
);

if (failures.length > 0) {
  console.error(`verify-trend-tooltip: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-trend-tooltip: OK");
