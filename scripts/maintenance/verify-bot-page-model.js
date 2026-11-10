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

// ---- t は ja の i18next（人の画面と同じ common.json・同じ補間の設定） ----
// i18next 自身は罠を立てる前に読み込む（検査するのは src/ の木だけ）
const LANGS = ["ja", "en", "ko", "zh-TW"];
const locales = Object.fromEntries(
  LANGS.map((lang) => [
    lang,
    JSON.parse(read(`src/locales/${lang}/common.json`)),
  ]),
);
const ja = locales.ja;
const i18n = i18next.createInstance();
await i18n.init({
  lng: "ja",
  resources: { ja: { common: ja } },
  defaultNS: "common",
  ns: ["common"],
  interpolation: { escapeValue: false },
});
const t = i18n.t.bind(i18n);
// 4言語の i18next（人の画面の src/i18n.js と同じ resources・fallbackLng・補間。§1 の全言語のモデルと §5 の描画で使う）
const i18nAll = i18next.createInstance();
await i18nAll.init({
  lng: "ja",
  resources: Object.fromEntries(
    LANGS.map((lang) => [lang, { common: locales[lang] }]),
  ),
  fallbackLng: { zh: ["zh-TW", "ja"], default: ["ja"] },
  supportedLngs: LANGS,
  defaultNS: "common",
  ns: ["common"],
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
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

// 2〜4 と全言語のモデルも罠の中で組む（呼んだときに触る依存も落とす）
for (const lang of LANGS) {
  const tl = tOf(lang);
  try {
    for (const nowHHMM of [undefined, "12:00", "23:59"]) {
      buildTopModel(fresh(), { t: tl, today: TODAY, nowHHMM, lang });
    }
    for (let code = 1; code <= 24; code += 1) {
      buildVenueModel(fresh(), code, { t: tl, lang, today: TODAY });
    }
  } catch (e) {
    failures.push(`${lang}: モデルを組めない: ${e?.message}`);
  }
}

// ---- 2. フィクスチャからトップ ----
const top = buildTopModel(fresh(), { t, today: TODAY, nowHHMM: "12:00" });
check("トップ: 開催中の会場数", top.openVenueCount, 13);
check("トップ: 会場は24件（人のグリッドと同じ）", top.venues.length, 24);
check(
  "トップ: 開催中の会場コード",
  top.venues.filter((v) => v.isOpen).map((v) => v.venueCode),
  [1, 2, 3, 6, 8, 9, 12, 15, 16, 18, 19, 22, 23],
);
check(
  "トップ: 見出し（UTC で動かしても JST の日付）",
  top.heading,
  "🏁 本日開催中のレース 10/11(日)",
);
check(
  "トップ: 最終更新（JST）",
  top.updatedText,
  "レースデータ更新: 10/11 21:26",
);
check("トップ: title", top.meta.title, ja.meta.title);
check("トップ: description", top.meta.description, ja.meta.description);
check("トップ: canonical", top.meta.canonical, "https://www.boat-ai.jp/");
check("トップ: 桐生のカード", top.venues[0], {
  venueCode: 1,
  name: "桐生",
  isOpen: true,
  href: "/venue/1",
  gradeLabel: null,
  raceTitle: "第８回日本一しょうゆ杯",
  seriesDayLabel: "5日目",
});
check("トップ: 江戸川は G3", top.venues[2].gradeLabel, "G3");
check("トップ: 非開催の会場は名前だけ", top.venues[3], {
  venueCode: 4,
  name: "平和島",
  isOpen: false,
});

// BOA-1220: 人の会場カードと同じ日目・表示条件。時計は JST の HH:MM。
{
  const labelOf = (json, nowHHMM, code = 1) =>
    buildTopModel(json, { t, today: TODAY, nowHHMM }).venues
      .find((v) => v.venueCode === code).seriesDayLabel;
  check("日目: 下関は初日", labelOf(fresh(), "12:00", 19), "初日");
  check("日目: 唐津は全レース終了で非表示", labelOf(fresh(), "23:00", 23), null);
  check("日目: 時計なしは人のカード同様非表示", labelOf(fresh(), undefined), null);
  const json = fresh();
  const races = json.data.find((v) => v.place_cd === 1).races;
  races.forEach((r) => { r.isFinalDay = false; });
  races.at(-1).isFinalDay = true;
  check("日目: 後続レースだけ最終日の印", labelOf(json, "12:00"), "最終日");
  races.forEach((r) => { r.seriesDay = 1; });
  check("日目: 初日と最終日の印が重なれば初日", labelOf(json, "12:00"), "初日");
  races.forEach((r) => { r.seriesDay = null; r.isFinalDay = null; });
  check("日目: 値なし", labelOf(json, "12:00"), null);
  races.at(-1).seriesDay = 5;
  check("日目: 後続レースの値で補完", labelOf(json, "12:00"), "5日目");
  races.forEach((r) => { r.startTime = "12:00"; });
  check("日目: 締切と同時刻は次レースに含めない", labelOf(json, "12:00"), null);
  races.at(-1).startTime = null;
  check("日目: 時刻欠損は次レースに含める", labelOf(json, "12:00"), "5日目");
  races.forEach((r) => { r.cancellationStatus = "confirmed"; r.result = null; });
  check("日目: 丸一日中止は時刻欠損でも非表示", labelOf(json, "12:00"), null);
}

// ---- 2. フィクスチャから会場ページ ----
const kiryu = buildVenueModel(fresh(), 1, { t });
check("桐生: レース数", kiryu.races.length, 12);
check("桐生: 見出し", kiryu.heading, "🏁 桐生 本日のレース・AI予想");
check("桐生: 開催ありなので emptyText は null", kiryu.emptyText, null);
check(
  "桐生: title（一般戦は節タイトルなし）",
  kiryu.meta.title,
  ja.venueRaceList.metaTitle.replace("{{venue}}", "桐生"),
);
check(
  "桐生: canonical",
  kiryu.meta.canonical,
  "https://www.boat-ai.jp/venue/1",
);

// ---- 2. 会場ページの title（予想・出走表）と常設の要約2行（BOA-1189 GS02-b）。24場すべて ----
{
  const { venueSummaryLines } = await import("../../src/utils/venueSummary.js");
  // 数字は月1回作り直すので、期待の文は静的な値から組む（文の形と、高い・はっきりしないの出し分けを見る）
  const { VENUE_SUMMARY_STATS: S } =
    await import("../../src/data/venueSummaryStats.js");
  const c1 = (b) => b.courses[0].rate.toFixed(1);
  const n = (x) => x.toLocaleString("en-US");
  const nat = `全国（${n(S.national.races)}レース）の${c1(S.national)}%`;
  const to = S.to.replaceAll("-", "/");
  for (let code = 1; code <= 24; code += 1) {
    const model = buildVenueModel(fresh(), code, { t });
    const name = ja.venues[code];
    check(
      `会場${code}: title は「{会場}競艇の予想・出走表」で始まる`,
      model.meta.title.startsWith(`${name}競艇の予想・出走表`),
      true,
    );
    const lines = venueSummaryLines(t, code);
    check(
      `会場${code}: 要約2行は人の画面と同じ関数の文（開催なしの日も出す）`,
      model.summaryLines,
      [lines.course, lines.techniques],
    );
    check(
      `会場${code}: 要約の1行目は会場名と直近1年で始まる`,
      model.summaryLines[0].startsWith(`${name}の直近1年（`),
      true,
    );
  }
  check(
    "若松: 要約の1行目（全国より高い会場）",
    buildVenueModel(fresh(), 20, { t }).summaryLines[0],
    `若松の直近1年（${to}まで、${n(S.venues[20].races)}レース）、1コースの1着率は${c1(S.venues[20])}%で、${nat}より高い`,
  );
  check(
    "多摩川: 要約の1行目（全国との差が確かめられない会場）",
    buildVenueModel(fresh(), 5, { t }).summaryLines[0],
    `多摩川の直近1年（${to}まで、${n(S.venues[5].races)}レース）、1コースの1着率は${c1(S.venues[5])}%。${nat}との差ははっきりしない`,
  );
}
check("桐生: 1R", kiryu.races[0], {
  raceNumber: 1,
  venueName: "桐生",
  raceLabel: "1R",
  gradeLabel: null,
  cancelledLabel: null,
  deadline: { label: "締切予定時刻", value: "15:19" },
  href: "/race/2026-10-11-01-01",
});
check(
  "桐生: 締切時刻（レース番号順）",
  kiryu.races.map((r) => r.deadline?.value),
  [
    "15:19",
    "15:47",
    "16:17",
    "16:47",
    "17:17",
    "17:48",
    "18:17",
    "18:48",
    "19:16",
    "19:48",
    "20:17",
    "20:45",
  ],
);
check(
  "江戸川: グレード",
  buildVenueModel(fresh(), 3, { t }).races[0].gradeLabel,
  "G3",
);

// レース番号が逆順で来ても、人の画面と同じくレース番号順に並べる
{
  const json = fresh();
  json.data[0].races.reverse();
  check(
    "並び: レース番号順",
    buildVenueModel(json, 1, { t }).races.map((r) => r.raceNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  );
}

// 中止（その日のフィクスチャには無いので、1レースだけ書き換えて確かめる）
{
  const json = fresh();
  const r3 = json.data[0].races.find((r) => r.raceNo === 3);
  r3.cancellationStatus = "confirmed";
  r3.result = null;
  const r4 = json.data[0].races.find((r) => r.raceNo === 4);
  r4.cancellationStatus = "confirmed"; // 結果があるので中止にしない（BOA-525）
  const r5 = json.data[0].races.find((r) => r.raceNo === 5);
  r5.cancellationStatus = "tentative"; // 暫定は中止にしない
  r5.result = null;
  const model = buildVenueModel(json, 1, { t });
  check("中止: confirmed で結果なし", model.races[2].cancelledLabel, "中止");
  check(
    "中止: confirmed でも結果があれば中止にしない",
    model.races[3].cancelledLabel,
    null,
  );
  check("中止: tentative は中止にしない", model.races[4].cancelledLabel, null);
}

// SG・G1 開催中は title・description に節タイトル（NFKC）が入る（人のページと同じ関数）
{
  const json = fresh();
  json.data
    .find((v) => v.place_cd === 3)
    .races.forEach((r) => {
      r.raceGrade = "G1";
    });
  const model = buildVenueModel(json, 3, { t });
  check(
    "G1: title に節タイトル",
    model.meta.title,
    ja.venueRaceList.metaTitleSeries
      .replace("{{venue}}", "江戸川")
      .replace("{{series}}", "オールレディース 江戸川女王決定戦KIRINCUP"),
  );
  check("G1: カードのグレード", model.races[0].gradeLabel, "G1");
}

// ---- 3. 0件と壊れた入力 ----
{
  const empty = {
    success: true,
    scrapedAt: "2026-10-11T00:00:00+00:00",
    data: [],
  };
  const emptyTop = buildTopModel(empty, { t, today: TODAY });
  check("0件: 開催中の会場は0", emptyTop.openVenueCount, 0);
  check(
    "0件: 24会場とも非開催",
    emptyTop.venues.every((v) => !v.isOpen),
    true,
  );
  const emptyVenue = buildVenueModel(empty, 1, { t });
  check(
    "0件: 会場ページは開催なしの文言",
    emptyVenue.emptyText,
    "本日、このレース場での開催はありません",
  );
  check("0件: 会場ページのレースは空", emptyVenue.races, []);
  check(
    "開催していない会場（フィクスチャの平和島）も開催なし",
    buildVenueModel(fresh(), 4, { t }).emptyText,
    ja.home.noRacesToday,
  );
}
const BROKEN = [
  ["null", null],
  ["文字列", "<html>"],
  ["success が false", { success: false, data: [] }],
  ["success が無い", { data: [] }],
  ["data が無い", { success: true }],
  ["data がオブジェクト", { success: true, data: {} }],
  ["会場コードが無い", { success: true, data: [{ races: [] }] }],
  [
    "会場コードが範囲外",
    { success: true, data: [{ place_cd: 99, races: [] }] },
  ],
  ["races が無い", { success: true, data: [{ place_cd: 1 }] }],
  [
    "raceNo が無い",
    { success: true, data: [{ place_cd: 1, races: [{ startTime: "10:00" }] }] },
  ],
];
for (const [label, input] of BROKEN) {
  checkThrows(
    `壊れた入力（${label}）: トップ`,
    () => buildTopModel(input, { t, today: TODAY }),
    "TodayRacesShapeError",
  );
  checkThrows(
    `壊れた入力（${label}）: 会場`,
    () => buildVenueModel(input, 1, { t }),
    "TodayRacesShapeError",
  );
}
check(
  "TodayRacesShapeError を公開している",
  typeof TodayRacesShapeError,
  "function",
);
checkThrows(
  "会場コード 0 は RangeError",
  () => buildVenueModel(fresh(), 0, { t }),
  "RangeError",
);
checkThrows(
  "会場コード 25 は RangeError",
  () => buildVenueModel(fresh(), 25, { t }),
  "RangeError",
);
checkThrows(
  "会場コード文字列は RangeError",
  () => buildVenueModel(fresh(), "01", { t }),
  "RangeError",
);

// ---- 4. 選手名・オッズ等が入らない ----
{
  const json = fresh();
  const racerNames = json.data.flatMap((v) =>
    v.races.flatMap((r) => (r.racers || []).map((p) => p.name)),
  );
  check(
    "フィクスチャに選手名がある（検査が空振りしない）",
    racerNames.length > 0,
    true,
  );
  const models = [
    buildTopModel(fresh(), { t, today: TODAY }),
    ...json.data.map((v) => buildVenueModel(fresh(), v.place_cd, { t })),
  ];
  const text = JSON.stringify(models);
  const leakedNames = racerNames.filter((n) => text.includes(n));
  check("選手名がモデルに無い", leakedNames.slice(0, 3), []);
  const FORBIDDEN_KEYS = [
    "racers",
    "players",
    "odds",
    "payout",
    "payouts",
    "result",
    "rank1",
    "volatility",
    "turnPrediction",
    "winRate",
    "motor2Rate",
  ];
  const keys = new Set();
  const collect = (v) => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        keys.add(k);
        collect(x);
      }
    }
  };
  collect(models);
  check(
    "入れない項目のキーがモデルに無い",
    FORBIDDEN_KEYS.filter((k) => keys.has(k)),
    [],
  );
}

