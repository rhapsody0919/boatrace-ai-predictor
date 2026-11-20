#!/usr/bin/env node
/**
 * ボット向け HTML（ADR 0089）のモデル（src/utils/botPageModel.js）と、その材料の純粋なモジュールを検証する。
 * src/ の本文は読まない（読むのはフィクスチャと locales だけ）。すべて import して呼んだ・描いた振る舞いで見る（BOA-1409）。
 *
 * 守るもの:
 * 1. botPageModel.js から辿れるモジュールが素の Node（vite の変換なし）から import でき、ブラウザ専用の依存を
 *    持ち込んでいない。window・document・localStorage・sessionStorage・fetch・XMLHttpRequest・WebSocket を
 *    触ると（typeof でも）例外を投げる getter を globalThis に立てた中で import し、2〜4 の全モデルを組み、木の全モジュールの export された関数も呼ぶ（終わったら戻す）。
 *    import の木（リポジトリの中、node_modules を除く）は module hooks で観測し、木の中から react* を import する・
 *    @supabase/* や URL に supabaseClient を含む物が木に入るのを落とし、import.meta.env は blogPosts*.js の外で触ると例外にする。
 *    拡張子の無い import は素の Node が解けずに落ちる。限界: どの入口からも通らない分岐の中の依存は見えない
 * 2. 本番の /api/races/today の実物（2026-10-11 に1回保存したフィクスチャ）から、トップと会場ページの
 *    モデルが人の画面と同じ文字で組める（会場数・レース数・締切時刻・見出し・meta）
 * 3. 0件（開催なし）と、形が壊れた入力を区別する。壊れた入力で「開催なし」のモデルを返さない（ADR 0069）
 * 4. 選手名・オッズ・払戻・着順・展開予測・荒れ度がモデルに入らない（ADR 0089 決定7）
 * 5. 人の画面が同じ関数を使い続けている。人の部品（VenueGridPage・VenueRaceListPage・VenueGridCard・RaceCard）を
 *    scripts/lib/renderJsx.js で描き、title 等・会場カードの代表値・レース番号・締切の文字がモデルと一致し、
 *    共有の関数（pageMeta.js・raceListDisplay.js）を呼んでいることを、その import を記録係に差し替える hook で見る。
 *    データ層の getRaces（公開の入口）が todayRaces.js の transformTodayRaces を呼んで同じ値を返すことも同じく見る
 *
 * 実行環境のタイムゾーンを UTC にして走らせる（ボットの関数は UTC で動く。日付が前日にずれないこと）。
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import i18next from "i18next";
import {
  runBotPageModelScenes1,
  runBotPageModelScenes2,
  runBotPageModelScenes3,
} from "./verifyData/bot-page-model-scenes-1.js";
import {
  runBotPageModelScenes4,
  runBotPageModelScenes5,
  runBotPageModelScenes6,
} from "./verifyData/bot-page-model-scenes-2.js";
import {
  runBotPageModelScenes7,
  runBotPageModelScenes8,
  runBotPageModelScenes9,
  runBotPageModelScenes10,
  runBotPageModelScenes11,
  runBotPageModelScenes12,
  runBotPageModelScenes13,
  runBotPageModelScenes14,
} from "./verifyData/bot-page-model-scenes-3.js";
import { runBotPageModelScenes15 } from "./verifyData/bot-page-model-scenes-4.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
// 読むのはフィクスチャと src/locales だけ（src/ の本文は読まない）
const read = (rel) => readFileSync(path.join(repoRoot, rel), "utf8");
const ROOT_URL = pathToFileURL(repoRoot).href + "/";
const SRC_URL = ROOT_URL + "src/";
const srcUrl = (rel) => SRC_URL + rel;

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

function checkThrows(label, fn, errorName) {
  checked += 1;
  try {
    const value = fn();
    failures.push(
      `${label}: 例外にならず値を返した ${JSON.stringify(value)?.slice(0, 200)}`,
    );
  } catch (e) {
    if (e?.name !== errorName) {
      failures.push(
        `${label}: 期待した例外 ${errorName} でない（${e?.name}: ${e?.message}）`,
      );
    }
  }
}

function report() {
  if (failures.length > 0) {
    console.error(
      `❌ verify-bot-page-model: ${failures.length}件の失敗（${checked}件中）`,
    );
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
}

// ---- 1. import の経路にブラウザ専用の依存が無い ----
// import の木を見る hook。§1 の間（state[0] が 0）だけ働き、後は素通し（module.register は取り消せない）。
// 解決と読み込みは Node の既定のまま（vite の変換・拡張子の補いをしない）なので、素の Node で読めない物はそのまま落ちる。
// 違反は import を例外にし、握りつぶされても数が残るよう state[1] に足す
const ENV_HIT_KEY = "__verifyBotPageModelEnvHits";
const TREE_KEY = "__verifyBotPageModelTree";
// 例外: blogPosts.js と翻訳版の blogPostsEn/Ko/ZhTw.js は import.meta.env の有無で読み方を分ける
// （Vite では import.meta.glob、Node では fs）。Node では import.meta.env が undefined なので fs の分岐を通る
// （トップのブログ欄、BOA-848 の後続。翻訳版は BOA-908 で JSON に移した）
const GUARD_HOOKS = `
let state;
let root;
let self;
export function initialize(data) {
  state = new Int32Array(data.state);
  root = data.root;
  self = data.self;
}
const active = () => Atomics.load(state, 0) === 0;
// 木の対象はリポジトリの中のファイル（node_modules とこの verify 自身を除く）。botPageModel の木は scripts/lib にも入る
const inTree = (url) => url.startsWith(root) && !url.includes("/node_modules/") && url !== self;
const rel = (url) => url.slice(root.length);
function violation(message) {
  Atomics.add(state, 1, 1);
  return new Error(message);
}
export async function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL ?? "";
  if (active() && inTree(parent) && /^react/.test(specifier)) {
    throw violation(rel(parent) + ": ブラウザ専用の依存（react）を import している（" + specifier + "）");
  }
  if (active() && inTree(parent) && specifier.startsWith("@supabase/")) {
    throw violation(rel(parent) + ": ブラウザ専用の依存（supabase）を import している（" + specifier + "）");
  }
  const resolved = await nextResolve(specifier, context);
  if (active() && inTree(parent) && /supabaseClient/.test(resolved.url)) {
    throw violation(rel(parent) + ": ブラウザ専用の依存（supabaseClient）を import している（" + rel(resolved.url) + "）");
  }
  return resolved;
}
const ENV_ALLOWED = /\\/src\\/data\\/blogPosts(En|Ko|ZhTw)?\\.js$/;
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  if (!active() || !inTree(url) || loaded.format !== "module") return loaded;
  // 木に入ったモジュールを名簿に載せ（後で export された関数を全部呼ぶ）、import.meta.env を罠にする
  const file = JSON.stringify(rel(url));
  const roster = "(globalThis.${TREE_KEY} ??= []).push(import.meta.url);";
  const trap = ENV_ALLOWED.test(url)
    ? ""
    : 'Object.defineProperty(import.meta, "env", { configurable: true, get() {' +
      " (globalThis.${ENV_HIT_KEY} ??= []).push(" + file + ");" +
      " throw new Error(" + file + ' + ": ブラウザ専用の依存（import.meta.env）を使っている"); } });';
  // 先頭が #! の行なら、その行の後ろに足す（#! は1行目にしか書けない）
  const source = String(loaded.source);
  const cut = source.startsWith("#!") ? source.indexOf("\\n") + 1 || source.length : 0;
  const head = cut === source.length && !source.endsWith("\\n") ? source + "\\n" : source.slice(0, cut);
  return { ...loaded, source: head + roster + trap + source.slice(cut) };
}
`;
const guardState = new Int32Array(new SharedArrayBuffer(8));
register(`data:text/javascript,${encodeURIComponent(GUARD_HOOKS)}`, {
  data: {
    state: guardState.buffer,
    root: ROOT_URL,
    self: import.meta.url,
  },
});

// window・document・localStorage・sessionStorage（と §1 の間は通信の fetch・XMLHttpRequest・WebSocket）は、
// globalThis の getter にして、触ると例外を投げ、触ったことを残す。typeof でも落ちる（Node に無い名前は typeof が
// "undefined" になり、ブラウザ側の分岐を検査してしまうのを避ける）。try で握りつぶされても browserTouches に残る
const BROWSER_GLOBALS = [
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
];
const browserTouches = [];
let touchContext = "";
function installBrowserTraps() {
  const saved = BROWSER_GLOBALS.map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  for (const name of BROWSER_GLOBALS) {
    const touch = (what) => {
      const message = `ブラウザ専用の依存（${name}）を触った（${what}）${touchContext}`;
      browserTouches.push(message);
      throw new Error(message);
    };
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get: () => touch(name),
      set: () => {
        touch(`${name} への代入`);
      },
    });
  }
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  };
}

// ---- 後半の場面（verifyData/bot-page-model-scenes-1.js） ----
await runBotPageModelScenes1({ read, failures, check });
// 4言語の i18next（人の画面の src/i18n.js と同じ resources・fallbackLng・補間。§1 の全言語のモデルと §5 の描画で使う）
const i18nAll = i18next.createInstance();

// ---- 後半の場面（verifyData/bot-page-model-scenes-1.js） ----
await runBotPageModelScenes2({ read, failures, check, i18nAll });
const tOf = (lang) => i18nAll.getFixedT(lang);

const FIXTURE =
  "scripts/lib/__fixtures__/races-today/races-today-2026-10-11.json";
const fixtureText = read(FIXTURE);
const fresh = () => JSON.parse(fixtureText);
const TODAY = "2026-10-11";

const restoreBrowserGlobals = installBrowserTraps();
let botPageModel;
let todayRacesModule;
try {
  botPageModel = await import("../../src/utils/botPageModel.js");
  todayRacesModule = await import("../../src/utils/todayRaces.js");
} catch (e) {
  restoreBrowserGlobals();
  failures.push(
    `botPageModel.js を素の Node で import できない: ${e?.message}`,
  );
  report();
}
const { buildTopModel, buildVenueModel, TodayRacesShapeError } = botPageModel;
const { transformTodayRaces } = todayRacesModule;

// ---- 後半の場面（verifyData/bot-page-model-scenes-1.js・bot-page-model-scenes-2.js） ----
await runBotPageModelScenes3({ read, failures, check, i18nAll, tOf, fresh, TODAY, buildTopModel, buildVenueModel });
await runBotPageModelScenes4({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces });


// ---- 1. の続き: 木の全モジュールの export された関数を、罠の中で全部呼ぶ ----
// 上のモデルが通らない分岐の依存も、export された関数の入口から届く物は落とす。
// 引数が合わない例外は見ない（見るのは罠に触ったか・import.meta.env を使ったかだけ）
const treeUrls = [...new Set(globalThis[TREE_KEY] ?? [])];
{
  const tJa = tOf("ja");
  const ARG_SETS = [
    [],
    [tJa, 1, [], "ja"],
    [fresh(), { t: tJa, today: TODAY, nowHHMM: "12:00", lang: "ja" }],
    [fresh(), 1, { t: tJa, lang: "ja", today: TODAY }],
    [TODAY, "ja"],
    [[], TODAY],
  ];
  // 引数が合わない等の例外は見ない。Promise は 50ms だけ待つ
  const settle = async (call) => {
    try {
      const value = call();
      if (typeof value?.then === "function") {
        await Promise.race([
          value.catch(() => {}),
          new Promise((r) => setTimeout(r, 50)),
        ]);
      }
      return value;
    } catch {
      return undefined;
    }
  };
  const isClass = (fn) =>
    /^class[\s{]/.test(Function.prototype.toString.call(fn));
  // 関数は6通りの引数で呼ぶ。class は6通りで new し、prototype のメソッドも呼ぶ
  const sweep = async (fn, label) => {
    for (const args of ARG_SETS) {
      touchContext = `（${label} を呼んで）`;
      if (!isClass(fn)) {
        await settle(() => fn(...args));
        continue;
      }
      const instance = await settle(() => new fn(...args));
      if (!instance) continue;
      for (const key of Object.getOwnPropertyNames(fn.prototype)) {
        const method = fn.prototype[key];
        if (key === "constructor" || typeof method !== "function") continue;
        for (const margs of ARG_SETS) {
          touchContext = `（${label}.prototype.${key} を呼んで）`;
          await settle(() => method.apply(instance, margs));
        }
      }
    }
  };
  for (const url of treeUrls) {
    const ns = await import(url);
    const file = url.slice(ROOT_URL.length);
    for (const [name, value] of Object.entries(ns)) {
      if (typeof value === "function") {
        await sweep(value, `${file} の ${name}`);
      } else if (value && typeof value === "object") {
        // export がオブジェクトなら、1段だけ自分の関数のプロパティも呼ぶ
        for (const [key, prop] of Object.entries(value)) {
          if (typeof prop === "function") {
            await sweep(
              isClass(prop) ? prop : prop.bind(value),
              `${file} の ${name}.${key}`,
            );
          }
        }
      }
    }
  }
  touchContext = "";
  // 遅れて（タイマー等で）触るものも数える
  await new Promise((r) => setTimeout(r, 100));
}

// ---- 後半の場面（verifyData/bot-page-model-scenes-2.js） ----
runBotPageModelScenes5({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces });
checked += 1;

// ---- 後半の場面（verifyData/bot-page-model-scenes-2.js） ----
runBotPageModelScenes6({ failures, check, checkThrows, browserTouches, fresh, TODAY, restoreBrowserGlobals, buildVenueModel, buildTopModel, TodayRacesShapeError, transformTodayRaces });
checked += 1;

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
runBotPageModelScenes7({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, renderAt });
checked += 1;

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
runBotPageModelScenes8({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, renderAt });
const treeFileCount = treeUrls.length;

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
runBotPageModelScenes9({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderAt });

// ---- 5. 人の画面が同じ関数を使っている（描いて確かめる） ----
// renderJsx の hook（vite の変換・拡張子の補い）は §1 の後に入れる（§1 を甘くしないため）。
// その上に、(a) src/services/supabaseClient.js を偽のクライアントへ、(b) 人の部品・データ層が import する
// 共有の関数（pageMeta.js・raceListDisplay.js・todayRaces.js）を、本物を呼んで呼び出しを記録する物へ差し替える hook を重ねる
// （後に登録した hook が先に呼ばれ、nextResolve で renderJsx の拡張子の補いを通った後の URL を見る）
const { renderJsx } = await import("../lib/renderJsx.js");
const React = (await import("react")).default;
const h = React.createElement;
const routerUrl = new URL(import.meta.resolve("react-router-dom"));

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
await runBotPageModelScenes10({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, renderAt });
const SPY_KEY = "__verifyBotPageModelCalls";

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
runBotPageModelScenes11({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, renderAt });
const callsOf = (importer, name) =>
  (globalThis[SPY_KEY] ?? []).filter(
    (c) => c.importer === importer && c.name === name,
  );

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
await runBotPageModelScenes12({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt });
const { Routes, Route } = await import("react-router-dom");

/** 部品を MemoryRouter の中に描き、ready() が真になるまで待つ（最長 10 秒。負荷の高い CI でも待てるように） */
async function renderAt(pathname, routePaths, Page, ready) {
  globalThis[SPY_KEY] = [];
  const view = await renderJsx(
    routerUrl,
    {
      initialEntries: [pathname],
      children: h(
        Routes,
        null,
        ...routePaths.map((p) =>
          h(Route, { key: p, path: p, element: h(Page) }),
        ),
      ),
    },
    { exportName: "MemoryRouter" },
  );
  for (let i = 0; i < 200 && !ready(view.container); i += 1) {
    await view.act(() => new Promise((r) => setTimeout(r, 50)));
  }
  return view;
}
const headMeta = (document) => ({
  title: document.querySelector("title")?.textContent ?? null,
  description:
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") ?? null,
  canonical:
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") ??
    null,
});

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js） ----
await runBotPageModelScenes13({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt, headMeta });

