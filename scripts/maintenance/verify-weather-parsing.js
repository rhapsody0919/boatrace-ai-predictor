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
  buildResultWeatherRows,
  buildStartTimeLookup,
  buildWeatherRows,
  resolveObservedAt,
  scrapeConditions,
  toWeatherColumns,
} from "../lib/beforeinfoWeather.js";
import {
  isObservedAtColumnMissing,
  upsertRaceConditions,
} from "../lib/raceConditionsWriter.js";
import {
  diffRows,
  NUMERIC_SCALES,
  TIMESTAMP_COLUMNS,
} from "../lib/unchangedRows.js";

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
check(
  "観測時刻: 発走予定時刻以降の観測は after_start（過去レースのページは、その日の最新の観測を出すため）",
  resolveObservedAt({ observedTime: "16:34" }, DATE, {
    now: at("20:45"),
    startTime: START,
  }).problem === "after_start" &&
    resolveObservedAt({ observedTime: "11:07" }, DATE, {
      now: at("11:30"),
      startTime: START,
    }).problem === "after_start",
);
check(
  "観測時刻: 「N R時点」のNが自分のレース以降なら after_start",
  resolveObservedAt({ observedRace: 2 }, DATE, {
    now: NOW,
    startTime: START,
    startTimeOfRace: (n) => lookup(5, n),
  }).problem === "after_start",
);
check(
  "観測時刻: 今より10分を超える未来は future（日付・時計の取り違え）",
  resolveObservedAt({ observedTime: "11:00" }, DATE, { now: at("10:30") })
    .problem === "future" &&
    resolveObservedAt({ observedTime: "10:38" }, DATE, { now: at("10:30") })
      .problem === null,
);
check(
  "観測時刻: 23:58の観測も、日付はレース日のまま（日をまたぐ組み立てはしない）",
  resolveObservedAt({ observedTime: "23:58" }, DATE, { now: at("23:59") })
    .observedAt === "2026-09-19T14:58:00.000Z",
);

// buildWeatherRows: 反映する行と、反映しない理由の内訳
{
  const cond = parse("beforeinfo-17-02.html"); // 1R時点
  const lookupFor = buildStartTimeLookup([
    { venue_code: 17, race_no: 1, start_time: at("10:40") },
    { venue_code: 17, race_no: 2, start_time: START },
  ]);
  const { rows, stats } = buildWeatherRows(
    [
      {
        raceId: "2026-09-19-17-02",
        venueCode: 17,
        startTime: START,
        conditions: cond,
      },
      {
        raceId: "2026-09-19-17-03",
        venueCode: 17,
        startTime: START,
        conditions: emptyPage,
      },
      {
        raceId: "2026-09-19-05-01",
        venueCode: 5,
        startTime: START,
        conditions: parse("beforeinfo-05-01-1634.html"),
      },
      {
        raceId: "2026-09-19-05-06",
        venueCode: 5,
        startTime: START,
        conditions: parse("beforeinfo-05-06.html"),
      },
    ],
    DATE,
    { now: NOW, startTimeLookup: lookupFor },
  );
  check(
    "buildWeatherRows: 反映は1行（17場2R。観測時刻は1Rの発走予定時刻）",
    rows.length === 1 &&
      rows[0].race_id === "2026-09-19-17-02" &&
      rows[0].weather_observed_at === "2026-09-19T01:40:00.000Z",
    JSON.stringify(rows),
  );
  check(
    "buildWeatherRows: 反映しなかった内訳（気象なし1・発走後の観測1・観測時刻不明1）を数える",
    stats.fetched === 4 &&
      stats.parsed === 1 &&
      stats.noWeather === 1 &&
      stats.after_start === 1 &&
      stats.no_time === 1,
    JSON.stringify(stats),
  );
}

// レース結果ページの行: 観測時刻は発走予定時刻（無ければNULL）
{
  const { rows, stats } = buildResultWeatherRows([
    {
      raceId: "2026-09-19-17-01",
      startTime: at("10:20"),
      conditions: parse("raceresult-17-01.html"),
    },
    {
      raceId: "2026-09-19-17-02",
      startTime: null,
      conditions: parse("raceresult-17-02.html"),
    },
    { raceId: "2026-09-19-17-03", startTime: START, conditions: emptyPage },
  ]);
  check(
    "結果ページの行: 観測時刻は発走予定時刻。無ければNULL。気象なしは行を作らない",
    rows.length === 2 &&
      rows[0].weather_observed_at === "2026-09-19T01:20:00.000Z" &&
      rows[1].weather_observed_at === null &&
      stats.noWeather === 1,
    JSON.stringify(rows),
  );
}

// ---------------------------------------------------------------------------
// 4. 変更のない行は書かない（DBが返す形の既存行との比較）
// ---------------------------------------------------------------------------
const diff = (existing, incoming) =>
  diffRows(existing, incoming, {
    keyColumns: ["race_id"],
    scales: NUMERIC_SCALES.race_conditions,
    timestampColumns: TIMESTAMP_COLUMNS.race_conditions,
  });