// transformTodayRaces は人の画面と同じ形（success・data・scrapedAt、会場名の補完、荒れ度の補助値）
{
  const out = transformTodayRaces(
    {
      success: true,
      scrapedAt: "x",
      data: [
        {
          place_cd: 5,
          races: [{ raceNo: 1, placeCd: 5, volatility: { level: "high" } }],
        },
      ],
    },
    { 5: 0.5 },
  );
  check(
    "transformTodayRaces: 会場名を会場コードから補う",
    out.data[0].placeName,
    "多摩川",
  );
  check(
    "transformTodayRaces: 荒れ度に会場の1コース勝率を足す",
    out.data[0].races[0].volatility,
    { level: "high", venueWinRate: 0.5 },
  );
  check("transformTodayRaces: scrapedAt はそのまま", out.scrapedAt, "x");
  check(
    "transformTodayRaces: inCaution（BOA-822、RPC 157）は無ければ null にそろえる",
    out.data[0].races[0].inCaution,
    null,
  );
  const ic = { pct: 65, level: "high", n: 34842 };
  check(
    "transformTodayRaces: inCaution はレース直下にそのまま通す",
    transformTodayRaces(
      {
        data: [
          { place_cd: 5, races: [{ raceNo: 1, placeCd: 5, inCaution: ic }] },
        ],
      },
      {},
    ).data[0].races[0].inCaution,
    ic,
  );
}