// 5b. トップ（VenueGridPage と、その中の VenueGridCard）。ja と en で描く
{
  const { default: VenueGridPage } = await import(
    srcUrl("pages/VenueGridPage.jsx")
  );
  for (const lang of ["ja", "en"]) {
    await i18nAll.changeLanguage(lang);
    const model = buildTopModel(fresh(), { t: tOf(lang), today: TODAY, lang });
    const view = await renderAt(
      lang === "ja" ? "/" : `/${lang}`,
      ["*"],
      VenueGridPage,
      (c) => c.querySelectorAll(".venue-grid-card").length === 24,
    );
    check(
      `トップ（${lang}）: title・description・canonical はモデルと同じ`,
      headMeta(view.document),
      model.meta,
    );
    const metaCalls = callsOf("pages/VenueGridPage.jsx", "getTopPageMeta");
    check(
      `トップ（${lang}）: getTopPageMeta(t, i18n.resolvedLanguage) で組む`,
      metaCalls.length > 0 &&
        metaCalls.every(
          (c) =>
            c.args[1] === lang &&
            JSON.stringify(c.result) === JSON.stringify(model.meta),
        ),
      true,
    );
    const cards = [...view.container.querySelectorAll(".venue-grid-card")];
    check(
      `トップ（${lang}）: 会場カードの会場名`,
      cards.map((c) => c.querySelector(".venue-grid-card__name")?.textContent),
      model.venues.map((v) => v.name),
    );
    const open = cards.filter((c) =>
      c.classList.contains("venue-grid-card--open"),
    );
    const openModel = model.venues.filter((v) => v.isOpen);
    check(
      `トップ（${lang}）: 会場カードの代表値（グレード・節の名前）`,
      open.map((c) => [
        c.querySelector(".venue-grid-card__grade")?.textContent ?? null,
        c.querySelector(".venue-grid-card__title")?.textContent ?? null,
      ]),
      openModel.map((v) => [v.gradeLabel, v.raceTitle]),
    );
    check(
      `トップ（${lang}）: 会場カードのリンク`,
      open.map((c) => c.getAttribute("href")),
      openModel.map((v) => v.href),
    );
    const headlineCalls = callsOf(
      "components/race/VenueGridCard.jsx",
      "venueCardHeadline",
    );
    const racesOf = new Map(
      transformTodayRaces(fresh(), {}).data.map((v) => [
        v.placeCd,
        JSON.stringify(v.races),
      ]),
    );
    check(
      `トップ（${lang}）: VenueGridCard が開催中の全会場で venueCardHeadline(races) を呼ぶ`,
      openModel.every((v) =>
        headlineCalls.some(
          (c) => JSON.stringify(c.args[0]) === racesOf.get(v.venueCode),
        ),
      ),
      true,
    );
    await view.unmount();
  }
}

// ---- 後半の場面（verifyData/bot-page-model-scenes-3.js・bot-page-model-scenes-4.js） ----
await runBotPageModelScenes14({ SRC_URL, srcUrl, failures, check, ENV_HIT_KEY, guardState, i18nAll, tOf, fresh, buildVenueModel, transformTodayRaces, treeFileCount, renderJsx, routerUrl, SPY_KEY, callsOf, renderAt, headMeta });
runBotPageModelScenes15({ report });
console.log(
  `✅ verify-bot-page-model: ${checked}件すべて通過（import の経路 ${treeFileCount} ファイル）`,
);
// 描いた部品の時計（setInterval 等）が残っても待たない
process.exit(0);
