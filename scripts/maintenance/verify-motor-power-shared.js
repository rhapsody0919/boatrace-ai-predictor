#!/usr/bin/env node
/**
 * BOA-1245: 画面の機力指数（getMotorPowerIndex・motorWindowStart）と龍神ボート番付（rank-data.js の motor_power）が、
 * 同じ純関数（src/utils/motorPowerIndex.js）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層が純関数を import して呼び、指数の計算の写しを持たない
 *   2. 移す前の画面の計算（下の legacyPowerIndex・legacyWindow に写した）と、乱数の入力 3,000 通りで一致する
 *   3. 会場の全機（computeVenueMotorPowerIndexes）は、機ごとに1機の計算を通したものと同じ
 *   4. 番付に載せる最少の走数は画面の小標本の線（SMALL_SAMPLE_THRESHOLD）と同じ値を使う
 *   5. rank-data.js が motor_power の引数の誤りを DB の前に拒否する
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  computeMotorPowerIndex,
  computeVenueMotorPowerIndexes,
  motorWindowFrom,
} from "../../src/utils/motorPowerIndex.js";
import { dataLayerImportNames, dataLayerMethod, readDataLayerSource } from "./dataLayerSource.js";

// 1. サービス層
const service = readDataLayerSource();
assert.deepEqual(dataLayerImportNames("../utils/motorPowerIndex.js", service), [
  "computeMotorPowerIndex",
  "motorWindowFrom",
]);
// 殻のメソッドの形では、旧と同じく次のメソッド getMotorUsageHistory の頭まで
const method = dataLayerMethod("getMotorPowerIndex", {
  until: "  getMotorUsageHistory(",
});
assert.match(
  method,
  /const index = computeMotorPowerIndex\(entries, resultByRaceId\);\s*return index \? \{ \.\.\.windowed, \.\.\.index \} : windowed;/,
);
assert.doesNotMatch(
  method,
  /residuals\.push/,
  "getMotorPowerIndex に指数の計算の写しが残っていない",
);
const windowFn = service.slice(
  service.indexOf("async function motorWindowStart("),
  service.indexOf("const NEUTRAL_EXHIBITION_DIFF_SEC"),
);
assert.match(windowFn, /return motorWindowFrom\(/);
assert.doesNotMatch(
  windowFn,
  /setUTCDate/,
  "motorWindowStart に期間の計算の写しが残っていない",
);
const rankData = readFileSync(
  new URL("../sns/rank-data.js", import.meta.url),
  "utf8",
);
assert.match(
  rankData,
  /import \{ SMALL_SAMPLE_THRESHOLD \} from "\.\.\/\.\.\/src\/components\/race\/basicInfoStats\.js";/,
);
assert.match(rankData, /m\.sample_count >= SMALL_SAMPLE_THRESHOLD/);
const chart = readFileSync(
  new URL(
    "../../src/components/analysis/MotorConditionChart.jsx",
    import.meta.url,
  ),
  "utf8",
);
assert.match(
  chart,
  /powerIndexTone\(\s*powerIndex\?\.power_index,\s*powerIndex\?\.sample_count,\s*SMALL_SAMPLE_THRESHOLD,?\s*\)/,
  "画面の小標本の線が SMALL_SAMPLE_THRESHOLD のまま",
);

// 2. 移す前の画面の計算（origin/master 47cca3f08 の getMotorPowerIndex・motorWindowStart の中身を写した）
function legacyPowerIndex(entries, resultByRaceId) {
  const residuals = [];
  let actualHits2 = 0;
  let actualHits3 = 0;
  let baselineSum = 0;
  entries.forEach((e) => {
    const result = resultByRaceId.get(e.race_id);
    if (!result || e.global_2rate === null) return;
    const isTop2 =
      result.rank1 === e.boat_number || result.rank2 === e.boat_number;
    const isTop3 = isTop2 || result.rank3 === e.boat_number;
    if (isTop2) actualHits2 += 1;
    if (isTop3) actualHits3 += 1;
    residuals.push((isTop2 ? 100 : 0) - e.global_2rate);
    baselineSum += e.global_2rate;
  });
  if (residuals.length === 0) return null;
  return {
    sample_count: residuals.length,
    actual_rate2: (actualHits2 / residuals.length) * 100,
    actual_rate3: (actualHits3 / residuals.length) * 100,
    avg_baseline_rate2: baselineSum / residuals.length,
    power_index: residuals.reduce((sum, v) => sum + v, 0) / residuals.length,
  };
}
function legacyWindow(generationStart, days, beforeRaceId, nowMs) {
  if (generationStart === null)
    return { since: null, generationStart, clippedByGeneration: false };
  const daysAgo = new Date(
    beforeRaceId === null
      ? nowMs + 9 * 60 * 60 * 1000
      : `${beforeRaceId.slice(0, 10)}T00:00:00Z`,
  );
  daysAgo.setUTCDate(daysAgo.getUTCDate() - days);
  const windowStart = daysAgo.toISOString().split("T")[0];
  const clippedByGeneration = generationStart > windowStart;
  return {
    since: clippedByGeneration ? generationStart : windowStart,
    generationStart,
    clippedByGeneration,
  };
}

let seed = 1245;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
for (let t = 0; t < 3000; t++) {
  const entries = [];
  const resultByRaceId = new Map();
  const n = Math.floor(rand() * 40);
  for (let i = 0; i < n; i++) {
    const id = `r${i}`;
    entries.push({
      race_id: id,
      boat_number: pick([1, 2, 3, 4, 5, 6]),
      global_2rate: pick([null, 0, 18.5, 33.3, 61.2]),
      motor_number: pick([11, 12, 13]),
    });
    if (rand() < 0.8)
      resultByRaceId.set(id, {
        rank1: pick([1, 2, 3, null]),
        rank2: pick([2, 4, 5, null]),
        rank3: pick([3, 6, null]),
      });
  }
  assert.deepStrictEqual(
    computeMotorPowerIndex(entries, resultByRaceId),
    legacyPowerIndex(entries, resultByRaceId),
    `乱数の入力 ${t}`,
  );
  // 3. 会場の全機は、機ごとに1機の計算を通したもの
  const venue = computeVenueMotorPowerIndexes(entries, resultByRaceId);
  for (const motor of [11, 12, 13]) {
    const one = legacyPowerIndex(
      entries.filter((e) => e.motor_number === motor),
      resultByRaceId,
    );
    const got = venue.find((m) => m.motor_number === motor) ?? null;
    assert.deepStrictEqual(got, one ? { motor_number: motor, ...one } : null);
  }
  // 期間: 画面の基準日（JST の今日・beforeRaceId の日）で同じ
  const gen = pick([null, "2025-10-20", "2026-08-01", "2026-10-20"]);
  const days = pick([30, 90]);
  const nowMs = Date.UTC(2026, 10, 4, pick([0, 14, 15, 23]), 30);
  const jstDay = new Date(nowMs + 9 * 3600 * 1000).toISOString().slice(0, 10);
  assert.deepStrictEqual(
    motorWindowFrom(gen, days, jstDay),
    legacyWindow(gen, days, null, nowMs),
  );
  assert.deepStrictEqual(
    motorWindowFrom(gen, days, "2026-09-15"),
    legacyWindow(gen, days, "2026-09-15-02-07", nowMs),
  );
}

// 5. 引数
const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const env = { PATH: process.env.PATH };
for (const args of [
  ["--dataset=motor_power"],
  ["--dataset=motor_power", "--venue=0"],
  ["--dataset=motor_power", "--venue=25"],
  ["--dataset=motor_power", "--venue=abc"],
  ["--dataset=motor_power", "--venue=2", "--to=2026-11"],
  ["--dataset=motor_power", "--venue=2", "--from=2026-10-01"],
]) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    encoding: "utf8",
    timeout: 10000,
    env,
  });
  assert.equal(r.status, 1, JSON.stringify(args));
  assert.equal(r.stdout, "");
  assert.doesNotMatch(
    r.stderr,
    /匿名キーが無い/,
    `${JSON.stringify(args)} は DB の前に拒否する: ${r.stderr}`,
  );
}

console.log(
  "✅ verify-motor-power-shared: 画面が純関数を使う・旧計算と3,000通り一致（指数・期間）・会場の全機・最少の走数・引数の拒否を確認",
);
