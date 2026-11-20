#!/usr/bin/env node
/**
 * ボット向け HTML のレース詳細の関数（ADR 0089 第2段、BOA-848。api/bot-page/race/[id].js・api/bot-page/[lang]/race/[id].js、
 * 中身は api/_lib/botRace.js）を検証する。材料（/api/predictions/{date}?light=true）と時計を差し替えてハンドラを呼ぶ。
 * 材料は本番の 2026-10-12 から3会場を残したフィクスチャ（選手・結果は除外の検査のために残している）。
 *
 * 守るもの:
 * 1. 200・Cache-Control（第1段と同じ）。head の title・description・canonical・robots・lang が人のレース詳細と同じ関数の値
 *    （src/utils/raceDetailHeading.js）。hreflang は4言語と x-default、JSON-LD は共通の3つとパンくず
 * 2. 本文: パンくず・グレードと節タイトル・h1（会場名と NR・種別・日目。日目は同じ会場の他レースで補う）・「← レース一覧に戻る」・
 *    「データ分析結果 - 会場 NR（締切 HH:MM）」。締切は結果が出たら消す（人と同じ）
 * 3. 決定7の除外: 出走表の勝率・モーター、オッズ、払戻、着順・タイム・決まり手が本文に入らない。選手名は出走6艇の一覧の中だけ
 * 7. タブの外の 1R〜12R の帯と出走6艇（BOA-1189 GS01、人の RaceNumberStrip・RaceEntrantsSummary と同じ関数）:
 *    児島12R（2026-09-29、G1）で /racer/ のリンクが6件（ja 専用で言語の接頭辞なし）・同じ会場の /race/ のリンクが12件・
 *    節のページ（/venue/16/meet/2026-09-28）へのリンクが1件。一般戦（戸田5R、2026-09-22）・G3 は節を引かずリンクも無い。
 *    節が引けない・節の範囲外・グランプリ等の対象外の節はリンクを出さずに 200。中止のレースは出走6艇を出さない
 * 4. 本日（JST）の id だけ。過去・未来・形の違う id・範囲外の会場とレース番号は 404。言語は en・zh-TW・ko だけ、
 *    ja の関数は接頭辞なし・言語版の関数は接頭辞ありだけを受ける
 * 5. 材料が取れない・壊れた・0件 → 503・no-store。材料は取れたがその id が無い → 404。60秒の使い回し
 * 6. vercel.json で syd1・edge でないこと（設定の値なので本文を読む）
 * 9. 人のレース詳細がボットと同じ関数で同じ物を出すこと（BOA-1407。本文の正規表現から描画の試験へ置き換え）:
 *    RaceDetailPage を jsdom に描き（scripts/lib/renderJsx.js の module hooks、supabase は偽のクライアント、
 *    /api/predictions は差し替えた fetch）、同じ材料・同じ時計のボットの HTML と、見出し・title・description・canonical・
 *    パンくず・一覧へのリンク・帯の /race/ と節のリンク・出走6艇の /racer/ を比べる。さらに共有の関数
 *    （raceDetailHeading.js の4つ・meetPageModel.js の needsMeetSeries・meetLinkStartDateOf・seriesCoveringDate・
 *    raceEntrants.js の entrantRowsOf）の戻り値を hook で差し替え、画面とサービス層（getSeriesOfDate）の出力が
 *    差し替えた値に従うことを見る（同じ値を出す写しを持っても落ちる）
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RealDate,
  fake,
  runBotRaceFunctionScenes3,
  runBotRaceFunctionScenes4,
  runBotRaceFunctionScenes5,
} from "./verifyData/bot-race-function-scenes-3.js";
import {
  pagePredictions,
  seriesOfDateCalls,
  MAX_TICKS,
  text,
  hrefOf,
  runBotRaceFunctionScenes6,
  runBotRaceFunctionScenes7,
  runBotRaceFunctionScenes8,
  runBotRaceFunctionScenes9,
  runBotRaceFunctionScenes10,
  runBotRaceFunctionScenes11,
} from "./verifyData/bot-race-function-scenes-4.js";
import { runBotRaceFunctionScenes1 } from "./verifyData/bot-race-function-scenes-1.js";
import { runBotRaceFunctionScenes2 } from "./verifyData/bot-race-function-scenes-2.js";
import { runBotRaceFunctionScenes12 } from "./verifyData/bot-race-function-scenes-5.js";
import { runBotRaceFunctionScenes13 } from "./verifyData/bot-race-function-scenes-6.js";

// §9 の描画のため、src/ の .jsx・.js を renderJsx の module hooks で読む。その上に2つの差し替えを重ねる
// （後に登録した hook が先に呼ばれ、nextResolve で renderJsx の拡張子の補いを通った後の URL を見る）:
// - src/services/supabaseClient.js → 偽のクライアント（globalThis[FAKE_KEY]）
// - 共有の関数のファイル → 本物を ?real で読み、名前の関数だけを globalThis[SPY_KEY] を通す包みにした物
//   （ボットも画面も同じ包みを通る。既定は本物をそのまま呼ぶ）
const FAKE_KEY = "__verifyBotRaceSupabase";
const SPY_KEY = "__verifyBotRaceSpy";
const SPIED = {
  "/src/utils/raceDetailHeading.js": [
    "getRaceDetailHeading",
    "getRaceDetailMeta",
    "getRaceDetailBreadcrumbItems",
    "getRaceListLink",
  ],
  "/src/utils/meetPageModel.js": [
    "needsMeetSeries",
    "meetLinkStartDateOf",
    "seriesCoveringDate",
  ],
  "/src/utils/raceEntrants.js": ["entrantRowsOf"],
  // 節の取得の公開の入口。名前つき import が同じ包みを通る（殻 supabaseDataService は RA40 で消えた）
  "/src/services/scheduleQueries.js": ["getSeriesOfDate"],
};
const HOOKS = `
const SPIED = ${JSON.stringify(SPIED)};
const dataUrl = (src) => "data:text/javascript," + encodeURIComponent(src);
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const url = resolved.url;
  if (!url.startsWith("file:")) return resolved;
  if (url.endsWith("/src/services/supabaseClient.js")) {
    return { url: dataUrl("export const supabase = globalThis.${FAKE_KEY};"), shortCircuit: true };
  }
  for (const [suffix, names] of Object.entries(SPIED)) {
    if (!url.endsWith(suffix)) continue;
    const real = JSON.stringify(url + "?real");
    const wrappers = names.map(
      (n) => "export function " + n + "(...a) { const s = globalThis.${SPY_KEY}; return s ? s.call(" +
        JSON.stringify(n) + ", real." + n + ", a) : real." + n + "(...a); }",
    );
    return {
      url: dataUrl(["import * as real from " + real + ";", "export * from " + real + ";", ...wrappers].join("\\n")),
      shortCircuit: true,
    };
  }
  return resolved;
}
// src/data/blogPosts*.js 等の import.meta.glob を使うファイルは、import.meta.env が無いときの Node の分岐（fs で読む）を持つ。
// renderJsx は import.meta.env を定めて変換するので Vite の分岐へ入って落ちる。こうしたファイルだけ変換せずに読む
export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.includes("/src/") && url.endsWith(".js")) {
    const raw = await nextLoad(url + "?raw", { ...context, format: "module" });
    if (String(raw.source).includes("import.meta.glob(")) {
      return { format: "module", source: raw.source, shortCircuit: true };
    }
  }
  return nextLoad(url, context);
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`);

/** 共有の関数の呼び出しを数え、overrides[name] があれば (本物, ...引数) で代わりに呼ぶ。
 *  observers[name] は (引数, 戻り値) を見るだけで、reset では消さない（描画の待ちの数え） */