// BOA-1219: 今日のレースで対象を決め、初日は race_series を使う。
{
  const { seriesOfDate, seriesCoveringDate, SERIES_POSTPONE_TOLERANCE_DAYS } =
    await import("../../src/utils/meetPageModel.js");
  const row = { start_date: "2026-10-06", end_date: "2026-10-11", title: "節", grade: "G1" };
  check("順延3日", seriesOfDate([row], "2026-10-14"), row);
  check("順延4日", seriesOfDate([row], "2026-10-15"), null);
  check("未来の節・空", seriesOfDate([row], "2026-10-05"), null);
  const older = { ...row, start_date: "2026-09-01" };
  check("初日降順の先頭", seriesOfDate([older, row], "2026-10-11"), row);
  check("画面とボットで順延許容日数を共有", SERIES_POSTPONE_TOLERANCE_DAYS, 3);
  // getSeriesOfDate の lte・降順・limit(1) と、その後の共通判定に一致する。
  const rows = [
    row,
    { ...row, start_date: "2026-10-20", end_date: "2026-10-25" },
    older,
  ];
  const before = JSON.stringify(rows);
  for (const date of [
    "2026-08-31", "2026-10-06", "2026-10-11",
    "2026-10-14", "2026-10-15", "2026-10-20",
  ]) {
    const latest = rows
      .filter((r) => r.start_date <= date)
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    check(
      `${date}: getSeriesOfDate と同じ行を返す`,
      seriesOfDate(rows, date) === seriesCoveringDate(latest, date),
      true,
    );
  }
  check("空の節一覧", seriesOfDate([], TODAY), null);
  check("節一覧を並べ替えない", JSON.stringify(rows), before);
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const json = fresh();
    json.data.find((v) => v.place_cd === 1).races.forEach((r) => { r.raceGrade = "G1"; r.raceTitle = "公式の節"; });
    const options = { t, lang, today: "2026-10-11", seriesRows: [row] };
    const model = buildVenueModel(json, 1, options);
    check(`${lang}: 節リンク`, model.meetBanner, {
      href: `${lang === "ja" ? "" : `/${lang}`}/venue/1/meet/2026-10-06`,
      name: "G1 公式の節", inProgress: t("venueMeetBanner.inProgress"), link: t("venueMeetBanner.link"),
    });
    check("行なし", buildVenueModel(json, 1, { ...options, seriesRows: [] }).meetBanner, null);
    check("期限切れ", buildVenueModel(json, 1, { ...options, today: "2026-10-15" }).meetBanner, null);
    for (const race of json.data.find((v) => v.place_cd === 1).races) race.raceTitle = "グランプリ";
    check("対象外", buildVenueModel(json, 1, options).meetBanner, null);
  }
}


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

