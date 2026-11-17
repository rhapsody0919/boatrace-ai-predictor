/**
 * verify-race-motor-breakdown.js — モータ情報タブの一覧表の行の組み立ての回帰テスト。
 *
 * 対象は `src/pure/raceMotorBreakdown.js` の pastMotorRows・recalcMotorRows・settleMotorBreakdown。
 * `getRaceMotorBreakdown`（`src/services/motorQueries3.js`）の中の整形を手を加えずに
 * 移したもの（開発効率の計画 段3 の3件目）。期待値は移す前の実装（git の 3852fff2f 時点の
 * 同じ式）に同じ入力を通した出力で、誤りも含めて写している（plan.md 3+2 の A）。
 * 実 Supabase へは接続しない（tier=ci）。
 */
import assert from "node:assert/strict";
import {
  createFakeSupabase,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  pastMotorRows,
  recalcMotorRows,
  settleMotorBreakdown,
} from "../../src/pure/raceMotorBreakdown.js";

const rows = [
  {
    boat_number: 1,
    player_name: "A",
    racer_id: 1001,
    motor_number: 11,
    motor_2rate: 40.5,
    motor_3rate: 60.1,
  },
  {
    boat_number: 2,
    player_name: "B",
    racer_id: 1002,
    motor_number: 12,
    motor_2rate: 0,
    motor_3rate: 0,
  },
  {
    boat_number: 3,
    player_name: "C",
    racer_id: 1003,
    motor_number: 13,
    motor_2rate: null,
    motor_3rate: null,
  },
  {
    boat_number: 4,
    player_name: "D",
    racer_id: 1004,
    motor_number: 14,
    motor_2rate: 33,
    motor_3rate: 50,
  },
];
// 艇3は取得失敗（fetchFailed）、艇4は結果なし（undefined）
const statsAsOf = [
  { finalCount: 3, championshipCount: 1, firstPlaceCount: 5, raceCount: 40 },
  {
    finalCount: 0,
    championshipCount: 0,
    firstPlaceCount: 0,
    raceCount: 0,
    fetchFailed: false,
  },
  { fetchFailed: true },
  undefined,
];
const pretest = new Map([
  [1001, { pretest_time: 6.75, pretest_rank: 2 }],
  [1003, { pretest_time: null, pretest_rank: null }],
]);
const powerIndexes = [
  {
    sample_count: 30,
    actual_rate2: 45.2,
    actual_rate3: 62.0,
    power_index: 3.1,
    clipped_by_generation: true,
  },
  {
    sample_count: 0,
    actual_rate2: null,
    actual_rate3: null,
    power_index: null,
  },
  null,
  {
    sample_count: 12,
    actual_rate2: 0,
    actual_rate3: 0,
    power_index: -1.5,
    clipped_by_generation: false,
  },
];
const freshOk = {
  columns: rows.map((_, i) => ({
    generation_runs: i,
    generation_rate2: null,
    generation_rate3: null,
    generation_power_index: null,
    prior_meet_runs: i === 0 ? 20 : null,
  })),
  freshness: { generationStart: "2026-08-06", firstMeet: false },
  failed: false,
};
const freshFailed = { ...freshOk, failed: true };

