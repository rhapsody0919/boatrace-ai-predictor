#!/usr/bin/env node
/**
 * ボット向け HTML（ADR 0089）のモデル（src/utils/botPageModel.js）と、その材料の純粋なモジュールを検証する。
 *
 * 守るもの:
 * 1. botPageModel.js から辿れるモジュールが Node から import でき、ブラウザ専用の依存
 *    （supabaseClient・import.meta.env・localStorage・window・document）を持ち込んでいない
 * 2. 本番の /api/races/today の実物（2026-10-11 に1回保存したフィクスチャ）から、トップと会場ページの
 *    モデルが人の画面と同じ文字で組める（会場数・レース数・締切時刻・見出し・meta）
 * 3. 0件（開催なし）と、形が壊れた入力を区別する。壊れた入力で「開催なし」のモデルを返さない（ADR 0069）
 * 4. 選手名・オッズ・払戻・着順・展開予測・荒れ度がモデルに入らない（ADR 0089 決定7）
 * 5. 人の画面が同じ関数を使い続けている（title 等や会場カード・レースカードの文字の組み方が二重にならない）
 *
 * 実行環境のタイムゾーンを UTC にして走らせる（ボットの関数は UTC で動く。日付が前日にずれないこと）。
 */
process.env.TZ = "UTC";

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import i18next from "i18next";

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

// ---- 1. import の経路にブラウザ専用の依存が無い ----
const ENTRY = "src/utils/botPageModel.js";
const BROWSER_ONLY = [
  { re: /import\.meta\.env/, name: "import.meta.env" },
  { re: /\blocalStorage\b/, name: "localStorage" },
  { re: /\bsessionStorage\b/, name: "sessionStorage" },
  { re: /supabaseClient/, name: "supabaseClient" },
  { re: /\bwindow\./, name: "window" },
  { re: /\bdocument\./, name: "document" },
  { re: /from\s+["']react/, name: "react" },
];
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const visited = new Set();
function walk(rel) {
  if (visited.has(rel)) return;
  visited.add(rel);
  const src = stripComments(read(rel));
  for (const { re, name } of BROWSER_ONLY) {
    checked += 1;
    if (re.test(src))
      failures.push(`${rel}: ブラウザ専用の依存（${name}）がある`);
  }
  for (const m of src.matchAll(
    /(?:import|export)\s[^;]*?from\s+["'](\.[^"']+)["']/g,
  )) {
    const spec = m[1];
    checked += 1;
    if (!/\.(js|json)$/.test(spec)) {
      failures.push(
        `${rel}: 拡張子の無い import "${spec}"（Node で解決できない）`,
      );
      continue;
    }
    walk(
      path.relative(
        repoRoot,
        path.resolve(path.dirname(path.join(repoRoot, rel)), spec),
      ),
    );
  }
}
walk(ENTRY);

const { buildTopModel, buildVenueModel, TodayRacesShapeError } =
  await import("../../src/utils/botPageModel.js");
const { transformTodayRaces } = await import("../../src/utils/todayRaces.js");

// ---- t は ja の i18next（人の画面と同じ common.json・同じ補間の設定） ----
const ja = JSON.parse(read("src/locales/ja/common.json"));
const i18n = i18next.createInstance();
await i18n.init({
  lng: "ja",
  resources: { ja: { common: ja } },
  defaultNS: "common",
  ns: ["common"],
  interpolation: { escapeValue: false },
});
const t = i18n.t.bind(i18n);

const FIXTURE =
  "scripts/lib/__fixtures__/races-today/races-today-2026-10-11.json";
const fixtureText = read(FIXTURE);
const fresh = () => JSON.parse(fixtureText);
const TODAY = "2026-10-11";

// ---- 2. フィクスチャからトップ ----
const top = buildTopModel(fresh(), { t, today: TODAY });
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
});
check("トップ: 江戸川は G3", top.venues[2].gradeLabel, "G3");
check("トップ: 非開催の会場は名前だけ", top.venues[3], {
  venueCode: 4,
  name: "平和島",
  isOpen: false,
});

// ---- 2. フィクスチャから会場ページ ----
const kiryu = buildVenueModel(fresh(), 1, { t });
check("桐生: レース数", kiryu.races.length, 12);
check("桐生: 見出し", kiryu.heading, "🏁 桐生 本日のレース・AI予想");
check("桐生: 開催ありなので emptyText は null", kiryu.emptyText, null);
check(
  "桐生: title（一般戦は節タイトルなし）",
  kiryu.meta.title,
  "桐生競艇のAI予想｜本日の全レース - 龍神レーダー",
);
check(
  "桐生: canonical",
  kiryu.meta.canonical,
  "https://www.boat-ai.jp/venue/1",
);
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
    "江戸川競艇のAI予想 オールレディース 江戸川女王決定戦KIRINCUP｜本日の全レース - 龍神レーダー",
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
}

// ---- 5. 人の画面が同じ関数を使っている ----
const USES = [
  [
    "src/services/supabaseDataService.js",
    /import \{ transformTodayRaces \} from "\.\.\/utils\/todayRaces\.js"/,
    "transformTodayRaces を todayRaces.js から import",
  ],
  [
    "src/services/supabaseDataService.js",
    /function transformTodayRaces\(/,
    null,
  ],
  [
    "src/pages/VenueGridPage.jsx",
    /getTopPageMeta\(t, i18n\.resolvedLanguage\)/,
    "getTopPageMeta で title 等を組む",
  ],
  [
    "src/pages/VenueRaceListPage.jsx",
    /getTodayVenuePageMeta\(/,
    "getTodayVenuePageMeta で title 等を組む",
  ],
  [
    "src/components/race/VenueGridCard.jsx",
    /venueCardHeadline\(races\)/,
    "会場カードの代表値を venueCardHeadline で取る",
  ],
  [
    "src/components/race/RaceCard.jsx",
    /raceNumberLabel\(race\.raceNumber\)/,
    "レース番号を raceNumberLabel で書く",
  ],
  [
    "src/components/race/RaceCard.jsx",
    /deadlineValueText\(t, race\.startTime\)/,
    "締切の値を deadlineValueText で書く",
  ],
];
for (const [rel, re, label] of USES) {
  checked += 1;
  const has = re.test(read(rel));
  if (label && !has)
    failures.push(`${rel}: ${label}していない（文字の組み方が二重になる）`);
  if (!label && has)
    failures.push(
      `${rel}: transformTodayRaces を自前で定義している（todayRaces.js と二重になる）`,
    );
}

if (failures.length > 0) {
  console.error(
    `❌ verify-bot-page-model: ${failures.length}件の失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(
  `✅ verify-bot-page-model: ${checked}件すべて通過（import の経路 ${visited.size} ファイル）`,
);
