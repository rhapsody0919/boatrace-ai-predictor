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
  VENUE,
  breakdownTables,
  entriesOf,
  freshFailed,
  freshOk,
  pretest,
  powerIndexes,
  rows,
  statsAsOf,
} from "./verifyData/race-motor-breakdown.js";
import { EXPECTED_A } from "./verifyData/race-motor-breakdown-expected.js";
import { EXPECTED_B } from "./verifyData/race-motor-breakdown-expected2.js";
import {
  pastMotorRows,
  recalcMotorRows,
  settleMotorBreakdown,
} from "../../src/pure/raceMotorBreakdown.js";

const EXPECTED = { ...EXPECTED_A, ...EXPECTED_B };

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
const todayJst = () =>
  new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

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