// 移す前の出力（JSON 化できる値だけ。キーの順は旧の実装のとおり）
const EXPECTED = {
  past: [
    {
      boat_number: 1,
      player_name: "A",
      racer_id: 1001,
      motor_number: 11,
      motor_2rate: 40.5,
      motor_3rate: 60.1,
      rate_source: "official",
      official_2rate: 40.5,
      official_3rate: 60.1,
      pretest_time: 6.75,
      pretest_rank: 2,
      power_index: null,
      clipped_by_generation: false,
      final_count: 3,
      championship_count: 1,
      first_place_count: 5,
      race_count: 40,
      venue_stats_failed: false,
    },
    {
      boat_number: 2,
      player_name: "B",
      racer_id: 1002,
      motor_number: 12,
      motor_2rate: 0,
      motor_3rate: 0,
      rate_source: "official",
      official_2rate: 0,
      official_3rate: 0,
      pretest_time: null,
      pretest_rank: null,
      power_index: null,
      clipped_by_generation: false,
      final_count: 0,
      championship_count: 0,
      first_place_count: 0,
      race_count: 0,
      venue_stats_failed: false,
    },
    {
      boat_number: 3,
      player_name: "C",
      racer_id: 1003,
      motor_number: 13,
      motor_2rate: null,
      motor_3rate: null,
      rate_source: "official",
      official_2rate: null,
      official_3rate: null,
      pretest_time: null,
      pretest_rank: null,
      power_index: null,
      clipped_by_generation: false,
      final_count: null,
      championship_count: null,
      first_place_count: null,
      race_count: null,
      venue_stats_failed: true,
    },
    {
      boat_number: 4,
      player_name: "D",
      racer_id: 1004,
      motor_number: 14,
      motor_2rate: 33,
      motor_3rate: 50,
      rate_source: "official",
      official_2rate: 33,
      official_3rate: 50,
      pretest_time: null,
      pretest_rank: null,
      power_index: null,
      clipped_by_generation: false,
      final_count: null,
      championship_count: null,
      first_place_count: null,
      race_count: null,
      venue_stats_failed: false,
    },
  ],
  recalc: [
    {
      boat_number: 1,
      player_name: "A",
      racer_id: 1001,
      motor_number: 11,
      motor_2rate: 45.2,
      motor_3rate: 62,
      rate_source: "recalc",
      sample_count: 30,
      official_3rate: 60.1,
      clipped_by_generation: true,
      official_2rate: 40.5,
      pretest_time: 6.75,
      pretest_rank: 2,
      power_index: 3.1,
      final_count: 3,
      championship_count: 1,
      first_place_count: 5,
      race_count: 40,
      venue_stats_failed: false,
    },
    {
      boat_number: 2,
      player_name: "B",
      racer_id: 1002,
      motor_number: 12,
      motor_2rate: 0,
      motor_3rate: 0,
      rate_source: "recalc",
      sample_count: 0,
      official_3rate: 0,
      clipped_by_generation: false,
      official_2rate: 0,
      pretest_time: null,
      pretest_rank: null,
      power_index: null,
      final_count: 0,
      championship_count: 0,
      first_place_count: 0,
      race_count: 0,
      venue_stats_failed: false,
    },
    {
      boat_number: 3,
      player_name: "C",
      racer_id: 1003,
      motor_number: 13,
      motor_2rate: null,
      motor_3rate: null,
      rate_source: "recalc",
      sample_count: null,
      official_3rate: null,
      clipped_by_generation: false,
      official_2rate: null,
      pretest_time: null,
      pretest_rank: null,
      power_index: null,
      final_count: null,
      championship_count: null,
      first_place_count: null,
      race_count: null,
      venue_stats_failed: true,
    },
    {
      boat_number: 4,
      player_name: "D",
      racer_id: 1004,
      motor_number: 14,
      motor_2rate: 0,
      motor_3rate: 0,
      rate_source: "recalc",
      sample_count: 12,
      official_3rate: 50,
      clipped_by_generation: false,
      official_2rate: 33,
      pretest_time: null,
      pretest_rank: null,
      power_index: -1.5,
      final_count: null,
      championship_count: null,
      first_place_count: null,
      race_count: null,
      venue_stats_failed: false,
    },
  ],
  settleStatsFailed: {
    rows: [
      {
        boat_number: 1,
        player_name: "A",
        racer_id: 1001,
        motor_number: 11,
        motor_2rate: 40.5,
        motor_3rate: 60.1,
        rate_source: "official",
        official_2rate: 40.5,
        official_3rate: 60.1,
        pretest_time: 6.75,
        pretest_rank: 2,
        power_index: null,
        clipped_by_generation: false,
        final_count: 3,
        championship_count: 1,
        first_place_count: 5,
        race_count: 40,
        venue_stats_failed: false,
        generation_runs: 0,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: 20,
      },
      {
        boat_number: 2,
        player_name: "B",
        racer_id: 1002,
        motor_number: 12,
        motor_2rate: 0,
        motor_3rate: 0,
        rate_source: "official",
        official_2rate: 0,
        official_3rate: 0,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: 0,
        championship_count: 0,
        first_place_count: 0,
        race_count: 0,
        venue_stats_failed: false,
        generation_runs: 1,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 3,
        player_name: "C",
        racer_id: 1003,
        motor_number: 13,
        motor_2rate: null,
        motor_3rate: null,
        rate_source: "official",
        official_2rate: null,
        official_3rate: null,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: true,
        generation_runs: 2,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 4,
        player_name: "D",
        racer_id: 1004,
        motor_number: 14,
        motor_2rate: 33,
        motor_3rate: 50,
        rate_source: "official",
        official_2rate: 33,
        official_3rate: 50,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: false,
        generation_runs: 3,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
    ],
    freshness: { generationStart: "2026-08-06", firstMeet: false },
    fetchFailed: true,
  },
  settleOk: {
    rows: [
      {
        boat_number: 1,
        player_name: "A",
        racer_id: 1001,
        motor_number: 11,
        motor_2rate: 40.5,
        motor_3rate: 60.1,
        rate_source: "official",
        official_2rate: 40.5,
        official_3rate: 60.1,
        pretest_time: 6.75,
        pretest_rank: 2,
        power_index: null,
        clipped_by_generation: false,
        final_count: 3,
        championship_count: 1,
        first_place_count: 5,
        race_count: 40,
        venue_stats_failed: false,
        generation_runs: 0,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: 20,
      },
      {
        boat_number: 2,
        player_name: "B",
        racer_id: 1002,
        motor_number: 12,
        motor_2rate: 0,
        motor_3rate: 0,
        rate_source: "official",
        official_2rate: 0,
        official_3rate: 0,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: 0,
        championship_count: 0,
        first_place_count: 0,
        race_count: 0,
        venue_stats_failed: false,
        generation_runs: 1,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 3,
        player_name: "C",
        racer_id: 1003,
        motor_number: 13,
        motor_2rate: null,
        motor_3rate: null,
        rate_source: "official",
        official_2rate: null,
        official_3rate: null,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: false,
        generation_runs: 2,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 4,
        player_name: "D",
        racer_id: 1004,
        motor_number: 14,
        motor_2rate: 33,
        motor_3rate: 50,
        rate_source: "official",
        official_2rate: 33,
        official_3rate: 50,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: false,
        generation_runs: 3,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
    ],
    freshness: { generationStart: "2026-08-06", firstMeet: false },
  },
  settleFreshFailed: {
    rows: [
      {
        boat_number: 1,
        player_name: "A",
        racer_id: 1001,
        motor_number: 11,
        motor_2rate: 40.5,
        motor_3rate: 60.1,
        rate_source: "official",
        official_2rate: 40.5,
        official_3rate: 60.1,
        pretest_time: 6.75,
        pretest_rank: 2,
        power_index: null,
        clipped_by_generation: false,
        final_count: 3,
        championship_count: 1,
        first_place_count: 5,
        race_count: 40,
        venue_stats_failed: false,
        generation_runs: 0,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: 20,
      },
      {
        boat_number: 2,
        player_name: "B",
        racer_id: 1002,
        motor_number: 12,
        motor_2rate: 0,
        motor_3rate: 0,
        rate_source: "official",
        official_2rate: 0,
        official_3rate: 0,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: 0,
        championship_count: 0,
        first_place_count: 0,
        race_count: 0,
        venue_stats_failed: false,
        generation_runs: 1,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 3,
        player_name: "C",
        racer_id: 1003,
        motor_number: 13,
        motor_2rate: null,
        motor_3rate: null,
        rate_source: "official",
        official_2rate: null,
        official_3rate: null,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: false,
        generation_runs: 2,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
      {
        boat_number: 4,
        player_name: "D",
        racer_id: 1004,
        motor_number: 14,
        motor_2rate: 33,
        motor_3rate: 50,
        rate_source: "official",
        official_2rate: 33,
        official_3rate: 50,
        pretest_time: null,
        pretest_rank: null,
        power_index: null,
        clipped_by_generation: false,
        final_count: null,
        championship_count: null,
        first_place_count: null,
        race_count: null,
        venue_stats_failed: false,
        generation_runs: 3,
        generation_rate2: null,
        generation_rate3: null,
        generation_power_index: null,
        prior_meet_runs: null,
      },
    ],
    freshness: { generationStart: "2026-08-06", firstMeet: false },
    fetchFailed: true,
  },
};

let count = 0;
const check = (name, fn) => {
  fn();
  count += 1;
  console.log(`  ok ${name}`);
};
// キーの順も含めて一字一句同じこと
const same = (actual, expected) =>
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));

check("A1 過去レース: 公式値の行（取得失敗・結果なし・前検なしを含む）", () => {
  same(pastMotorRows(rows, statsAsOf, pretest), EXPECTED.past);
});
check(
  "A2 当日以降: 期間の値に差し替えた行（指数なし・0 の差し替えを含む）",
  () => {
    same(
      recalcMotorRows(rows, powerIndexes, statsAsOf, pretest),
      EXPECTED.recalc,
    );
  },
);
check("A3 会場公式の成績の取得失敗は fetchFailed を付ける", () => {
  same(
    settleMotorBreakdown(pastMotorRows(rows, statsAsOf, pretest), freshOk),
    EXPECTED.settleStatsFailed,
  );
});
check("A4 失敗が無ければ fetchFailed を付けない", () => {
  const out = pastMotorRows(rows, statsAsOf, pretest).map((r) => ({
    ...r,
    venue_stats_failed: false,
  }));
  same(settleMotorBreakdown(out, freshOk), EXPECTED.settleOk);
});
check(
  "A5 自前の値の材料の取得失敗（fresh.failed）も fetchFailed を付ける",
  () => {
    const out = pastMotorRows(rows, statsAsOf, pretest).map((r) => ({
      ...r,
      venue_stats_failed: false,
    }));
    same(settleMotorBreakdown(out, freshFailed), EXPECTED.settleFreshFailed);
  },
);
check("A6 入力を書き換えない", () => {
  const before = JSON.stringify(rows);
  pastMotorRows(rows, statsAsOf, pretest);
  recalcMotorRows(rows, powerIndexes, statsAsOf, pretest);
  assert.equal(JSON.stringify(rows), before);
});

// サービスが pure の関数を呼ぶこと（整形がサービスに戻っていないこと）
// ---- サービス層を偽の supabase クライアントの上で呼ぶ（BOA-1675。共通の部品 verifyData/fakeServiceSupabase.js） ----
registerFakeServiceSupabase();
// サービス層のキャッシュは localStorage にも書く。Node には無いので、メモリの Map で代える（setTables で空にする）
const localStore = new Map();
globalThis.localStorage = {
  getItem: (k) => localStore.get(k) ?? null,
  setItem: (k, v) => void localStore.set(k, String(v)),
  removeItem: (k) => void localStore.delete(k),
  key: (i) => [...localStore.keys()][i] ?? null,
  get length() {
    return localStore.size;
  },
};

// サービス: getRaceMotorBreakdown が、pure の3関数（pastMotorRows・recalcMotorRows・settleMotorBreakdown）に
// 取得した材料を通した行を返す。期待値は pure の関数に同じ材料（サービスの公開の関数で取った物）を通して作る
const fakeTables = {};
const failTables = new Map();
const fake = setFakeSupabase(createFakeSupabase(fakeTables, { failTables }));
const { clearCache } = await import("../../src/services/core.js");
const { getRaceMotorFreshness, getMotorPowerIndex, fetchPretestByRacer } =
  await import("../../src/services/motorQueries2.js");
const { getRaceMotorBreakdown, getVenueMotorStats } =
  await import("../../src/services/motorQueries3.js");
const setTables = (next) => {
  for (const k of Object.keys(fakeTables)) delete fakeTables[k];
  Object.assign(fakeTables, next);
  failTables.clear();
  localStore.clear();
  clearCache();
  fake.calls.length = 0;
};
const addDays = (ymd, n) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const todayJst = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const VENUE = 3;
const mkRace = (id) => ({
  race_id: id,
  race_date: id.slice(0, 10),
  venue_code: Number(id.slice(11, 13)),
});
const resultRow = (race_id, rank1, rank2, rank3) => ({
  race_id,
  rank1,
  rank2,
  rank3,
});
const statsRow = (motor_number, scraped_date, final_count) => ({
  venue_code: VENUE,
  motor_number,
  scraped_date,
  meet_count: 5,
  race_count: 40,
  final_count,
  championship_count: 1,
  first_place_count: 6,
});

const entriesOf = (raceId) => [
  {
    race_id: raceId,
    boat_number: 1,
    player_name: "A",
    racer_id: 1001,
    motor_number: 11,
    motor_2rate: 0,
    motor_3rate: 0,
    global_2rate: 20,
  },
  {
    race_id: raceId,
    boat_number: 2,
    player_name: "B",
    racer_id: 1002,
    motor_number: 12,
    motor_2rate: 40,
    motor_3rate: 60,
    global_2rate: 20,
  },
  {
    race_id: raceId,
    boat_number: 3,
    player_name: "C",
    racer_id: 1003,
    motor_number: 13,
    motor_2rate: 33,
    motor_3rate: 50,
    global_2rate: 20,
  },
];
const breakdownTables = (raceId, { generationStart }) => {
  const today = raceId.slice(0, 10);
  const far = addDays(today, -45); // 90日の中・30日の外
  const near = addDays(today, -3);
  const earlier = [`${far}-03-01`, `${near}-03-02`];
  return {
    venue_motor_start_dates: [
      { venue_code: VENUE, start_date: generationStart },
    ],
    races: [...earlier, raceId].map(mkRace),
    race_entries: [
      ...entriesOf(raceId),
      {
        race_id: earlier[0],
        boat_number: 1,
        global_2rate: 20,
        motor_number: 12,
        motor_2rate: 40,
      },
      {
        race_id: earlier[1],
        boat_number: 2,
        global_2rate: 20,
        motor_number: 12,
        motor_2rate: 40,
      },
    ],
    race_results: [
      resultRow(earlier[0], 3, 4, 5),
      resultRow(earlier[1], 2, 1, 4),
    ],
    race_conditions: [
      { race_id: `${today}-03-01`, series_day: 1, is_final_day: false },
    ],
    // 公式サイトの成績の取得履歴（レース日以前で最新を使う）
    venue_motor_stats: [
      statsRow(12, addDays(today, -2), 3),
      statsRow(12, addDays(today, -9), 1),
      statsRow(12, addDays(today, 1), 9),
    ],
    motor_pretest_stats: [
      {
        venue_code: VENUE,
        racer_id: 1002,
        race_date: addDays(today, -2),
        pretest_time: 6.75,
        pretest_rank: 2,
      },
      {
        venue_code: 4,
        racer_id: 1001,
        race_date: addDays(today, -2),
        pretest_time: 6.9,
        pretest_rank: 1,
      },
    ],
  };
};

// 過去レース: 公式値の行（pastMotorRows）に、前検・公式サイトの成績（レース日以前で最新）と自前の値を足して settle する
{
  const raceId = "2026-10-20-03-07";
  const raceDate = raceId.slice(0, 10);
  setTables(breakdownTables(raceId, { generationStart: "2026-10-06" }));
  const rows = entriesOf(raceId);
  const got = await getRaceMotorBreakdown(raceId, VENUE, 90);
  clearCache();
  const statsAsOf = await Promise.all(
    rows.map((r) => getVenueMotorStats(VENUE, r.motor_number, raceDate)),
  );
  const pretestAsOf = await fetchPretestByRacer(VENUE, raceDate);
  const fresh = await getRaceMotorFreshness(raceId, VENUE, rows);
  same(
    got,
    settleMotorBreakdown(pastMotorRows(rows, statsAsOf, pretestAsOf), fresh),
    "過去レースの一覧",
  );
  // 材料が実際に流れている（期待値が空振りしていない）
  assert.equal(got.rows[1].rate_source, "official");
  assert.equal(
    got.rows[1].final_count,
    3,
    "レース日以前で最新の公式サイトの成績（翌日の行は使わない）",
  );
  assert.equal(got.rows[1].pretest_time, 6.75, "前検は会場で絞る");
  assert.equal(got.rows[0].pretest_time, null);
  assert.equal(
    got.rows[1].generation_runs,
    1,
    "使用開始日（10/06）より前の走は数えない",
  );
  assert.equal(got.rows[2].final_count, null, "成績の行が無い艇");
}
// 材料の取得失敗は fetchFailed（保存させない）: 公式サイトの成績・自前の値の材料（節の初日）のどちらでも
for (const table of ["venue_motor_stats", "race_conditions"]) {
  const raceId = "2026-10-20-03-07";
  setTables(breakdownTables(raceId, { generationStart: "2026-10-06" }));
  failTables.set(table, {});
  const origError = console.error;
  console.error = () => {};
  const got = await getRaceMotorBreakdown(raceId, VENUE, 90).finally(() => {
    console.error = origError;
  });
  assert.equal(got.fetchFailed, true, `${table} の失敗は fetchFailed`);
  assert.deepStrictEqual(
    [...localStore.keys()].filter((k) =>
      k.startsWith("boatai:race-motor-breakdown-"),
    ),
    [],
    `${table} の失敗は保存しない`,
  );
}
// 当日以降のレース: 期間（days）の値に差し替えた行（recalcMotorRows）。days は機力指数の期間へ渡る
{
  const raceId = `${todayJst()}-03-07`;
  const raceDate = raceId.slice(0, 10);
  const rows = entriesOf(raceId);
  const expectedFor = async (days) => {
    clearCache();
    const powerIndexes = await Promise.all(
      rows.map((r) => getMotorPowerIndex(VENUE, r.motor_number, days, raceId)),
    );
    const statsList = await Promise.all(
      rows.map((r) => getVenueMotorStats(VENUE, r.motor_number)),
    );
    const pretestByRacer = await fetchPretestByRacer(VENUE, raceDate);
    const fresh = await getRaceMotorFreshness(raceId, VENUE, rows);
    return settleMotorBreakdown(
      recalcMotorRows(rows, powerIndexes, statsList, pretestByRacer),
      fresh,
    );
  };
  setTables(breakdownTables(raceId, { generationStart: "2026-01-01" }));
  const got30 = await getRaceMotorBreakdown(raceId, VENUE, 30);
  const want30 = await expectedFor(30);
  same(got30, want30, "当日の一覧（30日）");
  setTables(breakdownTables(raceId, { generationStart: "2026-01-01" }));
  const got90 = await getRaceMotorBreakdown(raceId, VENUE, 90);
  const want90 = await expectedFor(90);
  same(got90, want90, "当日の一覧（90日）");
  assert.notEqual(
    JSON.stringify(want30),
    JSON.stringify(want90),
    "30日と90日で値が違う入力になっている",
  );
  assert.equal(got90.rows[1].rate_source, "recalc");
  assert.equal(got90.rows[1].power_index !== null, true);
}
// 会場が分からなければ出走表の行だけ（材料を足さない）。C1（pure の3関数を通した行）は上の各場面の same で見る
{
  const raceId = "2026-10-20-03-07";
  setTables(breakdownTables(raceId, { generationStart: "2026-10-06" }));
  same(await getRaceMotorBreakdown(raceId, null, 90), {
    rows: entriesOf(raceId),
  });
}

console.log(`✅ raceMotorBreakdown: ${count} 件の例を確認`);