// ---- 1. の締め: 罠を外し、触った依存・握りつぶされた違反が無いかを見る ----
restoreBrowserGlobals();
checked += 1;
for (const touch of new Set(browserTouches))
  failures.push(`botPageModel.js の木: ${touch}`);
checked += 1;
for (const file of new Set(globalThis[ENV_HIT_KEY] ?? [])) {
  failures.push(`${file}: ブラウザ専用の依存（import.meta.env）を使っている`);
}
checked += 1;
if (Atomics.load(guardState, 1) > 0) {
  failures.push(
    `botPageModel.js の木: react・supabaseClient の import が ${Atomics.load(guardState, 1)} 件（握りつぶされても落とす）`,
  );
}
const treeFileCount = treeUrls.length;
// 木を観測できていること（hook が働かず空振りしていない）
check(
  "§1: import の木を観測できている（10ファイル以上）",
  treeFileCount >= 10,
  true,
);
Atomics.store(guardState, 0, 1);

// ---- 5. 人の画面が同じ関数を使っている（描いて確かめる） ----
// renderJsx の hook（vite の変換・拡張子の補い）は §1 の後に入れる（§1 を甘くしないため）。
// その上に、(a) src/services/supabaseClient.js を偽のクライアントへ、(b) 人の部品・データ層が import する
// 共有の関数（pageMeta.js・raceListDisplay.js・todayRaces.js）を、本物を呼んで呼び出しを記録する物へ差し替える hook を重ねる
// （後に登録した hook が先に呼ばれ、nextResolve で renderJsx の拡張子の補いを通った後の URL を見る）
const { renderJsx } = await import("../lib/renderJsx.js");
const React = (await import("react")).default;
const h = React.createElement;
const routerUrl = new URL(import.meta.resolve("react-router-dom"));
// 1回描いて renderJsx の hook と jsdom を入れてから、記録係の hook を重ねる（順を逆にすると拡張子の無い import が素通りする）
await (
  await renderJsx(routerUrl, { children: null }, { exportName: "MemoryRouter" })
).unmount();

