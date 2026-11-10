#!/usr/bin/env node
/**
 * BOA-1242: 分析の「会場ランキング」（getTodaysVenueRanking）と龍神ボート番付（rank-data.js の venue_payout・
 * venue_favorite）が、同じ純関数（src/utils/venuePayoutStats.js）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層が純関数を import して呼び、集計の写しを持たない（二重の実装に戻らない）
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
import { readDataLayerSource } from "./dataLayerSource.js";

// 1. サービス層
const service = readDataLayerSource();
const body = service.slice(
  service.indexOf("getTodaysVenueRanking("),
  service.indexOf("getVenueDaySummary("),
);
assert.match(
  service,
  /import \{\s*tallyVenuePayouts,\s*rankVenuesByPayout,\s*\} from "\.\.\/utils\/venuePayoutStats\.js";/,
);
assert.match(
  body,
  /tallyVenuePayouts\(results,/,
  "getTodaysVenueRanking が tallyVenuePayouts を呼ぶ",
);
assert.match(
  body,
  /return rankVenuesByPayout\(byVenue, limit, minRaceCount\);/,
);
assert.doesNotMatch(
  body,
  /manshuCount \+= 1|payoutSum \+=/,
  "getTodaysVenueRanking に集計の写しが残っていない",
);
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