const spy = {
  overrides: {},
  calls: {},
  observers: {},
  call(name, real, args) {
    (this.calls[name] ??= []).push(args);
    const override = this.overrides[name];
    const result = override ? override(real, ...args) : real(...args);
    this.observers[name]?.(args, result);
    return result;
  },
  reset() {
    this.overrides = {};
    this.calls = {};
  },
};
globalThis[SPY_KEY] = spy;

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const { createRaceBotHandler, createPredictionsSource, parseBotRaceUrl } =
  await import("../../api/_lib/botRace.js");
const { ROBOTS, parseJsonLdScripts, getLocaleT, escapeHtml } =
  await import("../../api/_lib/botPage.js");
const { getRaceDetailMeta } =
  await import("../../src/utils/raceDetailHeading.js");
const { formatDateLocalized } = await import("../../src/utils/formatters.js");
const jaModule = await import("../../api/bot-page/race/[id].js");
const langModule = await import("../../api/bot-page/[lang]/race/[id].js");
check(
  "race/[id].js の default がハンドラ",
  typeof jaModule.default,
  "function",
);
check(
  "[lang]/race/[id].js の default がハンドラ",
  typeof langModule.default,
  "function",
);

const FIXTURE_TEXT = read(
  "scripts/lib/__fixtures__/predictions-light/predictions-light-2026-10-12.json",
);
const fresh = () => JSON.parse(FIXTURE_TEXT);
// 2026-10-12 08:00 JST（UTC では 10/11 23:00。UTC の日付を使うと前日になる時刻）
const NOW = Date.parse("2026-10-11T23:00:00Z");
const HOST = "boatrace-ai-predictor-test.vercel.app";
const SITE = "https://www.boat-ai.jp";

