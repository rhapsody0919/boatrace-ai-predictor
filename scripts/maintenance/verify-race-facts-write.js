// facts の1つの窓を書く関数（scripts/lib/raceFactsWrite.js）が、race_facts→run_facts の順に変わった行だけを書き、dryRun では書かず消さず、窓の孤立した行を消し、失敗を投げることを守る（ADR-0113）
// 外部接続なし（偽のクライアントと偽の upsert）
import assert from "node:assert/strict";
import { writeFactsWindow } from "../lib/raceFactsWrite.js";

const fakeClient = (failOn = null) => {
  const deletes = [];
  const client = {
    from: (table) => ({
      delete: () => {
        const q = { table, conds: [] };
        deletes.push(q);
        const step = {
          eq: (c, v) => { q.conds.push([c, v]); return step; },
          in: (c, v) => { q.conds.push([c, v]); return step; },
          then: (res) => res({ error: failOn === table ? { message: "拒否" } : null }),
        };
        return step;
      },
    }),
  };
  return { client, deletes };
};
const upserts = [];
const fakeUpsert = (toWriteOf, error = null) => async (_c, table, rows, opts) => {
  upserts.push({ table, rows, opts });
  return { error, toWrite: rows.slice(0, toWriteOf(table)), written: error ? 0 : rows.length };
};
const PLAN = {
  raceRows: [{ race_id: "r1" }],
  runRows: [{ race_id: "r1", boat_number: 1 }, { race_id: "r1", boat_number: 2 }],
  staleRace: ["r9"],
  staleRun: ["r9|3", "r8|4"],
};

{
  const { client, deletes } = fakeClient();
  upserts.length = 0;
  const res = await writeFactsWindow(client, PLAN, { dryRun: true, upsert: fakeUpsert((t) => (t === "race_facts" ? 1 : 0)) });
  assert.deepEqual(res, { written: 1 }, "dryRun は書く予定の数");
  assert.deepEqual(upserts.map((u) => u.table), ["race_facts", "run_facts"]);
  assert.deepEqual(upserts[1].opts.keyColumns, ["race_id", "boat_number"]);
  assert.equal(upserts[1].opts.onConflict, "race_id,boat_number");
  assert.equal(upserts[0].opts.dryRun, true);
  assert.equal(upserts[0].opts.failOnFetchError, true);
  assert.deepEqual(upserts[0].opts.ignoreColumns, ["built_at"]);
  assert.equal(deletes.length, 0, "dryRun は消さない");
}
{
  const { client, deletes } = fakeClient();
  const res = await writeFactsWindow(client, PLAN, { dryRun: false, upsert: fakeUpsert(() => 0) });
  assert.deepEqual(res, { written: 3 });
  assert.deepEqual(deletes.map((d) => [d.table, d.conds]), [
    ["run_facts", [["race_id", "r9"], ["boat_number", 3]]],
    ["run_facts", [["race_id", "r8"], ["boat_number", 4]]],
    ["race_facts", [["race_id", ["r9"]]]],
  ]);
}
{
  const { client, deletes } = fakeClient();
  await writeFactsWindow(client, { ...PLAN, staleRace: [], staleRun: [] }, { dryRun: false, upsert: fakeUpsert(() => 0) });
  assert.equal(deletes.length, 0, "消す行が無ければ消さない");
}
await assert.rejects(writeFactsWindow(fakeClient().client, PLAN, { dryRun: false, upsert: fakeUpsert(() => 0, new Error("書けない")) }), /書けない/);
await assert.rejects(writeFactsWindow(fakeClient("run_facts").client, PLAN, { dryRun: false, upsert: fakeUpsert(() => 0) }), /run_facts の消去エラー（r9\|3）/);
await assert.rejects(
  writeFactsWindow(fakeClient("race_facts").client, { ...PLAN, staleRun: [] }, { dryRun: false, upsert: fakeUpsert(() => 0) }),
  /race_facts の消去エラー/,
);

console.log("verify-race-facts-write: OK");