const incomingRow = {
  race_id: "2026-09-19-17-02",
  ...toWeatherColumns(
    parse("beforeinfo-17-02.html"),
    "2026-09-19T01:40:00.000Z",
  ),
};
// PostgREST が返す形: numeric は数値または文字列、timestamptz は「+00:00」表記
const existingRow = {
  race_id: "2026-09-19-17-02",
  weather: "曇り",
  wind_direction: "南西",
  wind_speed: "1.0",
  wave_height: 1,
  temperature: 25.0,
  water_temperature: "25.0",
  weather_observed_at: "2026-09-19T01:40:00+00:00",
};
check(
  "変更なし: 同じ観測の2回目は書き込み0件（時刻の表記Z/+00:00・numericの文字列/数値の違いで誤判定しない）",
  diff([existingRow], [incomingRow]).toWrite.length === 0,
  JSON.stringify(diff([existingRow], [incomingRow]).stats),
);
check(
  "変更あり: 観測時刻が進めば書く（気象の値が同じでも、新しい観測として記録する）",
  diff(
    [existingRow],
    [{ ...incomingRow, weather_observed_at: "2026-09-19T01:55:00.000Z" }],
  ).toWrite.length === 1,
);
check(
  "変更あり: 風速が変われば書く",
  diff([existingRow], [{ ...incomingRow, wind_speed: 2 }]).toWrite.length === 1,
);
check(
  "変更あり: 天候が変われば書く",
  diff([existingRow], [{ ...incomingRow, weather: "雨" }]).toWrite.length === 1,
);
check(
  "変更あり: 既存の観測時刻がNULL（069適用前の行）なら書く",
  diff([{ ...existingRow, weather_observed_at: null }], [incomingRow]).toWrite
    .length === 1,
);
check(
  "変更あり: 既存行が無ければ書く",
  diff([], [incomingRow]).toWrite.length === 1,
);

// ---------------------------------------------------------------------------
// 5. マイグレーション069が未適用でも壊れない
// ---------------------------------------------------------------------------
check(
  "列なしエラーの判定: PostgREST（PGRST204）と PostgreSQL（42703）の両方のメッセージを認識し、別の列・別のエラーは認識しない",
  isObservedAtColumnMissing(
    "Could not find the 'weather_observed_at' column of 'race_conditions' in the schema cache",
  ) &&
    isObservedAtColumnMissing(
      "column race_conditions.weather_observed_at does not exist",
    ) &&
    !isObservedAtColumnMissing(
      "Could not find the 'race_stage' column of 'race_conditions' in the schema cache",
    ) &&
    !isObservedAtColumnMissing(
      "duplicate key value violates unique constraint",
    ) &&
    !isObservedAtColumnMissing(undefined),
);

/** race_conditions だけを持つ疑似クライアント。columnExists=false なら069未適用のDBの挙動を再現する */
function fakeClient({ columnExists, existing = [] }) {
  const calls = { upserts: [], selects: [] };
  const table = {
    select(cols) {
      calls.selects.push(cols);
      return {
        in: async () =>
          !columnExists && cols.includes("weather_observed_at")
            ? {
                data: null,
                error: {
                  message:
                    "column race_conditions.weather_observed_at does not exist",
                },
              }
            : { data: existing, error: null },
      };
    },
    upsert: async (rows) => {
      if (!columnExists && rows.some((r) => "weather_observed_at" in r)) {
        return {
          error: {
            message:
              "Could not find the 'weather_observed_at' column of 'race_conditions' in the schema cache",
          },
        };
      }
      calls.upserts.push(rows);
      return { error: null };
    },
  };
  return { calls, from: (name) => (name === "race_conditions" ? table : null) };
}
const silence = async (fn) => {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = console.warn = console.error = () => {};
  try {
    return await fn();
  } finally {
    Object.assign(console, original);
  }
};

{
  const before = fakeClient({ columnExists: false });
  const result = await silence(() =>
    upsertRaceConditions(before, [
      { ...incomingRow, series_day: 3, race_title: "テスト" },
    ]),
  );
  const written = before.calls.upserts.flat();
  check(
    "069未適用: 観測時刻の列を除いて書き直し、気象・節日数・レース名は書ける",
    result.observedAtSupported === false &&
      written.length === 1 &&
      !("weather_observed_at" in written[0]) &&
      written[0].weather === "曇り" &&
      written[0].series_day === 3 &&
      written[0].race_title === "テスト" &&
      result.error === null,
    JSON.stringify({ result: result.error?.message, written }),
  );
}
{
  const after = fakeClient({ columnExists: true });
  const result = await silence(() =>
    upsertRaceConditions(after, [incomingRow]),
  );
  check(
    "069適用済み: 観測時刻を含めて1回で書く",
    result.observedAtSupported === true &&
      after.calls.upserts.length === 1 &&
      after.calls.upserts[0][0].weather_observed_at ===
        "2026-09-19T01:40:00.000Z",
  );
  const second = fakeClient({ columnExists: true, existing: [existingRow] });
  const secondResult = await silence(() =>
    upsertRaceConditions(second, [incomingRow]),
  );
  check(
    "069適用済み: 既存行と同じ観測なら、書き込み0件",
    secondResult.written === 0 && second.calls.upserts.length === 0,
    JSON.stringify(secondResult.stats),
  );
}

if (failures > 0) {
  console.error(`\n❌ ${failures}件の検証に失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
