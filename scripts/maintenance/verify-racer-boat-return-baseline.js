// 選手ページの回収率の全国の基準の SQL（docs/db-migration/210_racer_boat_return_baseline.sql。案は docs/design/racer-return-baseline/db-draft.md）が、選手ページの純関数と同じ合計を返すことを守る。
// PGlite に本番と同じ形の縮約の表（race_entries・races・race_results・race_start_timings、RLS 有効・匿名に SELECT）を作り、塊を2回流す。
//   - 母数: 会場のあるレースで、不成立（no_race）と rank1 が NULL を除く。窓 [p_from, p_to] の外は数えない
//   - 着順なし（finish_mark が 1〜6 以外）は払戻0で母数に入れる。単勝は1着、複勝は1着・2着、3連単は k 着の走の payout_trio
//   - 合計は試験データの期待（verifyData/racer-boat-return-baseline.js）と一致。同じ期待を選手ページの純関数が返すことは
//     verify-racer-boat-return-baseline-pure.js が守り、2つで「SQL の合計 = 純関数の合計」になる。二乗の合計も手で数えた値と一致
//   - boat_number 0 は全艇の合計。RPC は service_role だけが呼べ、表は匿名が読める
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import {
  RACES,
  WINDOW,
  EXPECTED,
} from "./verifyData/racer-boat-return-baseline.js";
import { MIGRATION_210_SQL } from "./verifyData/racer-boat-return-baseline-sql.js";
import { classifyMigration, inspectMigration } from "../lib/dbApplySql.js";

const db = new PGlite();
const sql = MIGRATION_210_SQL;

const races = RACES;
const FROM = WINDOW.from;
const TO = WINDOW.to;

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(`
    CREATE TABLE race_entries(race_id VARCHAR, racer_id INT, boat_number SMALLINT, PRIMARY KEY (race_id, boat_number));
    CREATE TABLE races(race_id VARCHAR PRIMARY KEY, venue_code SMALLINT);
    CREATE TABLE race_results(race_id VARCHAR PRIMARY KEY, rank1 SMALLINT, rank2 SMALLINT, rank3 SMALLINT,
      payout_win INT, payout_place_1 INT, payout_place_2 INT, payout_trio INT, race_status TEXT);
    CREATE TABLE race_start_timings(race_id VARCHAR, boat_number SMALLINT, finish_mark TEXT, PRIMARY KEY (race_id, boat_number));
  `);
  for (const t of [
    "race_entries",
    "races",
    "race_results",
    "race_start_timings",
  ]) {
    await db.exec(`
      ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY ${t}_read ON ${t} FOR SELECT TO anon, authenticated, service_role USING (true);
      GRANT SELECT ON ${t} TO anon, authenticated, service_role;`);
  }
  for (const r of races) {
    await db.query("INSERT INTO races VALUES ($1, $2)", [r.id, r.venue]);
    await db.query(
      "INSERT INTO race_results VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [r.id, ...r.ranks, r.win, r.p1, r.p2, r.trio, r.status ?? "normal"],
    );
    for (let b = 1; b <= 6; b += 1) {
      await db.query("INSERT INTO race_entries VALUES ($1, $2, $3)", [
        r.id,
        1000 + b,
        b,
      ]);
      const place = r.ranks.indexOf(b) + 1;
      const mark = r.marks?.[b] ?? (place > 0 ? String(place) : null);
      await db.query("INSERT INTO race_start_timings VALUES ($1, $2, $3)", [
        r.id,
        b,
        mark,
      ]);
    }
  }
  await db.exec(sql);
  // 2回流しても失敗しない（IF NOT EXISTS・CREATE OR REPLACE・DROP POLICY IF EXISTS・GRANT）
  await db.exec(sql);
});

async function rpc(role) {
  await db.exec(`SET ROLE ${role}`);
  try {
    const { rows } = await db.query(
      "SELECT * FROM public.compute_racer_boat_return_baseline($1::date, $2::date) ORDER BY boat_number",
      [FROM, TO],
    );
    return rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])),
    );
  } finally {
    await db.exec("RESET ROLE");
  }
}

