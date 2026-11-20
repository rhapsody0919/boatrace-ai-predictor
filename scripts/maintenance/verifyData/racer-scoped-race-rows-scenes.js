/**
 * verify-racer-scoped-race-rows.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-racer-scoped-race-rows.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  checkAsync,
  RACER,
  expectedServiceRows,
  S1,
  S2,
  SERVICE_TABLES,
} from "./racer-scoped-race-rows.js";

let getRacerScopedRaceStats, withCache, racerHistoryCutoff, install;

async function scene1() {
  await checkAsync(
    "C1 getRacerScopedRaceStats は取った表を buildRacerScopedRaceRows で組んだ行をそのまま返す",
    async () => {
      const fake = install();
      const rows = await getRacerScopedRaceStats(RACER);
      const expected = expectedServiceRows();
      assert.equal(expected.length, 2);
      assert.deepEqual(rows, expected);
      // 取る表: race_entries は選手・窓の始点で、他の5表は選手の走の race_id だけで
      const entryQ = fake.calls.find((q) => q.table === "race_entries");
      assert.deepEqual(entryQ.filters, [
        ["eq", "racer_id", RACER],
        ["gte", "race_id", racerHistoryCutoff()],
      ]);
      for (const table of [
        "races",
        "race_results",
        "race_start_timings",
        "exhibition_data",
        "race_conditions",
      ]) {
        const q = fake.calls.find((c) => c.table === table);
        assert.ok(q, `${table} を取っていない`);
        assert.deepEqual(q.filters, [["in", "race_id", [S1, S2]]]);
      }
    },
  );
  await checkAsync(
    "C1b race_conditions の取得に失敗しても例外にせず、conditionRows を null で整形する",
    async () => {
      install(SERVICE_TABLES, new Set(["race_conditions"]));
      const origError = console.error;
      console.error = () => {};
      let rows;
      try {
        rows = await getRacerScopedRaceStats(RACER);
      } finally {
        console.error = origError;
      }
      const expected = expectedServiceRows(null);
      assert.deepEqual(rows, expected);
    },
  );
  await checkAsync(
    "C2 出遅れフラグ（is_late_start）を含む列で race_start_timings を取り、結果は racer-scoped-race-stats-v12 のキャッシュに入る（旧版のキャッシュは使わない）",
    async () => {
      const fake = install();
      // 旧版（v11）のキャッシュに入っていた古い形の値は返さない
      const stale = [{ stale: true }];
      await withCache(`racer-scoped-race-stats-v11-${RACER}`, async () => stale);
      const rows = await getRacerScopedRaceStats(RACER);
      assert.notDeepEqual(rows, stale);
      const stq = fake.calls.find((q) => q.table === "race_start_timings");
      assert.equal(
        stq.select,
        "race_id, boat_number, start_timing, is_flying, is_late_start, finish_mark, entry_course",
      );
      assert.equal(rows.find((r) => r.raceId === S2).lateStartTiming, 1.99);
      // 結果は v12 のキーに入っている（取り直さずに同じ値が返る）
      const cached = await withCache(`racer-scoped-race-stats-v12-${RACER}`, () =>
        Promise.reject(new Error("v12 のキャッシュに無い")),
      );
      assert.deepEqual(cached, rows);
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（getRacerScopedRaceStats・withCache・racerHistoryCutoff・install） */
export async function runRacerScopedRaceRowsScenes1(env) {
  ({ getRacerScopedRaceStats, withCache, racerHistoryCutoff, install } = env);
  await scene1();
}
