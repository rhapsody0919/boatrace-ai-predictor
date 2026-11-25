#!/usr/bin/env node
/**
 * 選手の成績比較の推移の中身（src/components/race/basic-info/BasicInfoTrend.jsx）の出し分けの検査。DB 接続は不要
 * （製品の部品を esbuild で束ね、作った走の記録で静的に描いて HTML を調べる）。
 *
 * 守ること:
 *   - 勝率は走ごとの線にしない（公式の期別成績の段で出す。期別成績の取得中は読み込み中、失敗は alert）
 *   - 取得中（undefined）は「読み込み中」。取得の失敗（null）は role="alert" で出し、「記録が足りない」にしない
 *   - 記録が窓（30走）に満たなければ「記録が足りない」
 *   - 足りれば線を描き、線の無い艇のボタンは押せない。選んだ艇のボタンだけ押された状態
 *   - 題は今の値／推移（勝率だけ「公式の期ごと」）、切り替えは押した側だけ押された状態
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { build as bundle } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 訳（react-i18next）は鍵をそのまま返す偽物に、見た目（JS でない import）は空に差し替える
const STUBS = {
  i18n: "export const useTranslation = () => ({ t: (k) => k, i18n: { language: 'ja' } });",
  asset: "",
};
const stubPlugin = {
  name: "stubs",
  setup(build) {
    build.onResolve({ filter: /^react-i18next$/ }, () => ({
      path: "i18n",
      namespace: "stub",
    }));
    build.onResolve({ filter: /^\.\/[A-Za-z]+\.[a-z]+$/ }, (args) =>
      /\.jsx?$/.test(args.path)
        ? undefined
        : { path: "asset", namespace: "stub" },
    );
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: STUBS[args.path],
      loader: "js",
    }));
  },
};
const { outputFiles } = await bundle({
  entryPoints: [
    path.join(ROOT, "src/components/race/basic-info/BasicInfoTrend.jsx"),
  ],
  plugins: [stubPlugin],
  jsx: "automatic",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "cjs",
  write: false,
});
const mod = { exports: {} };
const load = new Function("require", "module", "exports", outputFiles[0].text);
load(createRequire(import.meta.url), mod, mod.exports);
const BasicInfoTrend = mod.exports.default;
const { ViewHead } = mod.exports;

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
const players = [1, 2, 3, 4, 5, 6].map((n) => ({
  number: n,
  racerId: 4000 + n,
}));
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

const winRateHtml = (winRate) =>
  renderToStaticMarkup(
    createElement(BasicInfoTrend, {
      metric: "winRate",
      scope: "national",
      grade: "all",
      venueCode: "02",
      sortedPlayers: players,
      recordsOf: () => runs(60),
      selectedBoat: 1,
      onSelectBoat: () => {},
      winRate: { raceDate: "2026-11-25", periodFailed: false, ...winRate },
    }),
  );
const wrLoading = winRateHtml({ periodStats: undefined });
check(
  "勝率は期別成績の取得中は読み込み中",
  wrLoading.includes("basicInfo.loading"),
);
check("勝率は走ごとの線を描かない", !wrLoading.includes("trc-line"));
check(
  "勝率は期別成績の失敗を alert",
  winRateHtml({ periodStats: null, periodFailed: true }).includes(
    'role="alert"',
  ),
);
const wrRows = [1, 2, 3, 4, 5, 6].map((b) => ({
  racer_id: 4000 + b,
  period_year: 2027,
  period_no: 1,
  win_rate: 4 + b / 2,
  starts: 100,
}));
const wr = winRateHtml({ periodStats: { rows: wrRows, latestImported: true } });
check(
  "勝率は段を6艇",
  (wr.match(/class="trc-line trc-line-/g) ?? []).length === 6,
);

const loading = html("top2Rate", { ...allOf(runs(60)), 4: undefined });
check("取得中は読み込み中", loading.includes("basicInfo.loading"));

const failed = html("top2Rate", { ...allOf(runs(10)), 3: null });
check("失敗は alert", failed.includes('role="alert"'));
check("失敗を記録不足にしない", !failed.includes("basicInfo.trend.notEnough"));

const short = html("top2Rate", allOf(runs(29)));
check("29走は記録不足", short.includes("basicInfo.trend.notEnough"));
check("記録不足は線なし", !short.includes("<svg"));

const drawn = html("top2Rate", { ...allOf(runs(60)), 6: runs(5) });
check("足りれば線", drawn.includes("<svg"));
check("失敗が無ければ alert なし", !drawn.includes('role="alert"'));
const disabled = [...drawn.matchAll(/<button[^>]*disabled=""[^>]*>/g)];
check("線の無い艇だけ押せない", disabled.length === 1, String(disabled.length));

// 題と切り替え
const head = (view, metric) =>
  renderToStaticMarkup(
    createElement(ViewHead, { view, setView: () => {}, metric }),
  );
check(
  "今の値の題",
  head("now", "winRate").includes("basicInfo.trend.nowTitle"),
);
check(
  "推移の題",
  head("trend", "top2Rate").includes(">basicInfo.trend.title<"),
);
check(
  "勝率の推移の題",
  head("trend", "winRate").includes("basicInfo.trend.winRateTitle"),
);
const pressed = (html) =>
  [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([^<]*)</g)].map(
    (m) => m[1],
  );
check(
  "切り替えは押した側だけ",
  JSON.stringify(pressed(head("trend", "top2Rate"))) ===
    JSON.stringify(["basicInfo.trend.view.trend"]),
  JSON.stringify(pressed(head("trend", "top2Rate"))),
);
// 選んだ艇
const pick = [...drawn.matchAll(/<button[^>]*class="trc-boat"[^>]*>/g)].map(
  (m) => m[0],
);
check("艇のボタンは6つ", pick.length === 6, String(pick.length));
check(
  "選んだ艇だけ押された状態",
  pick.filter((b) => b.includes('aria-pressed="true"')).length === 1 &&
    pick[0].includes('aria-pressed="true"'),
);
check("線の注記", drawn.includes("basicInfo.trend.note"));
check(
  "勝率の段も艇を選べる",
  (wr.match(/class="trc-boat"/g) ?? []).length === 6,
);
check(
  "勝率の段に走ごとの線の注記を出さない",
  !wr.includes("basicInfo.trend.note"),
);

if (failures.length > 0) {
  console.error(`verify-basic-info-trend: NG\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("verify-basic-info-trend: OK");
