// 選手の走を1走1行で返す RPC（マイグレーション 203、get_racer_scoped_race_rows）と、その行を6表の形へ戻す
// src/pure/racerScopedRunTables.js・呼び手 getRacerScopedRaceStats（src/services/racerQueries2.js）の再現テスト。
// PGlite に本番と同じ型の縮約の6表（RLS 有効・匿名に SELECT）を作り、203 を当てて確かめる（verifyData/racer-scoped-race-rpc.js）。
//   - 同じ表から、今までの道（6表の生の行を読む → buildRacerScopedRaceRows）と、新しい道（RPC → 戻す → 同じ整形）の
//     返す行が完全に同じ（不成立・結果なし・rank4〜6 なし・F・出遅れ・欠場・自艇だけ ST の行なし・ST なし・展示なし・
//     展示の同タイム・条件の行なし・同じレースに同じ選手が2艇・窓の外・別の選手、を混ぜた走）
//   - RPC が有れば6表を1行も読まない。要求は選手ごとに1本（1000行までは1ページ）
//   - 1500走の選手を1000行で切らずに取り切る（race_id・boat_number の順の .range()）
//   - 関数が無い（PGRST202・42883）・呼ぶ権限が無いときだけ今までの読みに落ちる。ほかの失敗は例外のまま
//   - 2本とも STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が RLS の下で呼べる、2回当てても失敗しない
// 前付けの件数の RPC（get_racer_front_taking_counts）の値は verify-racer-front-taking-rpc.js。外部接続なし
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

let env;
before(async () => {
  env = await setupRacerScopedRpc();
});

const viaTables = async (racerId) => {
  const { value, fake } = await env.call({}, () =>
    env.getRacerScopedRaceStats(racerId),
  );
  return { rows: value, fake };
};
const viaRpc = async (racerId, rpcs = env.REAL) => {
  const { value, fake } = await env.call(rpcs, () =>
    env.getRacerScopedRaceStats(racerId),
  );
  return { rows: value, fake };
};

test("同じ表から、6表の読みと RPC の道の返す行が完全に同じ（場面を混ぜた選手）", async () => {
  const old = await viaTables(RACER);
  const neo = await viaRpc(RACER);
  assert.deepEqual(neo.rows, old.rows);
  // 比べた行が空・一様でないこと（場面が実際に行に出ている）
  const rows = old.rows;
  assert.ok(rows.length >= 70, `行が少ない: ${rows.length}`);
  const scenes = {
    F: (r) => r.isFlying === true && r.flyingStartTiming === 0.01,
    出遅れ: (r) => r.lateStartTiming === 1.2 && r.startTiming === null,
    "欠場（欠）": (r) => r.absent === true && r.boatNumber === 5,
    "自艇だけ ST の行なしの欠場": (r) =>
      r.absent === true && r.boatNumber === 2,
    "ST の順位": (r) => r.stRank !== null && r.stRank > 1,
    内側の最速: (r) => r.innerMinSt !== null,
    展示の単独の最速: (r) => r.isFastestExhibition === true,
    "展示の同タイムの最速（対象なし）": (r) =>
      r.isFastestExhibition === null && r.exhibitionRank === 1,
    展示なし: (r) => r.exhibitionTime === null,
    条件なし: (r) => r.seriesDay === null && r.raceTitle === null,
    "rank4 なし": (r) => r.rank4 === null,
    公式の記号: (r) => r.finishMark === "転",
    級別なし: (r) => r.grade === null && r.fCount === null,
  };
  for (const [label, found] of Object.entries(scenes)) {
    assert.ok(rows.some(found), `場面が行に出ていない: ${label}`);
  }
  // 同じレースの2艇は2行ある
  const twice = rows.filter(
    (r) => rows.filter((o) => o.raceId === r.raceId).length === 2,
  );
  assert.deepEqual(
    twice.map((r) => r.boatNumber),
    [2, 5],
  );
  // 窓の外・別の選手は入らない
  assert.ok(rows.every((r) => r.raceId >= racerHistoryCutoff()));
  const other = await viaRpc(OTHER);
  assert.deepEqual(other.rows, (await viaTables(OTHER)).rows);
  assert.notDeepEqual(other.rows, rows);
  // 札の選手（4号艇で2コース）も同じ
  assert.deepEqual((await viaRpc(INYA)).rows, (await viaTables(INYA)).rows);
});

test("RPC が有れば6表を1行も読まず、要求は選手ごとに1本。返す行は1走1行", async () => {
  const old = await viaTables(RACER);
  const neo = await viaRpc(RACER);
  assert.equal(neo.fake.calls.length, 0);
  assert.equal(neo.fake.rpcCalls.length, 1);
  const call = neo.fake.rpcCalls[0];
  assert.equal(call.name, RPC);
  const since = racerHistoryCutoff();
  assert.deepEqual(call.args, { p_racer_id: RACER, p_since: since });
  assert.deepEqual(call.orders, ["race_id", "boat_number"]);
  assert.deepEqual(call.range, [0, 999]);
  // 読む行の数: RPC は窓の中の race_entries の行と同じ数。6表の読みはその約16倍（1+1+1+1+6+6。欠けの分だけ少ない）
  const runs = await env.callRpc({ p_racer_id: RACER, p_since: since });
  const entryCount = env.tables.race_entries.filter(
    (e) => e.racer_id === RACER && e.race_id >= since,
  ).length;
  assert.equal(runs.length, entryCount);
  const ids = new Set(runs.map((r) => r.race_id));
  const oldRowCount = Object.entries(env.tables)
    .filter(([table]) => table !== "race_entries")
    .map(([, rows]) => rows.filter((r) => ids.has(r.race_id)).length)
    .reduce((a, b) => a + b, entryCount);
  assert.ok(old.fake.calls.length >= 6, "今までの道は6表を読む");
  assert.ok(
    oldRowCount > runs.length * 14,
    `6表 ${oldRowCount} 行・RPC ${runs.length} 行`,
  );
});