const FAKE_KEY = "__verifyBotPageModelSupabase";
const SPY_KEY = "__verifyBotPageModelCalls";
const SPIES = {
  "utils/pageMeta.js": ["getTopPageMeta", "getTodayVenuePageMeta"],
  "utils/raceListDisplay.js": [
    "venueCardHeadline",
    "raceNumberLabel",
    "deadlineValueText",
  ],
  "utils/todayRaces.js": ["transformTodayRaces"],
};
const SWAP_HOOKS = `
let src;
let spies;
export function initialize(data) {
  src = data.src;
  spies = data.spies;
}
const asModule = (code) => ({ url: "data:text/javascript," + encodeURIComponent(code), shortCircuit: true });
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  const parent = context.parentURL ?? "";
  if (resolved.url === src + "services/supabaseClient.js") {
    return asModule("export const supabase = globalThis.${FAKE_KEY};");
  }
  const target = resolved.url.startsWith(src) ? resolved.url.slice(src.length) : null;
  if (target && spies[target] && parent.startsWith(src)) {
    const importer = JSON.stringify(parent.slice(src.length));
    const real = JSON.stringify(resolved.url);
    const lines = ["import * as real from " + real + ";", "export * from " + real + ";"];
    for (const name of spies[target]) {
      lines.push(
        "export function " + name + "(...args) { const result = real." + name + "(...args);" +
          " (globalThis.${SPY_KEY} ??= []).push({ importer: " + importer + ", name: " + JSON.stringify(name) + ", args, result });" +
          " return result; }",
      );
    }
    return asModule(lines.join("\\n"));
  }
  return resolved;
}
`;
register(`data:text/javascript,${encodeURIComponent(SWAP_HOOKS)}`, {
  data: { src: SRC_URL, spies: SPIES },
});
const callsOf = (importer, name) =>
  (globalThis[SPY_KEY] ?? []).filter(
    (c) => c.importer === importer && c.name === name,
  );

