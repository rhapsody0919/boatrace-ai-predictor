// 「イン屋」の札の、前付けの走の件数の RPC（マイグレーション 203、get_racer_front_taking_counts）と、
// 呼び手 getRaceFrontTakingByRacer（src/services/racerQueries6.js）の再現テスト。
// PGlite に本番と同じ型の縮約の6表を作り、203 を当てて確かめる（verifyData/racer-scoped-race-rpc.js）。
//   - RPC の数えた件数（母数・前付けの走）が、今までの数え方（6表の読みの行 → src/utils/frontTaking.js の
//     summarizeFrontTaking）と同じ。表示中のレースの前後・730日の窓・不成立・結果なし・実進入コースなし・1号艇を除く
//   - RPC が有れば出走の選手ぜんぶで要求1本・6表を読まない。判定（下限 20走・30%）は今までの読みと同じ
//   - 件数の RPC が無いときは選手ごとの走から数える（走の RPC → それも無ければ6表）。ほかの失敗は例外のまま
// 関数の性質（STABLE・権限）は verify-racer-scoped-race-rpc.js。外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTS_RPC,
  EMPTY,
  INYA,
  MANY,
  OTHER,
  RACER,
  RPC,
  setupRacerScopedRpc,
} from "./verifyData/racer-scoped-race-rpc.js";

const { racerHistoryCutoff } =
  await import("../../src/utils/racerVenueBoatStats.js");
const { summarizeFrontTaking } = await import("../../src/utils/frontTaking.js");

let env;
before(async () => {
  env = await setupRacerScopedRpc();
});

// 今までの道の行（6表の読み）
const rowsOf = async (racerId) =>
  (await env.call({}, () => env.getRacerScopedRaceStats(racerId))).value;
const countsOf = (racerId, before, since = racerHistoryCutoff()) =>
  env.callCounts({
    p_racer_ids: [racerId],
    p_since: since,
    p_before_race_id: before,
  });
const frontTakingVia = async (rpcs, racerIds, beforeRaceId) => {
  const { value, fake } = await env.call(rpcs, () =>
    env.getRaceFrontTakingByRacer(racerIds, beforeRaceId),
  );
  return { byRacer: value, fake };
};

test("RPC の数えた件数が、6表の読みの行を summarizeFrontTaking で数えた値と同じ", async () => {
  let compared = 0;
  for (const racer of [RACER, OTHER, MANY, INYA]) {
    const rows = await rowsOf(racer);
    const ids = rows.map((r) => r.raceId);
    // 全部より前・途中の走の race_id ちょうど（その走は入らない）・途中の走のすぐ後・全部より後
    const befores = [
      "0000",
      ids[Math.floor(ids.length / 3)],
      `${ids[Math.floor(ids.length / 2)]}x`,
      "9999",
    ];
    for (const before of befores) {
      const expected = summarizeFrontTaking(rows, { beforeRaceId: before });
      // 数える走が無ければ行を返さない
      assert.deepEqual(
        await countsOf(racer, before),
        expected.runs === 0
          ? []
          : [{ racer_id: racer, runs: expected.runs, taken: expected.taken }],
        `選手 ${racer}・${before} より前`,
      );
      compared += 1;
    }
  }
  assert.equal(compared, 16);
});

test("比べた値が 0 ばかりでない: 前付けあり・なしが混ざる選手、全部が前付けの選手、枠なりの選手", async () => {
  const [mixed] = await countsOf(RACER, "9999");
  assert.ok(mixed.runs >= 40 && mixed.taken > 0 && mixed.taken < mixed.runs);
  assert.deepEqual(await countsOf(INYA, "9999"), [
    { racer_id: INYA, runs: 30, taken: 30 },
  ]);
  // 1500走のうち1号艇の250走は母数に入らない。進入は枠なりで前付け0
  assert.deepEqual(await countsOf(MANY, "9999"), [
    { racer_id: MANY, runs: 1250, taken: 0 },
  ]);
  assert.deepEqual(await countsOf(EMPTY, "9999"), []);
  // 窓の外の走（800日前）は数えない: 窓を外すと母数が1つ増える（その走が母数に入る艇・進入のとき）か同じ
  const [wide] = await countsOf(RACER, "9999", "0000");
  assert.ok(wide.runs === mixed.runs || wide.runs === mixed.runs + 1);
  // 表示中のレースより前だけ: 途中で切ると母数が減る
  const ids = (await rowsOf(RACER)).map((r) => r.raceId);
  const [half] = await countsOf(RACER, ids[Math.floor(ids.length / 2)]);
  assert.ok(half.runs > 0 && half.runs < mixed.runs);
});