const jsonResponse = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
function stubFetch(makeResponse) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    return makeResponse(url);
  };
  fn.calls = calls;
  return fn;
}
function fakeRes() {
  const headers = {};
  return {
    statusCode: 0,
    headers,
    body: undefined,
    setHeader(k, v) {
      headers[k.toLowerCase()] = String(v);
    },
    end(body) {
      this.body = body;
    },
  };
}
// 節（race_series）は既定で引かれたら失敗にする（一般戦の検査で節を引きに行かないことを見る）
const noSeries = async (venueCode, date) => {
  throw new Error(`節を引いた: ${venueCode} ${date}`);
};

// ---- 後半の場面（verifyData/bot-race-function-scenes-1.js・bot-race-function-scenes-2.js・bot-race-function-scenes-3.js） ----
await runBotRaceFunctionScenes1({ check, createRaceBotHandler, createPredictionsSource, getLocaleT, ROBOTS, parseJsonLdScripts, escapeHtml, getRaceDetailMeta, formatDateLocalized, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes, noSeries });
await runBotRaceFunctionScenes2({ read, check, parseBotRaceUrl, createPredictionsSource, createRaceBotHandler, getLocaleT, getRaceDetailMeta, fresh, NOW, HOST, SITE, jsonResponse, stubFetch, fakeRes });
await runBotRaceFunctionScenes3({ check, NOW, jsonResponse, stubFetch });
const { JSDOM } = await import("jsdom");
const dom = new JSDOM(
  "<!doctype html><html><head></head><body></body></html>",
  // requestAnimationFrame を持たせる（タブの部品が使う）
  { url: "http://localhost/", pretendToBeVisual: true },
);
const { window } = dom;

// ---- 後半の場面（verifyData/bot-race-function-scenes-3.js） ----
runBotRaceFunctionScenes4({ check, NOW, jsonResponse, stubFetch, window });
let clock = NOW;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return clock;
  }
};