// 偽の supabase（どの問い合わせも空の結果。auth 等の同期の呼び出しも同じ物を返す）
const fakeResult = { data: [], error: null, count: 0 };
const fakeChain = new Proxy(function fake() {}, {
  get(_, key) {
    if (key === "then") {
      return (resolve, reject) =>
        Promise.resolve(fakeResult).then(resolve, reject);
    }
    return typeof key === "symbol" ? undefined : fakeChain;
  },
  apply: () => fakeChain,
});
globalThis[FAKE_KEY] = fakeChain;

// 通信はしない（fetch を差し替える）。/api/races/today はフィクスチャ、/api/predictions/:date はフィクスチャから組んだ Edge API の形
// （江戸川だけ G1 にして、会場ページの title に節タイトルが入る場合も見る）
const withEdogawaG1 = () => {
  const json = fresh();
  json.data
    .find((v) => v.place_cd === 3)
    .races.forEach((r) => {
      r.raceGrade = "G1";
    });
  return json;
};
const pad2 = (n) => String(n).padStart(2, "0");
const predictionsOf = (date) => ({
  date,
  races: withEdogawaG1().data.flatMap((v) =>
    v.races.map((r) => ({
      raceId: `${date}-${pad2(v.place_cd)}-${pad2(r.raceNo)}`,
      venueCode: v.place_cd,
      raceNumber: r.raceNo,
      startTime: r.startTime,
      raceGrade: r.raceGrade ?? null,
      raceTitle: r.raceTitle ?? null,
      raceStage: r.raceStage ?? null,
      cancellationStatus: r.cancellationStatus ?? null,
      seriesDay: r.seriesDay ?? null,
      isFinalDay: r.isFinalDay ?? null,
      entries: [],
      predictions: {},
    })),
  ),
});
globalThis.fetch = async (input) => {
  const url = String(input?.url ?? input);
  if (url === "/api/races/today") return Response.json(fresh());
  const m = url.match(/^\/api\/predictions\/(\d{4}-\d{2}-\d{2})(\?|$)/);
  if (m) return Response.json(predictionsOf(m[1]));
  return new Response("{}", { status: 404 }); // 他の補助の取得（会場カードの傾向等）は無いものとして描く
};
// 部品の console.log 等は黙らせる（失敗の文だけを出す。報告の前に戻す）
const consoleSaved = { ...console };
for (const level of ["log", "info", "debug", "warn", "error"]) {
  console[level] = () => {};
}

const { setI18n } = await import("react-i18next");
setI18n(i18nAll);
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
const texts = (root, selector) =>
  [...root.querySelectorAll(selector)].map((el) => el.textContent);

