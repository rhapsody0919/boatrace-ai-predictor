#!/usr/bin/env node
/**
 * BOA-1244: 選手ページの会場×枠番の絞り込み（aggregateRacerVenueBoatStats）と龍神ボート番付（rank-data.js の racer_page）が、
 * 同じ純関数（src/utils/racerVenueBoatStats.js）と同じ期間（racerHistoryCutoff）で数えていることを固定する。DB・通信なし。
 *
 *   1. サービス層（supabaseDataService の公開の入口）を偽の supabase クライアントの上で呼ぶ（BOA-1406。本文の正規表現から置き換え）。
 *      getRacerRaceHistory が race_entries を列 "race_id, boat_number"・その選手・racerHistoryCutoff() 以降で取り、
 *      返した履歴を純関数で数えると手で数えた値になる。getRacerBoatReturnRate の回収率は toReturnRate と同じ
 *   1b. 振る舞いへ移せない物は文字で見る（緩めない）: 選手ページの import、rank-data.js の呼び方・asOf の式・期間の絞り
 *   2. racerHistoryCutoff は移す前の式（見た時刻から730日、その環境の時刻で数えて UTC の日付）と同じ
 *   3. 番付は会場の走だけを読む。会場で絞る集計は、全会場の履歴でも会場の走だけの履歴でも同じ値になる（乱数 2,000 通り）
 *   4. rank-data.js が racer_page の引数の誤りを DB の前に拒否する
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

// src/ の .js は vite の書き方（拡張子の無い import・import.meta.env）なので、renderJsx の module hooks で読む。
// その上に、src/services/supabaseClient.js を偽のクライアントを返すだけの物へ差し替える hook を重ねる
// （後に登録した hook が先に呼ばれ、nextResolve で renderJsx の拡張子の補いを通った後の URL を見る）
const FAKE_KEY = "__verifyRacerPageSharedSupabase";
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
 * 偽の supabase クライアント（メモリ上の表）。select・eq・gte・lt・lte・in・order・range と await を扱い、
 * 呼ばれた問い合わせを calls に残す（scripts/lib/fakeSupabaseClient.js は in() が無く、gte の値を残さないので使わない）
 */
function makeFakeSupabase(tables) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const q = { table, select: null, filters: [], orders: [], range: null };
      calls.push(q);
      const run = () => {
        const rows = (tables[table] ?? []).filter((row) =>
          q.filters.every(([op, col, val]) => {
            const v = row[col];
            if (op === "eq") return v === val;
            if (op === "gte") return v >= val;
            if (op === "lt") return v < val;
            if (op === "lte") return v <= val;
            if (op === "in") return val.includes(v);
            throw new Error(`偽のクライアントに無い絞り: ${op}`);
          }),
        );
        const [a, b] = q.range ?? [0, rows.length - 1];
        return Promise.resolve({
          data: rows.slice(a, b + 1).map((r) => ({ ...r })),
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
        gte: filter("gte"),
        lt: filter("lt"),
        lte: filter("lte"),
        in: filter("in"),
        order(col) {
          q.orders.push(col);
          return chain;
        },
        range(a, b) {
          q.range = [a, b];
          return run();
        },
        then(res, rej) {
          return run().then(res, rej);
        },
      };
      return chain;
    },
  };
  return client;
}

