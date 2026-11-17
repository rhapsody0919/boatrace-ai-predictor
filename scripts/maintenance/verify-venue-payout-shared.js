#!/usr/bin/env node
/**
 * BOA-1242: 分析の「会場ランキング」（getTodaysVenueRanking）と龍神ボート番付（rank-data.js の venue_payout・
 * venue_favorite）が、同じ純関数（src/utils/venuePayoutStats.js）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層（getTodaysVenueRanking）を偽の supabase の上で呼び、取る表・列・絞りと、返すランキングが純関数と同じ
 *      になる（BOA-1675。本文の正規表現から置き換え。集計の写しが戻れば、純関数を通した値と食い違う）
 *   2. 移す前の画面の計算（下の legacyRanking に写した）と、乱数の入力 3,000 通りで返り値が一致する
 *   3. 1番人気の数え方（配当と人気のある行だけを分母、人気1を分子）と、不成立・rank1 なしを除くこと
 *   4. rank-data.js が新しい dataset の引数の誤りを、DB を読む前に拒否する
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  HIGH_PAYOUT_YEN,
  rankVenuesByPayout,
  tallyVenuePayouts,
  venuePayoutRates,
} from "../../src/utils/venuePayoutStats.js";
import { isUsableRaceResult } from "../../src/utils/raceResultUsable.js";
import { register } from "node:module";

// ---- サービス層を偽の supabase クライアントの上で呼ぶ土台（BOA-1675。本文の正規表現から置き換え） ----
// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyVenuePayoutSharedSupabase";
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

// 1. サービス層（公開の入口 getTodaysVenueRanking を偽の supabase の上で呼ぶ）
const fakeTables = {};
const fake = makeFakeSupabase(fakeTables);
globalThis[FAKE_KEY] = fake;
const { clearCache } = await import("../../src/services/core.js");
const { getTodaysVenueRanking } =
  await import("../../src/services/venueQueries2.js");
const setTables = (next) => {
  for (const k of Object.keys(fakeTables)) delete fakeTables[k];
  Object.assign(fakeTables, next);
  clearCache();
  fake.calls.length = 0;
};
const jstDate = (offsetDays = 0) =>
  new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000)
    .toISOString()
    .slice(0, 10);
{
  const today = jstDate();
  const mk = (venue, no, rank1, trio, tech, status = null, date = today) => ({
    race: {
      race_id: `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`,
      race_date: date,
      venue_code: venue,
    },
    result: {
      race_id: `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`,
      rank1,
      payout_trio: trio,
      winning_technique: tech,
      race_status: status,
    },
  });
  const data = [
    // 会場1: 3走。平均 (1200+900+15000)/3 = 5700、万舟 1/3、逃げ 2/3（不成立の1走は数えない）
    mk(1, 1, 1, 1200, "逃げ"),
    mk(1, 2, 1, 900, "逃げ"),
    mk(1, 3, 2, 15000, "差し"),
    mk(1, 4, 1, 800, "逃げ", "no_race"),
    // 会場2: 3走。平均 (20000+30000+500)/3、万舟 2/3、逃げ 2/3
    mk(2, 1, 3, 20000, "まくり"),
    mk(2, 2, 1, 30000, "逃げ"),
    mk(2, 3, 1, 500, "逃げ"),
    // 会場3: 2走（最少の3走に足りない）
    mk(3, 1, 1, 700, "逃げ"),
    mk(3, 2, 1, 700, "逃げ"),
    // 昨日の走（今日の集計に入らない）
    mk(1, 5, 1, 99999, "逃げ", null, jstDate(-1)),
  ];
  setTables({
    races: data.map((d) => d.race),
    race_results: data.map((d) => d.result),
  });
  const venueByRaceId = new Map(
    data
      .filter((d) => d.race.race_date === today)
      .map((d) => [d.race.race_id, d.race.venue_code]),
  );
  const todays = data
    .filter((d) => d.race.race_date === today)
    .map((d) => d.result);
  const want = (limit, min) =>
    rankVenuesByPayout(
      tallyVenuePayouts(todays, (id) => venueByRaceId.get(id)),
      limit,
      min,
    );
  const got = await getTodaysVenueRanking(5, 3);
  assert.deepStrictEqual(got, want(5, 3));
  // 手で数えた値（純関数を通した期待値が空振りしていない）
  assert.deepStrictEqual(
    got.stable.map((v) => [v.venue_code, v.race_count, v.avg_payout]),
    [
      [1, 3, 5700],
      [2, 3, 50500 / 3],
    ],
  );
  assert.deepStrictEqual(
    got.rough.map((v) => v.venue_code),
    [2, 1],
  );
  assert.deepStrictEqual(
    got.manshu.map((v) => [v.venue_code, v.manshu_rate]),
    [
      [2, (2 / 3) * 100],
      [1, (1 / 3) * 100],
    ],
  );
  assert.deepStrictEqual(
    got.nigeRate.map((v) => [v.venue_code, v.nige_rate]),
    [
      [1, (2 / 3) * 100],
      [2, (2 / 3) * 100],
    ],
  );
  // 取る表・列・絞り
  const [races] = fake.calls.filter((c) => c.table === "races");
  assert.deepStrictEqual(races.filters, [["eq", "race_date", today]]);
  assert.match(races.select, /race_id/);
  assert.match(races.select, /venue_code/);
  const rr = fake.calls.filter((c) => c.table === "race_results");
  assert.equal(rr.length, 1);
  assert.equal(
    rr[0].select,
    "race_id, rank1, payout_trio, winning_technique, race_status",
  );
  assert.deepStrictEqual(
    [...rr[0].filters[0][2]].sort(),
    [...venueByRaceId.keys()].sort(),
    "結果は今日のレースだけ取る",
  );
  // 引数: 最少の走数と件数は結果へ効く（キャッシュのキーにも入る）
  assert.deepStrictEqual(await getTodaysVenueRanking(1, 3), want(1, 3));
  assert.equal((await getTodaysVenueRanking(1, 3)).stable.length, 1);
  assert.deepStrictEqual(await getTodaysVenueRanking(5, 2), want(5, 2));
  assert.equal((await getTodaysVenueRanking(5, 2)).stable.length, 3);
  assert.deepStrictEqual(await getTodaysVenueRanking(5, 4), want(5, 4));
  // 今日のレースが無ければ空
  setTables({ races: [], race_results: [] });
  assert.deepStrictEqual(await getTodaysVenueRanking(5, 3), {
    stable: [],
    rough: [],
    nigeRate: [],
    manshu: [],
  });
  assert.equal(
    fake.calls.filter((c) => c.table === "race_results").length,
    0,
    "レースが無ければ結果は読まない",
  );
}
assert.equal(HIGH_PAYOUT_YEN, 10000);

// 2. 移す前の画面の計算（origin/master 47cca3f08 の getTodaysVenueRanking の中身をそのまま写した）
function legacyRanking(results, venueByRaceId, limit, minRaceCount) {
  const byVenue = new Map();
  results.forEach((r) => {
    if (!isUsableRaceResult(r)) return;
    const venueCode = venueByRaceId.get(r.race_id);
    if (venueCode === null || venueCode === undefined) return;
    if (!byVenue.has(venueCode)) {
      byVenue.set(venueCode, {
        venue_code: venueCode,
        raceCount: 0,
        payoutCount: 0,
        payoutSum: 0,
        nigeCount: 0,
        manshuCount: 0,
      });
    }
    const v = byVenue.get(venueCode);
    v.raceCount += 1;
    if (r.payout_trio !== null) {
      v.payoutCount += 1;
      v.payoutSum += r.payout_trio;
      if (r.payout_trio >= 10000) v.manshuCount += 1;
    }
    if (r.rank1 === 1 && r.winning_technique === "逃げ") v.nigeCount += 1;
  });
  const qualifyingVenues = [...byVenue.values()].filter(
    (v) => v.raceCount >= minRaceCount,
  );
  const nigeRateVenues = qualifyingVenues.map((v) => ({
    venue_code: v.venue_code,
    race_count: v.raceCount,
    nige_rate: (v.nigeCount / v.raceCount) * 100,
  }));
  const payoutVenues = qualifyingVenues
    .filter((v) => v.payoutCount > 0)
    .map((v) => ({
      venue_code: v.venue_code,
      race_count: v.raceCount,
      avg_payout: v.payoutSum / v.payoutCount,
      manshu_rate: (v.manshuCount / v.payoutCount) * 100,
    }));
  const byAvgPayoutAsc = [...payoutVenues].sort(
    (a, b) => a.avg_payout - b.avg_payout,
  );
  const byAvgPayoutDesc = [...payoutVenues].sort(
    (a, b) => b.avg_payout - a.avg_payout,
  );
  return {
    stable: byAvgPayoutAsc.slice(0, limit),
    rough: byAvgPayoutDesc.slice(0, limit),
    nigeRate: [...nigeRateVenues]
      .sort((a, b) => b.nige_rate - a.nige_rate)
      .slice(0, limit),
    manshu: [...payoutVenues]
      .sort((a, b) => b.manshu_rate - a.manshu_rate)
      .slice(0, limit),
  };
}

let seed = 1242;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
for (let t = 0; t < 3000; t++) {
  const venueByRaceId = new Map();
  const results = [];
  const n = Math.floor(rand() * 60);
  for (let i = 0; i < n; i++) {
    const id = `2026-11-04-${String(i).padStart(2, "0")}-${t}`;
    const venue = pick([1, 2, 3, 4, 5, null, undefined]);
    if (venue !== undefined) venueByRaceId.set(id, venue);
    results.push({
      race_id: id,
      rank1: pick([1, 1, 2, 3, null]),
      payout_trio: pick([null, 980, 4500, 9990, 10000, 25600, 120000]),
      popularity_trio: pick([null, 1, 2, 15]),
      winning_technique: pick(["逃げ", "差し", "まくり", null]),
      race_status: pick([null, "normal", "no_race", "partial_refund"]),
    });
  }
  const limit = pick([1, 3, 5]);
  const minRaceCount = pick([1, 3, 6]);
  const got = rankVenuesByPayout(
    tallyVenuePayouts(results, (id) => venueByRaceId.get(id)),
    limit,
    minRaceCount,
  );
  assert.deepStrictEqual(
    got,
    legacyRanking(results, venueByRaceId, limit, minRaceCount),
    `乱数の入力 ${t} で画面の旧計算と違う`,
  );
}

// 3. 1番人気・除外
const fixture = [
  {
    race_id: "a",
    rank1: 1,
    payout_trio: 1200,
    popularity_trio: 1,
    winning_technique: "逃げ",
    race_status: null,
  },
  {
    race_id: "b",
    rank1: 2,
    payout_trio: 15000,
    popularity_trio: 40,
    winning_technique: "差し",
    race_status: null,
  },
  {
    race_id: "c",
    rank1: 1,
    payout_trio: 900,
    popularity_trio: null,
    winning_technique: "逃げ",
    race_status: null,
  },
  {
    race_id: "d",
    rank1: 3,
    payout_trio: null,
    popularity_trio: 1,
    winning_technique: "まくり",
    race_status: null,
  },
  {
    race_id: "e",
    rank1: 1,
    payout_trio: 800,
    popularity_trio: 1,
    winning_technique: "逃げ",
    race_status: "no_race",
  },
  {
    race_id: "f",
    rank1: null,
    payout_trio: 800,
    popularity_trio: 1,
    winning_technique: null,
    race_status: null,
  },
];
const v = tallyVenuePayouts(fixture, () => 7).get(7);
assert.deepEqual(v, {
  venue_code: 7,
  raceCount: 4,
  payoutCount: 3,
  payoutSum: 17100,
  nigeCount: 2,
  manshuCount: 1,
  popularityCount: 2,
  favoriteCount: 1,
});
const rates = venuePayoutRates(new Map([[7, v]]), 3);
assert.deepEqual(rates.payoutVenues, [
  {
    venue_code: 7,
    race_count: 4,
    payout_count: 3,
    manshu_count: 1,
    avg_payout: 5700,
    manshu_rate: (1 / 3) * 100,
  },
]);
assert.deepEqual(venuePayoutRates(new Map([[7, v]]), 5), {
  nigeRateVenues: [],
  payoutVenues: [],
});

// 4. 引数（DB を読む前に拒否する。環境変数を渡さないので、通れば DB の接続の誤りで落ちる）
const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const env = { PATH: process.env.PATH };
for (const args of [
  ["--dataset=venue_payout", "--to=2026/11/03"],
  ["--dataset=venue_payout", "--from=2026-11-03", "--to=2026-11-01"],
  ["--dataset=venue_payout", "--venue=1"],
  ["--dataset=venue_payout", "--to=2026-11-01", "--to=2026-11-02"],
  ["--dataset=venue_favorite", "--from=2026-10-01"],
  ["--dataset=venue_favorite", "--to=2026-09-30"],
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
const noKey = spawnSync(process.execPath, [cli, "--dataset=venue_payout"], {
  encoding: "utf8",
  timeout: 10000,
  env,
});
assert.equal(noKey.status, 1);
assert.match(noKey.stderr, /匿名キーが無い/, "鍵が無ければ理由を出して止まる");

console.log(
  "✅ verify-venue-payout-shared: 画面が純関数を使う・旧計算と3,000通り一致・1番人気の数え方・引数の拒否を確認",
);