// 5a. データ層: 公開の入口（dataService.getRaces）が todayRaces.js の transformTodayRaces を呼び、同じ値を返す
{
  globalThis[SPY_KEY] = [];
  const { dataService } = await import(srcUrl("services/dataService.js"));
  const out = await dataService.getRaces();
  check(
    "データ層: getRaces は transformTodayRaces と同じ値（会場の1コース勝率は偽の DB で空）",
    out,
    transformTodayRaces(fresh(), {}),
  );
  const calls = (globalThis[SPY_KEY] ?? []).filter(
    (c) =>
      c.importer.startsWith("services/") && c.name === "transformTodayRaces",
  );
  check(
    "データ層: getRaces が todayRaces.js の transformTodayRaces を呼んでいる（自前の定義で二重にしない）",
    calls.some((c) => JSON.stringify(c.result) === JSON.stringify(out)),
    true,
  );
}

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

// 5c. 会場ページ（VenueRaceListPage と、その中の RaceCard）。一般戦の桐生と G1 にした江戸川、ja と en
{
  const { default: VenueRaceListPage } = await import(
    srcUrl("pages/VenueRaceListPage.jsx")
  );
  for (const [lang, code] of [
    ["ja", 1],
    ["ja", 3],
    ["en", 1],
  ]) {
    await i18nAll.changeLanguage(lang);
    const model = buildVenueModel(withEdogawaG1(), code, {
      t: tOf(lang),
      lang,
    });
    const view = await renderAt(
      lang === "ja" ? `/venue/${code}` : `/${lang}/venue/${code}`,
      ["/venue/:venueCode", "/:lang/venue/:venueCode"],
      VenueRaceListPage,
      (c) => c.querySelectorAll(".race-card").length === model.races.length,
    );
    const label = `会場${code}（${lang}）`;
    check(
      `${label}: title・description・canonical はモデルと同じ`,
      headMeta(view.document),
      model.meta,
    );
    const metaCalls = callsOf(
      "pages/VenueRaceListPage.jsx",
      "getTodayVenuePageMeta",
    );
    check(
      `${label}: getTodayVenuePageMeta で title 等を組む`,
      metaCalls.some(
        (c) =>
          c.args[1] === code &&
          c.args[3] === lang &&
          JSON.stringify(c.result) === JSON.stringify(model.meta),
      ),
      true,
    );
    const cards = view.container.querySelectorAll(".race-card");
    check(
      `${label}: レースカードのレース番号`,
      texts(view.container, ".race-card .race-number"),
      model.races.map((r) => r.raceLabel),
    );
    check(
      `${label}: レースカードの締切`,
      [...cards].map((c) => [
        c.querySelector(".race-info .info-item .label")?.textContent ?? null,
        c.querySelector(".race-info .info-item .value")?.textContent ?? null,
      ]),
      model.races.map((r) => [
        r.deadline?.label ?? null,
        r.deadline?.value ?? null,
      ]),
    );
    const numbers = model.races.map((r) => r.raceNumber);
    check(
      `${label}: RaceCard が raceNumberLabel(race.raceNumber) で書く`,
      numbers.every((n) =>
        callsOf("components/race/RaceCard.jsx", "raceNumberLabel").some(
          (c) => c.args[0] === n,
        ),
      ),
      true,
    );
    const deadlineCalls = callsOf(
      "components/race/RaceCard.jsx",
      "deadlineValueText",
    );
    check(
      `${label}: RaceCard が deadlineValueText(t, race.startTime) で書く`,
      model.races.every((r) =>
        deadlineCalls.some(
          (c) =>
            typeof c.args[0] === "function" &&
            c.result === r.deadline?.value &&
            c.args[1] ===
              fresh()
                .data.find((v) => v.place_cd === code)
                .races.find((x) => x.raceNo === r.raceNumber).startTime,
        ),
      ),
      true,
    );
    await view.unmount();
  }
}

Object.assign(console, consoleSaved);
report();
console.log(
  `✅ verify-bot-page-model: ${checked}件すべて通過（import の経路 ${treeFileCount} ファイル）`,
);
// 描いた部品の時計（setInterval 等）が残っても待たない
process.exit(0);
