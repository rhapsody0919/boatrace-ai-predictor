#!/usr/bin/env node
/**
 * BOA-1245: 画面の機力指数（getMotorPowerIndex・motorWindowStart）と龍神ボート番付（rank-data.js の motor_power）が、
 * 同じ純関数（src/utils/motorPowerIndex.js）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層（getMotorPowerIndex・motorWindowStart）を偽の supabase の上で呼び、取る表・列・絞りと、返す指数・期間が
 *      純関数（手で数えた値・motorWindowFrom）と同じになる（BOA-1675。本文の正規表現から置き換え）
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
import { register } from "node:module";

// ---- サービス層を偽の supabase クライアントの上で呼ぶ土台（BOA-1675。本文の正規表現から置き換え） ----
// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyMotorPowerSharedSupabase";
const SWAP_CLIENT = `
export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context);
  if (resolved.url.endsWith("/src/services/supabaseClient.js")) {
    return {
      url: "data:text/javascript," + encodeURIComponent("export const supabase = globalThis.${FAKE_KEY};"),
      shortCircuit: true,
    };
  }
  return resolved;
}
`;
register(new URL("../lib/renderJsx.js", import.meta.url));
register(`data:text/javascript,${encodeURIComponent(SWAP_CLIENT)}`);

/**
 * 偽の supabase クライアント（メモリ上の表）。select・eq・gt・gte・lt・lte・in・like・order（ascending）・limit・range・
 * maybeSingle と await を扱い、呼ばれた問い合わせを calls に残す。failTables（表 → 例外へ足す項目）の表は例外で失敗する
 */
