/**
 * verify-weather-parsing.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-weather-parsing.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { upsertRaceConditions } from "../../lib/raceConditionsWriter.js";
import { fakeClient, incomingRow, existingRow } from "./weather-parsing-scenes-1.js";

let check, KNOWN_GAPS;

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

async function scene1() {
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
  console.log(`\nKNOWN_GAPS: ${KNOWN_GAPS.length}件（非assert）`);
  for (const gap of KNOWN_GAPS) {
    console.log(`- ${gap.input}: ${gap.specification}; 現在値=${String(gap.current)}`);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・KNOWN_GAPS） */
export async function runWeatherParsingScenes2(env) {
  ({ check, KNOWN_GAPS } = env);
  await scene1();
}
