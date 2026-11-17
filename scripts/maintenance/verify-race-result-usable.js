#!/usr/bin/env node
/**
 * BOA-1021: 集計対象・不成立の判定（src/utils/raceResultUsable.js）と、サービスがそれを使って結果を除くことを固定する。DB・通信なし。
 *
 *   1. 判定そのもの（isUsableRaceResult・isNoRaceResult）を5入力で見る
 *   2. サービス層（領域の Queries の公開の入口）を偽の supabase クライアントの上で呼び、判定が集計に効いていることを見る
 *      （本文の正規表現・import の字から置き換え、RA42。判定を自前で持つ・使わない実装は、返す値が変わって落ちる）
 *      - isUsableRaceResult: getRacerVenueStats・getVenueDaySummary（不成立・1着なしを数えず、返還・状態なしは数える）
 *      - isNoRaceResult: getRacerBoatReturnRate（不成立だけを外し、1着なしの行は数える）
 *      motorQueries2・motorQueries5・raceQueries3 の使い所は、偽に載せる表が大きく、この verify では呼ばない
 */
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  isUsableRaceResult,
  isNoRaceResult,
} from "../../src/utils/raceResultUsable.js";

// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
const FAKE_KEY = "__verifyRaceResultUsableSupabase";
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

/** 偽の supabase クライアント（メモリ上の表）。select・eq・gte・lt・lte・in・order・range と await を扱う */
function makeFakeSupabase(tables) {
  return {
    from(table) {
      const filters = [];
      let rangeArgs = null;
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        const [a, b] = rangeArgs ?? [0, rows.length - 1];
        return Promise.resolve({
          data: rows.slice(a, b + 1).map((r) => ({ ...r })),
          error: null,
        });
      };
      const filter = (op) => (col, val) => {
        filters.push([op, col, val]);
        return chain;
      };
      const chain = {
        select: () => chain,
        eq: filter("eq"),
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        in: filter("in"),
        order: () => chain,
        range(a, b) {
          rangeArgs = [a, b];
          return run();
        },
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      return chain;
    },
  };
}

// 1. 判定そのもの
const cases = [
  [null, false, false],
  [{ race_status: "no_race", rank1: 1 }, false, true],
  [{ race_status: "partial_refund", rank1: 2 }, true, false],
  [{ race_status: null, rank1: 3 }, true, false],
  [{ race_status: null, rank1: null }, false, false],
];
for (const [result, usable, noRace] of cases) {
  const label = JSON.stringify(result);
  assert.equal(isUsableRaceResult(result), usable, `usable: ${label}`);
  assert.equal(isNoRaceResult(result), noRace, `noRace: ${label}`);
}

// 2. サービス層
const addDays = (days) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const rid = (date, venue, no) =>
  `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const ranks = (order) =>
  Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((i) => [`rank${i}`, order?.[i - 1] ?? null]),
  );
const result = (raceId, order, extra = {}) => ({
  race_id: raceId,
  ...ranks(order),
  race_status: null,
  winning_technique: null,
  payout_win: null,
  payout_place_1: null,
  payout_place_2: null,
  payout_trio: null,
  ...extra,
});
const ALL = [1, 2, 3, 4, 5, 6];

const RACER = 4101;
const RACER_VENUE = 5;
const RACER_DAY = addDays(-3);
const rr = (no) => rid(RACER_DAY, RACER_VENUE, no);
// 会場 5 の1号艇の7走（結果は no 1〜7）。数える5走: 1着・2着・返還（3着の艇番が rank1=3、1号艇は3着）・状態なしの1着・1着
// 数えない2走: 不成立（1着が1号艇でも外す）・1着なし（rank1 が null）
const racerResults = [
  result(rr(1), [1, 2, 3, 4, 5, 6], { payout_win: 150, payout_place_1: 110 }),
  result(rr(2), [2, 1, 3, 4, 5, 6], { payout_place_2: 200 }),
  result(rr(3), [3, 2, 1, 4, 5, 6], { race_status: "partial_refund" }),
  result(rr(4), [1, 2, 3, 4, 5, 6]),
  result(rr(5), ALL, { race_status: "no_race", payout_win: 9000 }),
  result(rr(6), null),
  result(rr(7), [1, 2, 3, 4, 5, 6]),
];
const R_DAY = addDays(-1);
const VENUE_DAY_VENUE = 7;
const dr = (no) => rid(R_DAY, VENUE_DAY_VENUE, no);
const dayResults = [
  result(dr(1), [1, 2, 3, 4, 5, 6], {
    winning_technique: "逃げ",
    payout_trio: 12000,
  }),
  result(dr(2), [2, 1, 3, 4, 5, 6], {
    race_status: "partial_refund",
    payout_trio: 3000,
  }),
  result(dr(3), [3, 1, 2, 4, 5, 6], { payout_trio: 500 }),
  result(dr(4), ALL, { race_status: "no_race", payout_trio: 99999 }),
  result(dr(5), null, { payout_trio: 88888 }),
];
const tables = {
  race_entries: racerResults.map((r) => ({
    racer_id: RACER,
    race_id: r.race_id,
    boat_number: 1,
  })),
  races: [
    ...racerResults.map((r) => ({
      race_id: r.race_id,
      venue_code: RACER_VENUE,
      race_date: RACER_DAY,
    })),
    ...dayResults.map((r) => ({
      race_id: r.race_id,
      venue_code: VENUE_DAY_VENUE,
      race_date: R_DAY,
    })),
  ],
  race_results: [...racerResults, ...dayResults],
};
globalThis[FAKE_KEY] = makeFakeSupabase(tables);
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};
const { clearCache } = await import("../../src/services/core.js");
const { getRacerVenueStats } =
  await import("../../src/services/racerQueries2.js");
const { getRacerBoatReturnRate } =
  await import("../../src/services/racerQueries3.js");
const { getVenueDaySummary } =
  await import("../../src/services/venueQueries2.js");
const { toReturnRate } = await import("../../src/utils/racerVenueBoatStats.js");

// isUsableRaceResult: 不成立・1着なしは出走に数えず、返還・状態なしは数える（5走の勝ち 3・2連 4・3連 5）
clearCache();
assert.deepEqual(await getRacerVenueStats(RACER), [
  {
    venue_code: RACER_VENUE,
    total_races: 5,
    win_rate: 3 / 5,
    top2_rate: 4 / 5,
    top3_rate: 5 / 5,
  },
]);

// isUsableRaceResult: 1日のまとめ。使える3レース（1着なし・不成立の配当 88888・99999 は入らない）
clearCache();
const day = await getVenueDaySummary(VENUE_DAY_VENUE, R_DAY);
assert.equal(day.raceCount, 3, "不成立・1着なしは raceCount に数えない");
assert.equal(day.payoutCount, 3);
assert.equal(day.avgPayout, (12000 + 3000 + 500) / 3);
assert.deepEqual(Object.keys(day.byRace), [dr(1), dr(2), dr(3)]);
assert.equal(day.nigeRate, (1 / 3) * 100);

// isNoRaceResult: 不成立だけを外す。返還も 1着なしの行も回収率の母数に数える（1着の払戻 150・複勝 110+200）
clearCache();
assert.deepEqual(await getRacerBoatReturnRate(RACER), [
  {
    boat_number: 1,
    sample_count: 6,
    win_return_rate: toReturnRate(150, 6),
    place_return_rate: toReturnRate(110 + 200, 6),
  },
]);
console.log("✅ raceResultUsable: 5入力・サービス3関数の振る舞いを確認");