function makeFakeSupabase(tables, { failTables = new Map() } = {}) {
  const calls = [];
  const likeToRe = (pat) =>
    new RegExp(
      `^${pat
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/_/g, ".")
        .replace(/%/g, ".*")}$`,
    );
  const client = {
    calls,
    from(table) {
      const q = {
        table,
        select: null,
        filters: [],
        orders: [],
        desc: new Set(),
        range: null,
        limit: null,
      };
      calls.push(q);
      const run = (single = false) => {
        // 本物のクライアントは throwOnError を既定で付ける（supabaseClient.js）ので、失敗は例外で来る
        if (failTables.has(table))
          return Promise.reject(
            Object.assign(
              new Error(`fake failure: ${table}`),
              failTables.get(table),
            ),
          );
        let rows = (tables[table] ?? []).filter((row) =>
          q.filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gt") return v > val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            if (op === "like") return likeToRe(val).test(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        if (q.orders.length > 0)
          rows = [...rows].sort((a, b) => {
            for (const col of q.orders) {
              const dir = q.desc.has(col) ? -1 : 1;
              if (a[col] < b[col]) return -dir;
              if (a[col] > b[col]) return dir;
            }
            return 0;
          });
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        if (q.limit !== null) rows = rows.slice(0, q.limit);
        const copy = rows.map((r) => ({ ...r }));
        return Promise.resolve({
          data: single ? (copy[0] ?? null) : copy,
          error: null,
        });
      };
      const filter = (op) => (col, val) => {
        q.filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select(cols) {
          q.select = cols;
          return chain;
        },
        eq: filter("eq"),
        gt: filter("gt"),
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        in: filter("in"),
        like: filter("like"),
        order(col, { ascending = true } = {}) {
          q.orders.push(col);
          if (!ascending) q.desc.add(col);
          return chain;
        },
        limit(n) {
          q.limit = n;
          return chain;
        },
        range(a, b) {
          q.range = [a, b];
          return chain;
        },
        maybeSingle: () => run(true),
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      return chain;
    },
  };
  return client;
}
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く（メモリのキャッシュは clearCache で消す）
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};

// 1. サービス層（公開の入口 getMotorPowerIndex・motorWindowStart を偽の supabase の上で呼ぶ）
const fakeTables = {};
const failTables = new Map();
const fake = makeFakeSupabase(fakeTables, { failTables });
globalThis[FAKE_KEY] = fake;
const { clearCache } = await import("../../src/services/core.js");
const { motorWindowStart } = await import("../../src/services/motorQueries.js");
const { getMotorPowerIndex } =
  await import("../../src/services/motorQueries2.js");
const setTables = (next) => {
  for (const k of Object.keys(fakeTables)) delete fakeTables[k];
  Object.assign(fakeTables, next);
  clearCache();
  fake.calls.length = 0;
};
const queriesOn = (table) => fake.calls.filter((c) => c.table === table);
const jstToday = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const race = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const ent = (race_id, boat_number, global_2rate, motor_number = 11) => ({
  race_id,
  boat_number,
  global_2rate,
  motor_number,
});
const res = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
const emptyIndex = (venue, motor) => ({
  venue_code: venue,
  motor_number: motor,
  sample_count: 0,
  actual_rate2: null,
  actual_rate3: null,
  avg_baseline_rate2: null,
  power_index: null,
  generation_unknown: false,
  clipped_by_generation: false,
});

const BEFORE = "2026-10-20-03-05";
const mainTables = (startDates) => ({
  venue_motor_start_dates: startDates,
  races: [
    "2026-09-19-03-01", // 期間の外
    "2026-09-20-03-01", // 期間の端（30日前の日。含む）
    "2026-10-10-03-02",
    "2026-10-10-04-02", // 別の会場
    "2026-10-12-03-03",
    "2026-10-13-03-01",
    "2026-10-20-03-04", // このレースの直前
    BEFORE, // このレース自身（入らない）
    "2026-10-20-03-06", // このレースより後
    "2026-10-21-03-01", // 翌日
  ].map(race),
  race_entries: [
    ent("2026-09-19-03-01", 1, 99),
    ent("2026-09-20-03-01", 1, 50),
    ent("2026-10-10-03-02", 2, 30),
    ent("2026-10-10-03-02", 5, 70, 12), // 別のモーター
    ent("2026-10-10-04-02", 1, 10),
    ent("2026-10-12-03-03", 4, null), // 全国2連率なし（数えない）
    ent("2026-10-13-03-01", 6, 40), // 結果の行なし（数えない）
    ent("2026-10-20-03-04", 3, 20),
    ent(BEFORE, 1, 40),
    ent("2026-10-20-03-06", 1, 40),
    ent("2026-10-21-03-01", 1, 40),
  ],
  race_results: [
    res("2026-09-19-03-01", 1, 2, 3),
    res("2026-09-20-03-01", 1, 4, 6), // 艇1: 1着（2着以内）
    res("2026-10-10-03-02", 1, 3, 2), // 艇2: 3着（3着以内のみ）
    res("2026-10-10-04-02", 1, 2, 3),
    res("2026-10-12-03-03", 4, 1, 2),
    res("2026-10-20-03-04", 3, 1, 2), // 艇3: 1着
    res(BEFORE, 1, 2, 3),
    res("2026-10-20-03-06", 1, 2, 3),
    res("2026-10-21-03-01", 1, 2, 3),
  ],
});

// 1a. 世代の開始日が期間より前: 期間は 30 日前の日から、このレースの日まで。数えるのは会場3・モーター11・このレースより前の走
setTables(
  mainTables([
    { venue_code: 3, start_date: "2025-10-01" },
    { venue_code: 3, start_date: "2026-09-01" }, // 最新の開始日を使う
    { venue_code: 4, start_date: "2026-10-15" },
  ]),
);
const COUNTED = [
  "2026-09-20-03-01",
  "2026-10-10-03-02",
  "2026-10-12-03-03",
  "2026-10-13-03-01",
  "2026-10-20-03-04",
];
assert.deepStrictEqual(await getMotorPowerIndex(3, 11, 30, BEFORE), {
  ...emptyIndex(3, 11),
  sample_count: 3, // 艇1・艇2・艇3 の3走
  actual_rate2: (2 / 3) * 100, // 艇1・艇3 が2着以内
  actual_rate3: 100,
  avg_baseline_rate2: 100 / 3, // (50+30+20)/3
  power_index: 100 / 3, // ((100-50)+(0-30)+(100-20))/3
});
assert.deepStrictEqual(
  queriesOn("venue_motor_start_dates").map((c) => c.filters),
  [[["eq", "venue_code", 3]]],
  "使用開始日は会場で絞って取る",
);
{
  const [q] = queriesOn("races");
  assert.equal(queriesOn("races").length, 1);
  assert.deepStrictEqual(q.filters, [
    ["eq", "venue_code", 3],
    ["gte", "race_date", "2026-09-20"],
    ["lte", "race_date", "2026-10-20"],
  ]);
  assert.deepStrictEqual(q.orders, ["race_date", "race_id"]);
  assert.match(q.select, /race_id/);
  const [e] = queriesOn("race_entries");
  assert.equal(e.select, "race_id, boat_number, global_2rate");
  assert.deepStrictEqual(
    e.filters.map(([op, col]) => `${op}:${col}`),
    ["in:race_id", "eq:motor_number"],
  );
  assert.deepStrictEqual([...e.filters[0][2]].sort(), COUNTED);
  assert.equal(e.filters[1][2], 11);
  const [r] = queriesOn("race_results");
  assert.equal(r.select, "race_id, rank1, rank2, rank3");
  assert.deepStrictEqual(
    r.filters.map(([op, col]) => `${op}:${col}`),
    ["in:race_id"],
  );
  assert.deepStrictEqual(
    [...r.filters[0][2]].sort(),
    COUNTED,
    "結果は出走のあった走だけ取る",
  );
}

// 1b. 世代の開始日が期間の中: 開始日から数え、切り詰めた印を付ける（入れ替え前の別のモーターを混ぜない）
setTables(mainTables([{ venue_code: 3, start_date: "2026-10-10" }]));
assert.deepStrictEqual(await getMotorPowerIndex(3, 11, 30, BEFORE), {
  ...emptyIndex(3, 11),
  clipped_by_generation: true,
  sample_count: 2, // 艇2（10/10）・艇3
  actual_rate2: 50,
  actual_rate3: 100,
  avg_baseline_rate2: 25,
  power_index: 25, // ((0-30)+(100-20))/2
});
assert.deepStrictEqual(
  queriesOn("races")[0].filters.filter(([op]) => op === "gte"),
  [["gte", "race_date", "2026-10-10"]],
);

// 1c. 世代の開始日が分からない会場: 数えず generation_unknown（走の表は読まない）
setTables(mainTables([{ venue_code: 4, start_date: "2026-10-15" }]));
assert.deepStrictEqual(await getMotorPowerIndex(3, 11, 30, BEFORE), {
  ...emptyIndex(3, 11),
  generation_unknown: true,
});
assert.equal(queriesOn("races").length, 0);
assert.equal(queriesOn("race_entries").length, 0);

// 1d. 期間にレースが無い・そのモーターの出走が無い・結果が使えない: 空の指数（出走・結果の表を先へ進まない）
setTables(mainTables([{ venue_code: 3, start_date: "2025-10-01" }]));
assert.deepStrictEqual(
  await getMotorPowerIndex(3, 11, 30, "2025-10-01-03-01"),
  { ...emptyIndex(3, 11), clipped_by_generation: true }, // 開始日の 10/01 は期間（9/01〜）の中
);
assert.equal(
  queriesOn("race_entries").length,
  0,
  "レースが無ければ出走は読まない",
);
setTables(mainTables([{ venue_code: 3, start_date: "2025-10-01" }]));
assert.deepStrictEqual(
  await getMotorPowerIndex(3, 99, 30, BEFORE),
  emptyIndex(3, 99),
);
assert.equal(
  queriesOn("race_results").length,
  0,
  "出走が無ければ結果は読まない",
);
setTables({
  ...mainTables([{ venue_code: 3, start_date: "2025-10-01" }]),
  race_results: [],
});
assert.deepStrictEqual(
  await getMotorPowerIndex(3, 11, 30, BEFORE),
  emptyIndex(3, 11),
);

// 1e. 基準日を渡さない: 期間は JST の今日から days 日前、上限なし
setTables(mainTables([{ venue_code: 3, start_date: "2020-01-01" }]));
{
  const before = jstToday();
  await getMotorPowerIndex(3, 90, 90);
  const after = jstToday();
  const minus = (d, n) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() - n);
    return t.toISOString().slice(0, 10);
  };
  const [q] = queriesOn("races");
  assert.ok(
    [minus(before, 90), minus(after, 90)].includes(
      q.filters.find(([op]) => op === "gte")[2],
    ),
    "基準日が無ければ JST の今日から90日前",
  );
  assert.deepStrictEqual(
    q.filters.find(([op]) => op === "lte"),
    ["lte", "race_date", "9999-12-31"],
  );
}