// ---- 後半の場面（verifyData/bot-race-function-scenes-3.js・bot-race-function-scenes-4.js） ----
runBotRaceFunctionScenes5({ check, NOW, jsonResponse, stubFetch, window });
runBotRaceFunctionScenes6({ FAKE_KEY, read, failures, check, JSDOM });
let predictionFetches = 0;
globalThis.fetch = async (url) => {
  const m = String(url).match(
    /\/api\/predictions\/(\d{4}-\d{2}-\d{2})(\?|$)/,
  );
  const body = m && pagePredictions[m[1]];
  if (body) predictionFetches += 1;
  return body
    ? jsonResponse(body)
    : new Response("not found", { status: 404 });
};

// i18n: 画面の src/i18n.js は import.meta.glob で locales を読む（Node では動かない）ので、同じ locales で i18next を初めから組む。
// そのため言語の切り替えの仕組み（URL の接頭辞→言語、localStorage の検出）そのものは見ていない。ここでは changeLanguage で決め打つ
const i18next = (await import("i18next")).default;

// ---- 後半の場面（verifyData/bot-race-function-scenes-4.js） ----
await runBotRaceFunctionScenes7({ FAKE_KEY, read, failures, check, JSDOM, i18next });

const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route } = await import("react-router-dom");
const { default: RaceDetailRoute } =
  await import("../../src/pages/RaceDetailPage.jsx");
const { clearCache } = await import("../../src/services/core.js");

// ---- 後半の場面（verifyData/bot-race-function-scenes-4.js） ----
await runBotRaceFunctionScenes8({ FAKE_KEY, read, failures, check, JSDOM, i18next });
let seriesOfDateSettled = 0;
spy.observers.getSeriesOfDate = (args, p) => {
  seriesOfDateCalls.push(args);
  const settle = () => {
    seriesOfDateSettled += 1;
  };
  Promise.resolve(p).then(settle, settle);
};
const h = React.createElement;
const act = (fn) =>
  React.act(async () => {
    await fn();
  });
const tick = () => act(() => new Promise((r) => setTimeout(r, 5)));

// ---- 後半の場面（verifyData/bot-race-function-scenes-4.js） ----
runBotRaceFunctionScenes9({ FAKE_KEY, read, failures, check, JSDOM, i18next });
/**
 * 人のレース詳細を描き、比べる値を取り出す。描いた後は外す。
 * 待ちは「予想の取得が2回（軽量版とフル版）・帯と出走6艇が出た・getSeriesOfDate が seriesCalls 回終わった」まで。
 * 上限に届いたら、その時の様子を失敗として残して、その時点の描画で比べを続ける。
 * 描く間の console.error はためておき、errors で返す（比べて落ちたときに出す）
 */
async function renderPage({
  id,
  lang = "ja",
  json,
  series = [],
  seriesCalls,
}) {
  if (!Number.isInteger(seriesCalls))
    throw new Error(
      `renderPage(${id}): 節の呼び出しの期待の数 seriesCalls が無い`,
    );
  const date = id.slice(0, 10);
  clock = Date.parse(`${date}T08:00:00+09:00`);
  pagePredictions[date] = json;
  fake.tables = { race_series: series };
  fake.calls.length = 0;
  seriesOfDateCalls.length = 0;
  seriesOfDateSettled = 0;
  predictionFetches = 0;
  clearCache();
  window.localStorage.clear();
  await i18next.changeLanguage(lang);
  window.document.head.innerHTML = "";
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  const prefix = lang === "ja" ? "" : `/${lang}`;
  const origError = console.error;
  const origLog = console.log;
  const errors = [];
  console.error = (...args) => {
    errors.push(
      args.map((a) => (a instanceof Error ? a.stack : String(a))).join(" "),
    );
  };
  console.log = () => {};
  try {
    await act(() =>
      root.render(
        h(
          MemoryRouter,
          { initialEntries: [`${prefix}/race/${id}`] },
          h(
            Routes,
            null,
            h(Route, {
              path: `${prefix}/race/:raceId`,
              element: h(RaceDetailRoute),
            }),
          ),
        ),
      ),
    );
    const state = () => ({
      predictionFetches,
      strip: !!container.querySelector('[data-testid="race-number-strip"]'),
      entrants: !!container.querySelector('[data-testid="race-entrants"] li'),
      seriesSettled: seriesOfDateSettled,
    });
    const ready = (st) =>
      st.predictionFetches >= 2 &&
      st.strip &&
      st.entrants &&
      st.seriesSettled >= seriesCalls;
    let ticks = 0;
    while (!ready(state()) && ticks < MAX_TICKS) {
      await tick();
      ticks += 1;
    }
    const reached = ready(state());
    check(
      `人 ${lang} ${id}: ${MAX_TICKS} 回の待ちの内に描画が揃う（予想2回・帯・出走6艇・節 ${seriesCalls} 回）`,
      reached ? null : state(),
      null,
    );
    // 揃った後の状態の更新（節のリンク等）を描き切る
    await tick();
    return {
      view: extractPage(container),
      seriesCalls: seriesOfDateCalls.map((a) => [...a]),
      errors: reached
        ? errors
        : [...errors, `待ちの上限: ${JSON.stringify(state())}`],
    };
  } finally {
    await act(() => root.unmount());
    container.remove();
    console.error = origError;
    console.log = origLog;
  }
}

