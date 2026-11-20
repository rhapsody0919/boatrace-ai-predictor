/**
 * verify-weather-parsing.js - 公式ページの「水面気象情報」の解析と、race_conditions への反映
 * （scripts/lib/beforeinfoWeather.js・raceConditionsWriter.js、BOA-358）の回帰検証。
 *
 * フィクスチャ（scripts/lib/__fixtures__/weather/）は、2026-09-19に公式サイトから取得した
 * beforeinfo・raceresult ページの「水面気象情報」ブロックの抜粋。期待値は、HTMLの生の表示テキスト
 * （気温・風速・水温・波高・天候名・風向アイコンの番号・タイトル）を目で読んで書いたもので、
 * パーサーの出力から逆算していない。
 *
 * 検証の観点:
 *   1. 解析: 6項目（天候・気温・風速・風向・水温・波高）と観測の時点（「HH:MM現在」「N R時点」）が、
 *      ページの表示と一致する。小数の気温・水温、無風（風向アイコン17）、raceresultの前後の空白を含む
 *   2. 公式の仕様の裏付け: 「(N-1)R時点」のbeforeinfoの値が、(N-1)レースのraceresultの値と一致する
 *   3. 観測時刻の組み立て: 「HH:MM現在」・「N R時点」の解決、発走後・未来・時刻なしの拒否
 *   4. 変更のない行は書かない: 同じ観測の2回目は書き込み0件、値・観測時刻が変われば書く
 *      （DBが返す時刻の表記「+00:00」と、書き込む表記「Z」の違いで、常に変更ありにならない）
 *   5. マイグレーション069が未適用でも、コードが先に動いて壊れない（列が無いエラーで、その列を除いて書き直す）
 *
 * 使い方: npm run verify:weather（DB・ネットワークには接続しない）
 */
import fs from "node:fs";
import * as cheerio from "cheerio";
import {
  buildStartTimeLookup,
  convertWindDirection,
  hasAnyWeather,
  resolveObservedAt,
  scrapeConditions,
  toWeatherColumns,
} from "../lib/beforeinfoWeather.js";


import { runWeatherParsingScenes1 } from "./verifyData/weather-parsing-scenes-1.js";
import { runWeatherParsingScenes2 } from "./verifyData/weather-parsing-scenes-2.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures++;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const FIXTURE_DIR = new URL("../lib/__fixtures__/weather/", import.meta.url);
const load = (name) =>
  cheerio.load(fs.readFileSync(new URL(name, FIXTURE_DIR), "utf8"));
const parse = (name) => scrapeConditions(load(name));
const columns = (name) => toWeatherColumns(parse(name), null);

