/**
 * verify-weather-parsing.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-weather-parsing.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  resolveObservedAt,
  buildStartTimeLookup,
  buildWeatherRows,
  formatWeatherStats,
  buildResultWeatherRows,
  toWeatherColumns,
} from "../../lib/beforeinfoWeather.js";
import { isObservedAtColumnMissing } from "../../lib/raceConditionsWriter.js";
import { diffRows, NUMERIC_SCALES, TIMESTAMP_COLUMNS } from "../../lib/unchangedRows.js";

let check, parse, emptyPage, DATE, at, NOW, START, lookup;
export let incomingRow;

// ---------------------------------------------------------------------------
// 4. 変更のない行は書かない（DBが返す形の既存行との比較）
// ---------------------------------------------------------------------------
const diff = (existing, incoming) =>
  diffRows(existing, incoming, {
    keyColumns: ["race_id"],
    scales: NUMERIC_SCALES.race_conditions,
    timestampColumns: TIMESTAMP_COLUMNS.race_conditions,
  });

// PostgREST が返す形: numeric は数値または文字列、timestamptz は「+00:00」表記
export const existingRow = {
  race_id: "2026-09-19-17-02",
  weather: "曇り",
  wind_direction: "南西",
  wind_speed: "1.0",
  wave_height: 1,
  temperature: 25.0,
  water_temperature: "25.0",
  weather_observed_at: "2026-09-19T01:40:00+00:00",
};

/** race_conditions だけを持つ疑似クライアント。columnExists=false なら069未適用のDBの挙動を再現する */
export function fakeClient({ columnExists, existing = [] }) {
  const calls = { upserts: [], selects: [] };
  const table = {
    select(cols) {
      calls.selects.push(cols);
      return {
        in: async () =>
          !columnExists && cols.includes("weather_observed_at")
            ? {
                data: null,
                // 実際のPostgRESTはコードを返す。コードの無い偽エラーで検証すると、
                // 本番では起きない経路を通してしまう（2026-09-27）
                error: {
                  code: "42703",
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
            code: "PGRST204",
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

function scene1() {
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
}

function scene2() {
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
    const byRace = Object.fromEntries(rows.map((r) => [r.race_id, r]));
    check(
      "buildWeatherRows: 17場2Rは観測時刻つきで反映（観測時刻は1Rの発走予定時刻）",
      byRace["2026-09-19-17-02"]?.weather_observed_at ===
        "2026-09-19T01:40:00.000Z",
      JSON.stringify(rows),
    );
    check(
      "buildWeatherRows: 観測時刻が分からないレース（5R時点で、5Rの発走予定時刻が不明）は、気象の値は反映し、観測時刻は明示的にNULL（古い観測時刻を残さない）",
      byRace["2026-09-19-05-06"] !== undefined &&
        byRace["2026-09-19-05-06"].weather === "雨" &&
        byRace["2026-09-19-05-06"].weather_observed_at === null,
      JSON.stringify(byRace["2026-09-19-05-06"]),
    );
    check(
      "buildWeatherRows: 気象なし・発走後の観測のレースは、行を作らない（既存の良い値を消さない・別の時点の気象を入れない）",
      rows.length === 2 &&
        byRace["2026-09-19-17-03"] === undefined &&
        byRace["2026-09-19-05-01"] === undefined,
      JSON.stringify(rows.map((r) => r.race_id)),
    );
    check(
      "buildWeatherRows: 内訳（取得4・反映2・気象なし1・発走後の観測1・観測時刻不明1）を数える",
      stats.fetched === 4 &&
        stats.parsed === 2 &&
        stats.noWeather === 1 &&
        stats.after_start === 1 &&
        stats.no_time === 1,
      JSON.stringify(stats),
    );
    check(
      "formatWeatherStats: 反映せず・観測時刻不明の内訳がログに出る",
      formatWeatherStats(stats).includes("気象なし1") &&
        formatWeatherStats(stats).includes("発走後の観測1") &&
        formatWeatherStats(stats).includes("観測時刻不明で反映: 1"),
      formatWeatherStats(stats),
    );
  }
}

function scene3() {
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
  incomingRow = {
    race_id: "2026-09-19-17-02",
    ...toWeatherColumns(
      parse("beforeinfo-17-02.html"),
      "2026-09-19T01:40:00.000Z",
    ),
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
    "列なしエラーの判定: PostgREST（PGRST204）と PostgreSQL（42703）の両方を認識し、別の列・別のエラーは認識しない",
    isObservedAtColumnMissing({
      code: "PGRST204",
      message:
        "Could not find the 'weather_observed_at' column of 'race_conditions' in the schema cache",
    }) &&
      isObservedAtColumnMissing({
        code: "42703",
        message: "column race_conditions.weather_observed_at does not exist",
      }) &&
      !isObservedAtColumnMissing({
        code: "PGRST204",
        message:
          "Could not find the 'race_stage' column of 'race_conditions' in the schema cache",
      }) &&
      !isObservedAtColumnMissing({
        code: "23505",
        message: "duplicate key value violates unique constraint",
      }) &&
      !isObservedAtColumnMissing(undefined),
  );
  // コードを落とすとフォールバックが効かなくなる（2026-09-27、upsertChangedRows がエラーを
  // 包み直す際にコードを落としていたため、この経路が壊れかけた）
  check(
    "列なしエラーの判定: メッセージだけ（コード無し）では、列の不在と断定しない",
    !isObservedAtColumnMissing(
      "Could not find the 'weather_observed_at' column of 'race_conditions' in the schema cache",
    ),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・parse・emptyPage・DATE・at・NOW・START・lookup） */
export function runWeatherParsingScenes1(env) {
  ({ check, parse, emptyPage, DATE, at, NOW, START, lookup } = env);
  scene1();
  scene2();
  scene3();
}