test("艇ごとの合計が試験データの期待（＝選手ページの純関数）と一致し、0 は全艇の合計", async () => {
  const rows = await rpc("service_role");
  assert.deepEqual(
    rows.map((r) => r.boat_number),
    [0, 1, 2, 3, 4, 5, 6],
  );
  for (const e of EXPECTED) {
    const got = rows.find((r) => r.boat_number === e.boat);
    for (const key of [
      "runs",
      "win_sum",
      "place_sum",
      "tri_pos1_sum",
      "tri_pos2_sum",
      "tri_pos3_sum",
    ]) {
      assert.equal(got[key], e[key], `${e.boat}号艇の ${key}`);
    }
  }
  const total = rows.find((r) => r.boat_number === 0);
  for (const key of [
    "runs",
    "win_sum",
    "place_sum",
    "tri_pos1_sum",
    "unranked_runs",
    "tri_paid_missing",
  ]) {
    const sum = rows
      .filter((r) => r.boat_number > 0)
      .reduce((a, r) => a + r[key], 0);
    assert.equal(total[key], sum, `全艇の ${key}`);
  }
});

test("着順なしは払戻0で母数に入れ、二乗の合計と配当の欠けを数える", async () => {
  const rows = await rpc("service_role");
  const b4 = rows.find((r) => r.boat_number === 4);
  // 4号艇: 10/02 に1着（単勝1800・複勝400・3連単25000）、10/04 は F で着順なし（払戻0）
  assert.equal(b4.runs, 4);
  assert.equal(b4.unranked_runs, 1);
  assert.equal(b4.win_sumsq, 1800 * 1800);
  assert.equal(b4.tri_pos1_sumsq, 25000 * 25000);
  // 3号艇は 10/03 に2着だが 3連単の配当が NULL → 欠けとして数え、合計に入れない
  const b3 = rows.find((r) => r.boat_number === 3);
  assert.equal(b3.tri_paid_missing, 1);
  assert.equal(b3.tri_pos2_sum, 0);
  assert.equal(b3.tri_pos3_sum, 1200);
});

test("RPC は service_role だけが呼べ、表は匿名が読めて書けない", async () => {
  await assert.rejects(() => rpc("anon"));
  await assert.rejects(() => rpc("authenticated"));
  const { rows } = await db.query(
    "SELECT has_table_privilege('anon', 'public.racer_boat_return_baseline', 'SELECT') AS r, has_table_privilege('anon', 'public.racer_boat_return_baseline', 'INSERT') AS w",
  );
  assert.equal(rows[0].r, true);
  assert.equal(rows[0].w, false);
  await assert.rejects(
    () =>
      db.query(
        "INSERT INTO public.racer_boat_return_baseline(scope, boat_number, window_start, window_end, window_days, runs, unranked_runs, win_sum, win_sumsq, place_sum, place_sumsq, tri_pos1_sum, tri_pos1_sumsq, tri_pos2_sum, tri_pos2_sumsq, tri_pos3_sum, tri_pos3_sumsq, tri_paid_missing, rule_version, last_updated) VALUES ('national', 7, '2026-10-01', '2026-10-31', 31, 1, 0, 0,0,0,0,0,0,0,0,0,0,0,1,'2026-11-01')",
      ),
    "boat_number は 0〜6",
  );
});

test("db-apply の検査で拒否が無く、触る表は racer_boat_return_baseline だけ", () => {
  const inspection = inspectMigration(sql);
  assert.deepEqual(inspection.rejections, []);
  assert.equal(inspection.mode, "single-transaction");
  assert.deepEqual(
    inspection.tables.map((t) => t.table),
    ["racer_boat_return_baseline"],
  );
  const lane = classifyMigration(sql, "210_racer_boat_return_baseline.sql");
  assert.equal(lane.label, "heavy");
  assert.deepEqual(lane.stops, []);
});