// 1f. motorWindowStart は、世代の開始日（会場の最新の使用開始日）を純関数 motorWindowFrom に通した値
for (const gen of [null, "2026-10-20", "2026-09-20", "2025-10-01"]) {
  for (const days of [30, 90]) {
    for (const beforeRaceId of ["2026-09-15-02-07", "2026-10-31-02-07"]) {
      setTables({
        venue_motor_start_dates:
          gen === null
            ? []
            : [
                { venue_code: 2, start_date: "2020-01-01" },
                { venue_code: 2, start_date: gen },
              ],
      });
      assert.deepStrictEqual(
        await motorWindowStart(2, days, beforeRaceId),
        motorWindowFrom(gen, days, beforeRaceId.slice(0, 10)),
        `motorWindowStart(${gen}, ${days}, ${beforeRaceId})`,
      );
    }
  }
}
setTables({
  venue_motor_start_dates: [{ venue_code: 2, start_date: "2020-01-01" }],
});
{
  const before = jstToday();
  const got = await motorWindowStart(2, 30);
  const after = jstToday();
  assert.ok(
    [before, after].some(
      (d) =>
        JSON.stringify(got) ===
        JSON.stringify(motorWindowFrom("2020-01-01", 30, d)),
    ),
    "基準日が無ければ JST の今日",
  );
}
// 使用開始日の取得エラー（権限以外）は例外にする
setTables({});
failTables.set("venue_motor_start_dates", {});
await assert.rejects(
  () => motorWindowStart(2, 30, "2026-10-01-02-01"),
  /fake failure/,
);
// 権限が無い（マイグレーション104が外された）ときは世代不明
clearCache();
failTables.set("venue_motor_start_dates", { code: "42501" });
assert.deepStrictEqual(await motorWindowStart(2, 30, "2026-10-01-02-01"), {
  since: null,
  generationStart: null,
  clippedByGeneration: false,
});
failTables.clear();
setTables({});

const rankData = readFileSync(
  new URL("../sns/rank-data.js", import.meta.url),
  "utf8",
);
assert.match(
  rankData,
  // BOA-1501 で src/pure へ移す。移す前後のどちらの置き場でも合格（移した後に元の場所の分岐は外す）
  /import \{ SMALL_SAMPLE_THRESHOLD \} from "\.\.\/\.\.\/src\/(?:pure|components\/race)\/basicInfoStats\.js";/,
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