// ---- 後半の場面（verifyData/bot-race-function-scenes-4.js） ----
runBotRaceFunctionScenes10({ FAKE_KEY, read, failures, check, JSDOM, i18next });
function extractPage(container) {
  const doc = window.document;
  const h1 = container.querySelector(".page-header h1")?.cloneNode(true);
  h1?.querySelector('[data-testid="race-detail-deadline"]')?.remove();
  const strip = container.querySelector('[data-testid="race-number-strip"]');
  return {
    title: doc.head.querySelector("title")?.textContent ?? null,
    description:
      doc.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content") ?? null,
    canonical: hrefOf(doc.head.querySelector('link[rel="canonical"]')),
    crumbs: [...container.querySelectorAll(".breadcrumb-list li")].map(
      (li) => [
        text(li.querySelector("a, .breadcrumb-current")),
        hrefOf(li.querySelector("a")),
      ],
    ),
    kicker: [...container.querySelectorAll(".race-detail-kicker > span")].map(
      text,
    ),
    h1: text(h1),
    backLink: hrefOf(container.querySelector(".page-header a.back-link")),
    strip: strip
      ? [...strip.querySelectorAll("ul a")].map((a) => [
          hrefOf(a),
          text(a),
          a.getAttribute("aria-current"),
        ])
      : null,
    meet: strip
      ? [
          ...strip.querySelectorAll('[data-testid="race-number-strip-meet"]'),
        ].map((a) => [hrefOf(a), text(a)])
      : null,
    entrants: [
      ...container.querySelectorAll('[data-testid="race-entrants"] li'),
    ].map((li) => [
      text(li.querySelector(".rol-boat-badge")),
      text(li.querySelector(".race-entrants__name")),
      hrefOf(li.querySelector("a")),
      text(li.querySelector(".race-entrants__grade")),
    ]),
  };
}

// ---- 後半の場面（verifyData/bot-race-function-scenes-4.js・bot-race-function-scenes-5.js・bot-race-function-scenes-6.js） ----
runBotRaceFunctionScenes11({ FAKE_KEY, read, failures, check, JSDOM, i18next });
await runBotRaceFunctionScenes12({ FAKE_KEY, spy, failures, check, clearCache, renderPage });
runBotRaceFunctionScenes13();

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-race-function: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-bot-race-function: ${checked}件すべて通過`);
// 描いた画面のタイマー（締切の時計等）を待たずに終える。後で非同期の check を足すときは、この行より前で await し終えること
// （ここより後に残った約束は、結果を出さずに黙って切られる）
process.exit(0);
