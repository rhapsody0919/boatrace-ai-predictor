// 回収率の全国の基準の毎晩の集計（scripts/lib/racerBoatReturnBaselineJob.js）が、窓を月ごとに分けて RPC を呼び、合計を足して7行を書き、0件・失敗・時間切れで書かないことを守る
import assert from "node:assert/strict";
import {
  runRacerBoatReturnBaselineJob,
  sumByBoat,
  BASELINE_RPC,
  BASELINE_TABLE,
} from "../lib/racerBoatReturnBaselineJob.js";
import { monthRanges, racerHistoryWindowStart, addDaysIso } from "../../src/pure/racerHistoryWindow.js";

// 窓の分け方: 月の境で切り、両端を含み、隙間も重なりもない
const ranges = monthRanges("2025-11-27", "2026-02-10");
assert.deepEqual(ranges, [
  ["2025-11-27", "2025-11-30"],
  ["2025-12-01", "2025-12-31"],
  ["2026-01-01", "2026-01-31"],
  ["2026-02-01", "2026-02-10"],
]);
assert.deepEqual(monthRanges("2026-02-01", "2026-02-28"), [["2026-02-01", "2026-02-28"]], "うるう年でない2月");
assert.deepEqual(monthRanges("2026-03-05", "2026-03-04"), [], "空の窓");
assert.equal(racerHistoryWindowStart(new Date("2026-11-27T00:00:00Z")), "2024-11-27", "選手ページの racerHistoryCutoff と同じ730日前");
assert.equal(addDaysIso("2026-03-01", -1), "2026-02-28");

/** 艇 b の1か月分の RPC の行。値は月の番号で変える */
const rowFor = (boat, month) => ({
  boat_number: boat, runs: 10 + month, unranked_runs: 1, win_sum: 100 * boat, win_sumsq: 10000 * boat * boat,
  place_sum: 50, place_sumsq: 2500, tri_pos1_sum: 3000, tri_pos1_sumsq: 9000000, tri_pos2_sum: 0, tri_pos2_sumsq: 0,
  tri_pos3_sum: 1200, tri_pos3_sumsq: 1440000, tri_paid_missing: 0,
});
const monthRows = (month) => {
  const boats = [1, 2, 3, 4, 5, 6].map((b) => rowFor(b, month));
  const total = { ...rowFor(0, month), runs: boats.reduce((a, r) => a + r.runs, 0) };
  return [total, ...boats];
};

function fakeClient({ failAt = null, empty = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => {
      calls.push({ name, ...args });
      if (failAt !== null && calls.length === failAt) return { data: null, error: { message: "statement timeout" } };
      return { data: empty ? [] : monthRows(calls.length), error: null };
    },
  };
}
const quiet = () => {};

// 正常: 窓（730日前〜昨日）を月ごとに呼び、7行を書く。月の値は足される
{
  const client = fakeClient();
  const writes = [];
  const upsert = async (c, table, rows, opts) => {
    writes.push({ table, rows, opts });
    return { written: rows.length, error: null };
  };
  const res = await runRacerBoatReturnBaselineJob({ client, today: "2026-11-27", dryRun: false, upsert, log: quiet });
  assert.equal(res.outcome, "ok");
  const expected = monthRanges("2024-11-27", "2026-11-26");
  assert.deepEqual(client.calls.map((c) => [c.p_from, c.p_to]), expected, "窓を月ごとに呼ぶ");
  assert.ok(client.calls.every((c) => c.name === BASELINE_RPC));
  assert.equal(writes.length, 1);
  const { table, rows, opts } = writes[0];
  assert.equal(table, BASELINE_TABLE);
  assert.deepEqual(rows.map((r) => r.boat_number), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(opts.keyColumns, ["scope", "boat_number"]);
  const b2 = rows.find((r) => r.boat_number === 2);
  const months = expected.length;
  assert.equal(b2.runs, Array.from({ length: months }, (_, i) => 10 + i + 1).reduce((a, b) => a + b, 0), "月の走数を足す");
  assert.equal(b2.win_sum, 200 * months);
  assert.equal(b2.win_sumsq, 40000 * months);
  assert.equal(b2.scope, "national");
  assert.equal(b2.window_start, "2024-11-27");
  assert.equal(b2.window_end, "2026-11-26");
  assert.equal(b2.window_days, 730);
  assert.equal(b2.last_updated, "2026-11-27");
  assert.equal(res.rowsParsed, 7);
}

// RPC の失敗は error にして書かない
{
  let wrote = false;
  const res = await runRacerBoatReturnBaselineJob({
    client: fakeClient({ failAt: 3 }), today: "2026-11-27", dryRun: false, log: quiet,
    upsert: async () => { wrote = true; return { written: 0 }; },
  });
  assert.equal(res.outcome, "error");
  assert.match(res.error, /statement timeout/);
  assert.equal(wrote, false);
}

// 0件は error（期待は0でない）
{
  let wrote = false;
  const res = await runRacerBoatReturnBaselineJob({
    client: fakeClient({ empty: true }), today: "2026-11-27", dryRun: false, log: quiet,
    upsert: async () => { wrote = true; return { written: 0 }; },
  });
  assert.equal(res.outcome, "error");
  assert.equal(wrote, false);
}

// 時間切れは数えかけを書かず incomplete（補足の起動が数え直す）
{
  let n = 0;
  let wrote = false;
  const res = await runRacerBoatReturnBaselineJob({
    client: fakeClient(), today: "2026-11-27", dryRun: false, log: quiet,
    shouldStop: () => ++n > 3,
    upsert: async () => { wrote = true; return { written: 0 }; },
  });
  assert.equal(res.outcome, "ok");
  assert.equal(res.incomplete, true);
  assert.equal(wrote, false);
}

// dryRun はそのまま書き込みの関数に渡す（共通の upsertChangedRows が書かない）
{
  let seen = null;
  await runRacerBoatReturnBaselineJob({
    client: fakeClient(), today: "2026-11-27", dryRun: true, log: quiet,
    upsert: async (c, t, rows, opts) => { seen = opts.dryRun; return { written: 0 }; },
  });
  assert.equal(seen, true);
}

// 二乗の合計は BigInt で足す（2^53 を超えても下の桁を落とさずに足してから数にする）
{
  const big = 2 ** 52;
  const sums = sumByBoat([{ boat_number: 1, win_sumsq: big }, { boat_number: 1, win_sumsq: big }, { boat_number: 1, win_sumsq: 2 }]);
  assert.equal(sums.get(1).win_sumsq, Number(BigInt(big) * 2n + 2n));
}

console.log("verify-racer-boat-return-baseline-job: OK");