test("getRaceFrontTakingByRacer: RPC が有れば出走の選手ぜんぶで要求1本・6表を読まず、判定は今までの読みと同じ", async () => {
  const racerIds = [RACER, OTHER, MANY, INYA, EMPTY];
  const ids = (await rowsOf(RACER)).map((r) => r.raceId);
  for (const before of [ids[Math.floor(ids.length / 2)], "9999"]) {
    const neo = await frontTakingVia(env.REAL, racerIds, before);
    const old = await frontTakingVia({}, racerIds, before);
    assert.deepEqual(neo.byRacer, old.byRacer);
    assert.equal(neo.fake.calls.length, 0);
    assert.equal(neo.fake.rpcCalls.length, 1);
    assert.equal(neo.fake.rpcCalls[0].name, COUNTS_RPC);
    assert.deepEqual(neo.fake.rpcCalls[0].args, {
      p_racer_ids: racerIds,
      p_since: racerHistoryCutoff(),
      p_before_race_id: before,
    });
    // 今までの読みは、選手ごとに6表を読む
    assert.ok(old.fake.calls.length >= 6 * 4);
  }
  const { byRacer } = await frontTakingVia(env.REAL, racerIds, "9999");
  assert.deepEqual(Object.keys(byRacer).sort(), racerIds.map(String).sort());
  assert.deepEqual(byRacer[INYA], {
    runs: 30,
    taken: 30,
    rate: 100,
    isInya: true,
  });
  assert.deepEqual(byRacer[EMPTY], {
    runs: 0,
    taken: 0,
    rate: null,
    isInya: false,
  });
  assert.equal(byRacer[MANY].isInya, false);
  // 登録番号が文字列で来ても（出走6艇の欄は文字列で渡す）同じ
  const asText = await frontTakingVia(env.REAL, racerIds.map(String), "9999");
  assert.deepEqual(asText.byRacer, byRacer);
  assert.deepEqual(asText.fake.rpcCalls[0].args.p_racer_ids, racerIds);
});

test("getRaceFrontTakingByRacer: 件数の RPC だけ無いときは走の RPC から数え、どちらも無ければ6表から数える（同じ値）", async () => {
  const racerIds = [RACER, INYA];
  const expected = (await frontTakingVia(env.REAL, racerIds, "9999")).byRacer;
  const viaRuns = await frontTakingVia(
    { [RPC]: env.callRpc },
    racerIds,
    "9999",
  );
  assert.deepEqual(viaRuns.byRacer, expected);
  assert.equal(viaRuns.fake.calls.length, 0);
  const viaSix = await frontTakingVia({}, racerIds, "9999");
  assert.deepEqual(viaSix.byRacer, expected);
  assert.ok(viaSix.fake.calls.length >= 6 * 2);
});

test("getRaceFrontTakingByRacer: 件数の RPC のほかの失敗は例外のまま。落ちた先で選手の読みが失敗したら、その選手だけ外す", async () => {
  const boom = Object.assign(new Error("rpc 失敗"), { code: "57014" });
  await assert.rejects(
    frontTakingVia(
      {
        [COUNTS_RPC]: () => {
          throw boom;
        },
      },
      [RACER],
      "9999",
    ),
    (e) => e === boom,
  );
  // 件数の関数が無く、走の RPC が INYA だけ失敗: INYA は外れ、RACER は数えられる
  const expected = (await frontTakingVia(env.REAL, [RACER], "9999")).byRacer;
  const { byRacer } = await frontTakingVia(
    {
      [RPC]: (args) => {
        if (args.p_racer_id === INYA) throw boom;
        return env.callRpc(args);
      },
    },
    [RACER, INYA],
    "9999",
  );
  assert.deepEqual(byRacer, expected);
});