test("1500走の選手を1000行で切らずに取り切る（6表の読みと同じ行）", async () => {
  const neo = await viaRpc(MANY);
  assert.equal(neo.rows.length, 1500);
  assert.deepEqual(
    neo.fake.rpcCalls.map((c) => c.range),
    [
      [0, 999],
      [1000, 1999],
    ],
  );
  assert.equal(neo.fake.calls.length, 0);
  assert.deepEqual(neo.rows, (await viaTables(MANY)).rows);
});

test("走の無い選手は空（6表も読まない）", async () => {
  const neo = await viaRpc(EMPTY);
  assert.deepEqual(neo.rows, []);
  assert.equal(neo.fake.calls.length, 0);
});

test("関数が無い（PGRST202・42883）・呼ぶ権限が無いときだけ今までの読みに落ち、行は同じ", async () => {
  const expected = (await viaTables(RACER)).rows;
  for (const error of [
    { code: "PGRST202" },
    { code: "42883" },
    { code: "42501" },
    { message: "permission denied for function get_racer_scoped_race_rows" },
  ]) {
    const { rows, fake } = await viaRpc(RACER, {
      [RPC]: () => {
        throw Object.assign(new Error(error.message ?? "rpc 失敗"), error);
      },
    });
    assert.deepEqual(rows, expected);
    assert.equal(fake.rpcCalls.length, 1);
    assert.ok(fake.calls.length >= 6);
  }
});

test("ほかの失敗（通信・タイムアウト等）は例外のまま（黙って6表の読みに落とさない）", async () => {
  for (const error of [{ code: "57014" }, { code: "PGRST301" }, {}]) {
    const boom = Object.assign(new Error("rpc 失敗"), error);
    let used;
    await assert.rejects(
      env.call(
        {
          [RPC]: () => {
            throw boom;
          },
        },
        (fake) => {
          used = fake;
          return env.getRacerScopedRaceStats(RACER);
        },
      ),
      (e) => e === boom,
    );
    assert.equal(used.rpcCalls.length, 1);
    assert.equal(used.calls.length, 0);
  }
});

test("2本とも STABLE・SECURITY INVOKER・search_path 固定、anon・authenticated が RLS の下で呼べる", async () => {
  const { rows } = await env.db.query(
    "SELECT proname, provolatile, prosecdef, proconfig FROM pg_proc WHERE proname = ANY($1) ORDER BY proname",
    [[RPC, COUNTS_RPC]],
  );
  assert.deepEqual(
    rows.map((r) => r.proname),
    [COUNTS_RPC, RPC],
  );
  for (const row of rows) {
    assert.equal(row.provolatile, "s");
    assert.equal(row.prosecdef, false);
    assert.deepEqual(row.proconfig, ["search_path=public, pg_temp"]);
  }
  const since = racerHistoryCutoff();
  const runsOf = (role) =>
    env.callRpc({ p_racer_id: RACER, p_since: since }, role);
  const countsOf = (role) =>
    env.callCounts(
      { p_racer_ids: [RACER, INYA], p_since: since, p_before_race_id: "9999" },
      role,
    );
  const [runs, counts] = [await runsOf(), await countsOf()];
  assert.ok(runs.length >= 70);
  assert.equal(counts.length, 2);
  for (const role of ["anon", "authenticated", "service_role"]) {
    assert.deepEqual(await runsOf(role), runs);
    assert.deepEqual(await countsOf(role), counts);
  }
  // PUBLIC には付けない（113 の方針）
  for (const signature of [
    `public.${RPC}(integer, text)`,
    `public.${COUNTS_RPC}(integer[], text, text)`,
  ]) {
    const pub = await env.db.query(
      "SELECT has_function_privilege('public', $1, 'EXECUTE') AS ok",
      [signature],
    );
    assert.equal(pub.rows[0].ok, false, signature);
  }
});

test("窓の境目: p_since と同じ race_id は入り、手前は入らない。並びは race_id・boat_number", async () => {
  const all = await env.callRpc({ p_racer_id: RACER, p_since: "0000" });
  const cut = all[10].race_id;
  const part = await env.callRpc({ p_racer_id: RACER, p_since: cut });
  assert.deepEqual(
    part,
    all.filter((r) => r.race_id >= cut),
  );
  assert.equal(part[0].race_id, cut);
  const keys = all.map((r) => `${r.race_id}-${r.boat_number}`);
  assert.deepEqual(keys, [...keys].sort());
  // 窓の外の走（800日前）は p_since が空なら入る＝切っているのは p_since だけ
  assert.ok(all.some((r) => r.race_id < racerHistoryCutoff()));
});