// ---------------------------------------------------------------------------
// 1. 解析（期待値は生のHTMLの表示から。windDirection は風向アイコンの番号）
// ---------------------------------------------------------------------------
const CASES = [
  // [ファイル, 期待する解析結果]
  [
    "beforeinfo-05-01-1634.html",
    {
      weather: "曇り",
      airTemp: 23,
      windDirection: 17,
      windVelocity: 0,
      waterTemp: 24,
      waveHeight: 1,
      observedTime: "16:34",
      observedRace: null,
    },
  ],
  [
    "beforeinfo-17-02.html",
    {
      weather: "曇り",
      airTemp: 25,
      windDirection: 11,
      windVelocity: 1,
      waterTemp: 25,
      waveHeight: 1,
      observedTime: null,
      observedRace: 1,
    },
  ],
  [
    "beforeinfo-13-10.html",
    {
      weather: "曇り",
      airTemp: 32.5,
      windDirection: 6,
      windVelocity: 4,
      waterTemp: 25.4,
      waveHeight: 0,
      observedTime: null,
      observedRace: 9,
    },
  ],
  [
    "beforeinfo-23-03.html",
    {
      weather: "雨",
      airTemp: 23,
      windDirection: 4,
      windVelocity: 4,
      waterTemp: 25,
      waveHeight: 4,
      observedTime: null,
      observedRace: 2,
    },
  ],
  [
    "beforeinfo-05-06.html",
    {
      weather: "雨",
      airTemp: 22,
      windDirection: 17,
      windVelocity: 0,
      waterTemp: 24,
      waveHeight: 2,
      observedTime: null,
      observedRace: 5,
    },
  ],
  [
    "beforeinfo-16-06.html",
    {
      weather: "晴",
      airTemp: 28,
      windDirection: 13,
      windVelocity: 3,
      waterTemp: 27,
      waveHeight: 3,
      observedTime: null,
      observedRace: 5,
    },
  ],
  [
    "raceresult-05-01.html",
    {
      weather: "曇り",
      airTemp: 24,
      windDirection: 1,
      windVelocity: 1,
      waterTemp: 23,
      waveHeight: 2,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-17-01.html",
    {
      weather: "曇り",
      airTemp: 25,
      windDirection: 11,
      windVelocity: 1,
      waterTemp: 25,
      waveHeight: 1,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-17-02.html",
    {
      weather: "曇り",
      airTemp: 25,
      windDirection: 17,
      windVelocity: 0,
      waterTemp: 25,
      waveHeight: 1,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-05-06.html",
    {
      weather: "雨",
      airTemp: 22,
      windDirection: 13,
      windVelocity: 1,
      waterTemp: 24,
      waveHeight: 2,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-13-10.html",
    {
      weather: "曇り",
      airTemp: 32.6,
      windDirection: 2,
      windVelocity: 3,
      waterTemp: 25.5,
      waveHeight: 0,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-23-03.html",
    {
      weather: "雨",
      airTemp: 23,
      windDirection: 4,
      windVelocity: 4,
      waterTemp: 25,
      waveHeight: 4,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-16-06.html",
    {
      weather: "晴",
      airTemp: 28,
      windDirection: 13,
      windVelocity: 4,
      waterTemp: 27,
      waveHeight: 5,
      observedTime: null,
      observedRace: null,
    },
  ],
  [
    "raceresult-15-10.html",
    {
      weather: "曇り",
      airTemp: 28,
      windDirection: 15,
      windVelocity: 3,
      waterTemp: 28,
      waveHeight: 3,
      observedTime: null,
      observedRace: null,
    },
  ],
];
for (const [name, expected] of CASES) {
  const actual = parse(name);
  const mismatched = Object.keys(expected).filter(
    (k) => actual[k] !== expected[k],
  );
  check(
    `解析: ${name}`,
    mismatched.length === 0,
    mismatched
      .map((k) => `${k}: 期待${expected[k]} 実際${actual[k]}`)
      .join(", "),
  );
}

const emptyPage = scrapeConditions(cheerio.load("<html><body></body></html>"));
check(
  "解析: 水面気象情報ブロックが無いページは、全項目null（例外を出さない）",
  emptyPage.weather === null &&
    emptyPage.airTemp === null &&
    emptyPage.windVelocity === null &&
    emptyPage.waterTemp === null &&
    emptyPage.waveHeight === null &&
    emptyPage.windDirection === null &&
    emptyPage.observedTime === null &&
    emptyPage.observedRace === null,
);
// 直接呼び出しの契約（BOA-1131）。未定義の入力は下の KNOWN_GAPS で観測する。
check(
  "convertWindDirection: 1〜16の方位名は番号順に一致する",
  same(Array.from({ length: 16 }, (_, i) => convertWindDirection(i + 1)), [
    "北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東",
    "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西",
  ]),
);
for (const [label, input, expected] of [
  ["17（無風）", 17, null],
  ["0", 0, null],
  ["-1", -1, null],
  ["null", null, null],
  ["undefined", undefined, null],
  ['文字列"1"', "1", "北"],
  ['文字列"16"', "16", "北北西"],
  ['文字列"17"', "17", null],
]) {
  check(`convertWindDirection: ${label}`, same(convertWindDirection(input), expected));
}
const EMPTY_WEATHER = {
  weather: null,
  airTemp: null,
  windVelocity: null,
  windDirection: null,
  waterTemp: null,
  waveHeight: null,
  observedTime: null,
  observedRace: null,
};
for (const [label, input, expected] of [
  ["null", null, false],
  ["undefined", undefined, false],
  ["空オブジェクト", {}, false],
  ["全項目null", EMPTY_WEATHER, false],
  ['weather="晴"のみ', { ...EMPTY_WEATHER, weather: "晴" }, true],
  ["airTemp=0のみ", { ...EMPTY_WEATHER, airTemp: 0 }, true],
  ["windVelocity=0のみ", { ...EMPTY_WEATHER, windVelocity: 0 }, true],
  ["waterTemp=24のみ", { ...EMPTY_WEATHER, waterTemp: 24 }, true],
  ["waveHeight=0のみ", { ...EMPTY_WEATHER, waveHeight: 0 }, true],
  ['observedTime="10:34"のみ', { ...EMPTY_WEATHER, observedTime: "10:34" }, false],
  ["observedRace=3のみ", { ...EMPTY_WEATHER, observedRace: 3 }, false],
  ["気象ブロックの無いemptyPage", emptyPage, false],
]) {
  check(`hasAnyWeather: ${label}`, same(hasAnyWeather(input), expected));
}

// 仕様未定。現在値を表示するだけで、failures には含めない。
const KNOWN_GAPS = [
  ...[
    ["1.5", 1.5],
    ["NaN", NaN],
    ['"abc"', "abc"],
  ].map(([label, input]) => ({
    input: `convertWindDirection(${label})`,
    specification: "未定（scrapeConditionsはparseIntの整数のみ渡す）",
    current: convertWindDirection(input),
  })),
  {
    input: "hasAnyWeather({...B, windDirection: 5})",
    specification: "未定（風向だけを気象ありに含める意図は未確認）",
    current: hasAnyWeather({ ...EMPTY_WEATHER, windDirection: 5 }),
  },
  {
    input: 'hasAnyWeather({...B, weather: ""})',
    specification: "未定（scrapeConditionsは空文字をnullにする）",
    current: hasAnyWeather({ ...EMPTY_WEATHER, weather: "" }),
  },
  {
    input: "hasAnyWeather({...B, airTemp: NaN})",
    specification: "未定（NaNの扱い）",
    current: hasAnyWeather({ ...EMPTY_WEATHER, airTemp: NaN }),
  },
];

const fullWidthTitle = scrapeConditions(
  cheerio.load(
    '<div class="weather1"><p class="weather1_title">水面気象情報　１２Ｒ時点</p></div>',
  ),
);
check(
  "解析: 全角数字の「１２Ｒ時点」も観測レースとして読める",
  fullWidthTitle.observedRace === 12,
);

// ---------------------------------------------------------------------------
// 2. 公式の仕様の裏付け: 「1R時点」のbeforeinfo（17場2R）＝1R（17場1R）のraceresult
// ---------------------------------------------------------------------------
check(
  "仕様: 17場2Rのbeforeinfo(1R時点)の気象は、17場1Rのraceresultの気象と6項目とも一致する",
  same(columns("beforeinfo-17-02.html"), columns("raceresult-17-01.html")),
);
check(
  "仕様: 17場2Rのbeforeinfo(1R時点)は、17場2R自身のraceresultとは風速・風向が異なる（beforeinfoは1つ前のレースの値）",
  !same(columns("beforeinfo-17-02.html"), columns("raceresult-17-02.html")),
);

// 列変換（DBの列名・丸め・風向の方位名）
const c1 = columns("raceresult-13-10.html");
check(
  "列変換: 気温32.6・水温25.5・風速3・波高0・風向2=北北東",
  c1.temperature === 32.6 &&
    c1.water_temperature === 25.5 &&
    c1.wind_speed === 3 &&
    c1.wave_height === 0 &&
    c1.wind_direction === "北北東" &&
    c1.weather === "曇り",
  JSON.stringify(c1),
);
check(
  "列変換: 無風（風向アイコン17）は wind_direction=null",
  columns("beforeinfo-05-06.html").wind_direction === null,
);
check(
  "列変換: 波高の小数は四捨五入（SMALLINT列のため）",
  toWeatherColumns({ waveHeight: 2.5 }, null).wave_height === 3,
);

// ---------------------------------------------------------------------------
// 3. 観測時刻の組み立て
// ---------------------------------------------------------------------------
const DATE = "2026-09-19";
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);
const NOW = at("10:50");
const START = at("11:07");

check(
  "観測時刻: 「10:34現在」は、レース日のJST 10:34（UTC 01:34）",
  resolveObservedAt({ observedTime: "10:34" }, DATE, {
    now: NOW,
    startTime: START,
  }).observedAt === "2026-09-19T01:34:00.000Z",
);
const lookup = buildStartTimeLookup([
  { venue_code: 5, race_no: 1, start_time: at("10:47") },
  { venue_code: 5, race_no: 2, start_time: START },
  { venue_code: 6, race_no: 1, start_time: at("10:40") },
]);
check(
  "観測時刻: 「1R時点」は、同じ会場の1レース目の発走予定時刻（他会場の1Rではない）",
  resolveObservedAt({ observedRace: 1 }, DATE, {
    now: NOW,
    startTime: START,
    startTimeOfRace: (n) => lookup(5, n),
  }).observedAt === "2026-09-19T01:47:00.000Z",
);
check(
  "観測時刻: 「1R時点」で、その発走予定時刻が分からなければ no_time（書かない）",
  resolveObservedAt({ observedRace: 9 }, DATE, {
    now: NOW,
    startTime: START,
    startTimeOfRace: (n) => lookup(5, n),
  }).problem === "no_time",
);
check(
  "観測時刻: 時刻も「N R時点」も無い（観測なし）は no_time",
  resolveObservedAt({}, DATE, { now: NOW, startTime: START }).problem ===
    "no_time" &&
    resolveObservedAt(null, DATE, { now: NOW, startTime: START }).problem ===
      "no_time",
);

// ---- 後半の場面（verifyData/weather-parsing-scenes-1.js・weather-parsing-scenes-2.js） ----
runWeatherParsingScenes1({ check, parse, emptyPage, DATE, at, NOW, START, lookup });
await runWeatherParsingScenes2({ check, KNOWN_GAPS });

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