/** YYYY-MM-DD を days 日ずらす（UTC の暦で数える） */
function addDays(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const { aggregateRacerVenueBoatStats, racerHistoryCutoff, toReturnRate } =
  await import("../../src/utils/racerVenueBoatStats.js");

// 1. サービス層（公開の入口だけを呼ぶ）
const RACER = 4001;
const today = new Date().toISOString().slice(0, 10);
const cutoffAtStart = racerHistoryCutoff();
const rid = (date, venue, no) =>
  `${date}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const R = {
  old: rid(addDays(cutoffAtStart, -1), 10, 1), // 730日の窓の外
  edge: rid(cutoffAtStart, 10, 2), // 窓の端の日（含む）
  win: rid(addDays(today, -3), 10, 3),
  second: rid(addDays(today, -3), 10, 4),
  fourth: rid(addDays(today, -2), 10, 5),
  otherVenue: rid(addDays(today, -2), 1, 6),
  otherBoat: rid(addDays(today, -1), 10, 7),
  noRace: rid(addDays(today, -1), 10, 8),
};
const ranks = (order) =>
  Object.fromEntries(order.map((boat, i) => [`rank${i + 1}`, boat]));
const result = (raceId, order, extra = {}) => ({
  race_id: raceId,
  ...ranks(order),
  winning_technique: null,
  payout_win: null,
  payout_place_1: null,
  payout_place_2: null,
  race_status: null,
  ...extra,
});
const tables = {
  race_entries: [
    ...Object.entries(R).map(([k, raceId]) => ({
      racer_id: RACER,
      race_id: raceId,
      boat_number: k === "otherBoat" ? 3 : 1,
    })),
    { racer_id: 4002, race_id: R.win, boat_number: 2 }, // 別の選手
  ],
  races: Object.entries(R).map(([k, raceId]) => ({
    race_id: raceId,
    venue_code: k === "otherVenue" ? 1 : 10,
    race_grade: "ippan",
  })),
  race_results: [
    result(R.old, [1, 2, 3, 4, 5, 6], {
      payout_win: 9990,
      payout_place_1: 990,
    }),
    result(R.edge, [2, 1, 3, 4, 5, 6], { payout_place_2: 300 }),
    result(R.win, [1, 2, 3, 4, 5, 6], {
      winning_technique: "逃げ",
      payout_win: 150,
      payout_place_1: 110,
      payout_place_2: 200,
    }),
    result(R.second, [2, 1, 3, 4, 5, 6], { payout_place_2: 240 }),
    result(R.fourth, [2, 3, 4, 1, 5, 6]),
    result(R.otherVenue, [1, 2, 3, 4, 5, 6], {
      payout_win: 500,
      payout_place_1: 120,
    }),
    result(R.otherBoat, [3, 1, 2, 4, 5, 6], {
      payout_win: 700,
      payout_place_1: 130,
    }),
    result(R.noRace, [1, 2, 3, 4, 5, 6], {
      race_status: "no_race",
      payout_win: 8880,
    }),
  ],
};
const fake = makeFakeSupabase(tables);
globalThis[FAKE_KEY] = fake;
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く（メモリのキャッシュは clearCache で消す）
globalThis.localStorage ??= {
  getItem: () => null,
  setItem() {},
  removeItem() {},
  key: () => null,
  length: 0,
};
const service = await import("../../src/services/supabaseDataService.js");
const { supabaseDataService, clearCache } = service;
// 集計の写しをサービス層に戻していない（公開するなら純関数そのもの）
assert.ok(
  !("aggregateRacerVenueBoatStats" in service) ||
    service.aggregateRacerVenueBoatStats === aggregateRacerVenueBoatStats,
  "サービス層に集計の写しが残っていない",
);

clearCache();
fake.calls.length = 0;
const history = await supabaseDataService.getRacerRaceHistory(RACER);
const cutoffAtEnd = racerHistoryCutoff();
const entryQueries = fake.calls.filter((q) => q.table === "race_entries");
assert.equal(entryQueries.length, 1, "race_entries は1回のページ読みで取る");
const [entryQuery] = entryQueries;
assert.equal(entryQuery.select, "race_id, boat_number");
const since = entryQuery.filters.find(([op]) => op === "gte")?.[2];
assert.ok(
  since === cutoffAtStart || since === cutoffAtEnd,
  `期間の始まりは racerHistoryCutoff() と同じ（${cutoffAtStart}）: ${since}`,
);
assert.deepEqual(entryQuery.filters, [
  ["eq", "racer_id", RACER],
  ["gte", "race_id", since],
]);
assert.deepEqual(
  history.map((r) => r.raceId),
  [R.edge, R.win, R.second, R.fourth, R.otherVenue, R.otherBoat].sort(),
  "窓の外・別の選手・不成立の走は返さない",
);
// 番付と同じ呼び方（会場×1号艇、グレード・種別なし）で、手で数えた値になる:
// 会場10の1号艇は edge（2着）・win（1着）・second（2着）・fourth（4着）の4走
const pageStats = aggregateRacerVenueBoatStats(history, 10, 1, null, null);
assert.equal(pageStats.n, 4);
assert.equal(pageStats.win, 1);
assert.equal(pageStats.top2, 3);
assert.equal(pageStats.top3, 3);
assert.equal(pageStats.returnRate, 37.5); // 150 / 400
assert.equal(pageStats.placeReturnRate, 162.5); // (300 + 110 + 240) / 400
assert.deepEqual(pageStats.tech, { 逃げ: 1 });
assert.deepEqual(
  aggregateRacerVenueBoatStats(
    history.filter((r) => r.venueCode === 10),
    10,
    1,
    null,
    null,
  ),
  pageStats,
  "番付のように会場の走だけを数えても同じ値",
);

// 枠番別の回収率（getRacerBoatReturnRate）は toReturnRate で出す。180日の窓には old・edge は入らない
clearCache();
const boatRates = await supabaseDataService.getRacerBoatReturnRate(RACER);
assert.deepEqual(boatRates, [
  {
    boat_number: 1,
    sample_count: 4, // win・second・fourth・otherVenue
    win_return_rate: toReturnRate(150 + 500, 4),
    place_return_rate: toReturnRate(110 + 240 + 120, 4),
  },
  {
    boat_number: 3,
    sample_count: 1,
    win_return_rate: toReturnRate(700, 1),
    place_return_rate: toReturnRate(130, 1),
  },
]);
assert.equal(boatRates[0].win_return_rate, 162.5);
assert.equal(boatRates[0].place_return_rate, 117.5);
delete globalThis[FAKE_KEY];

// 1b. 振る舞いへ移せない物（BOA-1406）。選手ページは部品の描画に supabase・router が要り、純関数を
// import していることは描いた結果からは見分けられないので、import の文字で見る
const page = readFileSync(
  new URL(
    "../../src/components/racer/RacerPerformanceStats.jsx",
    import.meta.url,
  ),
  "utf8",
);
assert.match(
  page,
  /import \{ aggregateRacerVenueBoatStats \} from "\.\.\/\.\.\/utils\/racerVenueBoatStats\.js";/,
);
// rank-data.js は export が無い CLI（DB を読む）なので、呼び方・asOf の式・期間の絞りは文字で見る
const rankData = readFileSync(
  new URL("../sns/rank-data.js", import.meta.url),
  "utf8",
);
assert.match(
  rankData,
  /aggregateRacerVenueBoatStats\(\s*history,\s*venueCode,\s*1,\s*null,\s*null,?\s*\)/,
  "番付はページの会場×1号艇と同じ引数",
);
// 既定（今日）はページと同じ見た時刻、--date の過去の日はその日の終わり。後の走は race_id < 翌日で外す（/code-review #1）
assert.match(
  rankData,
  /const asOf =\s*date && date < jstToday\(\)\s*\?\s*new Date\(`\$\{date\}T23:59:59\+09:00`\)\s*:\s*new Date\(\);/,
);
assert.match(rankData, /const since = racerHistoryCutoff\(asOf\);/);
assert.match(rankData, /\.gte\("race_id", since\)\s*\.lt\("race_id", until\)/);
assert.equal(toReturnRate(1500, 10), 150);
assert.equal(toReturnRate(0, 0), null);

// 2. 730日の切り（移す前の式）
for (const iso of [
  "2026-11-04T00:30:00Z",
  "2026-11-03T23:59:00Z",
  "2026-02-28T12:00:00Z",
  "2028-03-01T03:00:00Z",
]) {
  const now = new Date(iso);
  const legacy = new Date(now.getTime());
  legacy.setDate(legacy.getDate() - 730);
  assert.equal(
    racerHistoryCutoff(now),
    legacy.toISOString().split("T")[0],
    iso,
  );
}

// 3. 会場で絞る集計は、他の会場の走があっても無くても同じ
let seed = 1244;
const rand = () =>
  (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
for (let t = 0; t < 2000; t++) {
  const rows = [];
  const n = Math.floor(rand() * 50);
  for (let i = 0; i < n; i++) {
    const boatNumber = pick([1, 1, 2, 3, 6]);
    const rank1 = pick([1, 2, 3, boatNumber]);
    rows.push({
      raceId: `2026-${String(1 + (i % 9)).padStart(2, "0")}-${String(10 + i).padStart(2, "0")}-0${pick([1, 2, 3])}-${String(1 + (i % 12)).padStart(2, "0")}`,
      venueCode: pick([1, 2, 10, 10]),
      raceGrade: pick(["ippan", "G1"]),
      raceStage: pick([null, "優勝戦"]),
      raceTitle: null,
      boatNumber,
      rank1,
      rank2: pick([2, 4, boatNumber]),
      rank3: pick([3, 5]),
      rank4: 4,
      rank5: 5,
      rank6: 6,
      winningTechnique: pick(["逃げ", "差し", "抜き", null]),
      payoutWin: pick([null, 150, 1200]),
      payoutPlace1: pick([null, 110]),
      payoutPlace2: pick([null, 240]),
      exhibitionTime: pick([null, 6.71]),
      startTiming: pick([null, 0.12, 0.2]),
      isFlying: rand() < 0.05,
      finishMark: pick([null, "1", "F", "転"]),
      entryCourse: pick([null, 1, 2]),
      stRank: pick([null, 1, 4]),
      unranked: rand() < 0.05,
    });
  }
  rows.sort((a, b) => a.raceId.localeCompare(b.raceId));
  const venue = pick([1, 10]);
  const all = aggregateRacerVenueBoatStats(rows, venue, 1, null, null);
  const onlyVenue = aggregateRacerVenueBoatStats(
    rows.filter((r) => r.venueCode === venue),
    venue,
    1,
    null,
    null,
  );
  assert.deepStrictEqual(onlyVenue, all, `乱数の入力 ${t}`);
}

// 4. 引数
const cli = fileURLToPath(new URL("../sns/rank-data.js", import.meta.url));
const env = { PATH: process.env.PATH };
for (const args of [
  ["--dataset=racer_page"],
  ["--dataset=racer_page", "--venue=0"],
  ["--dataset=racer_page", "--venue=10", "--date=2026/11/04"],
  ["--dataset=racer_page", "--venue=10", "--to=2026-11-04"],
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
  "✅ verify-racer-page-shared: 選手ページと番付が同じ純関数・同じ730日の切り・会場の走だけでも同じ値（2,000通り）・引数の拒否を確認",
);
