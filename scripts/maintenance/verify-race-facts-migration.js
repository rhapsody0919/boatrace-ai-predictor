// facts の表（race_facts・run_facts）と get_racer_runs のマイグレーションが、匿名に表を直に開けず、選手1人の行だけを RPC で返すことを守る（ADR-0113 決定4）
// PGlite に anon・authenticated・service_role（BYPASSRLS）を作り、マイグレーションを1つのトランザクションで2回流してから確かめる:
//   - 境目の日の CHECK（2025-12-02 は kb、2025-12-03 は main）、race_id と日付・会場・レース番号のずれ、条件の出所の無い風
//   - anon で表を直に引くと0行。RPC は1選手の行だけ（レースの値つき）を返し、呼んだ後に設定が残らない。p_from で絞れる。NULL は例外
//   - anon が自分で設定を立てても、1トランザクションに1選手の行しか見えない。anon は書けない。読み取り専用のトランザクションでも RPC が通る
//   - kb_archive_extra は艇の行にレースの列を入れられない・2025-12-03 以降を入れられない。backfill_progress は試した単位に時刻が要る
//   - 戻しの SQL（race_facts を先に消す）が通り、戻した後に当て直せる
// 外部接続なし
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { readRaceFactsMigration } from "./verifyData/race-facts-migration-files.js";

const sql = readRaceFactsMigration();
const ROLLBACK = `BEGIN; SET LOCAL lock_timeout = '10s';
  DROP FUNCTION IF EXISTS public.get_racer_runs(integer, date); DROP TABLE IF EXISTS public.race_facts;
  DROP TABLE IF EXISTS public.run_facts; DROP TABLE IF EXISTS public.kb_archive_extra;
  DROP TABLE IF EXISTS public.backfill_progress; DROP TABLE IF EXISTS public.facts_coverage; COMMIT;`;

const db = new PGlite();
const apply = () => db.exec(`BEGIN;${sql}COMMIT;`);
const count = async (table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
const runs = async (racer, from) =>
  (await db.query("SELECT get_racer_runs($1, $2) AS j", [racer, from])).rows[0].j;
/** 書き込みが拒まれたら true */
const rejects = async (q, p = []) => {
  try {
    await db.query(q, p);
    return false;
  } catch {
    return true;
  }
};
const RACE = "INSERT INTO race_facts(race_id, era, race_date, venue_code, race_number, has_result, rule_version, payout_win)";

before(async () => {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;");
  await apply();
  await apply();
  const races = [
    ["2025-12-02-01-01", "kb", "2025-12-02", [11, 12, 13, 14, 15, 16]],
    ["2025-12-03-01-01", "main", "2025-12-03", [11, 22, 23, 24, 25, 26]],
    ["2025-12-04-01-01", "main", "2025-12-04", [31, 32, 33, 34, 35, 36]],
  ];
  for (const [id, era, date, racers] of races) {
    await db.query(`${RACE} VALUES ($1, $2, $3, 1, 1, true, 1, 150)`, [id, era, date]);
    for (let b = 1; b <= 6; b += 1) {
      await db.query(
        "INSERT INTO run_facts(race_id, boat_number, era, race_date, racer_id, rule_version, finish_rank) VALUES ($1, $2, $3, $4, $5, 1, $2)",
        [id, b, era, date, racers[b - 1]],
      );
    }
  }
});

test("境目の日と race_id の CHECK", async () => {
  assert.ok(await rejects(`${RACE} VALUES ('2025-12-02-02-01', 'main', '2025-12-02', 2, 1, true, 1, 0)`), "2025-12-02 は kb");
  assert.ok(await rejects(`${RACE} VALUES ('2025-12-03-02-01', 'kb', '2025-12-03', 2, 1, true, 1, 0)`), "2025-12-03 は main");
  assert.ok(await rejects(`${RACE} VALUES ('2025-12-05-02-01', 'main', '2025-12-06', 2, 1, true, 1, 0)`), "日付のずれ");
  assert.ok(await rejects(`${RACE} VALUES ('2025-12-05-03-01', 'main', '2025-12-05', 4, 1, true, 1, 0)`), "会場のずれ");
  assert.ok(
    await rejects("INSERT INTO race_facts(race_id, era, race_date, venue_code, race_number, has_result, rule_version, wind_speed) VALUES ('2025-12-05-03-02', 'main', '2025-12-05', 3, 2, true, 1, 2.5)"),
    "条件の出所の無い風",
  );
});

test("匿名は表を直に引けず、RPC で1選手だけ", async () => {
  await db.exec("SET ROLE anon");
  try {
    assert.equal(await count("run_facts"), 0);
    assert.equal(await count("race_facts"), 0);
    const all = await runs(11, "2019-04-01");
    assert.deepEqual(all.map((r) => [r.race_id, r.boat_number, r.racer_id]), [
      ["2025-12-02-01-01", 1, 11],
      ["2025-12-03-01-01", 1, 11],
    ]);
    assert.equal(all[0].race.payout_win, 150, "レースの値つき");
    assert.equal((await runs(11, "2025-12-03")).length, 1, "p_from で絞る");
    assert.deepEqual(await runs(999, "2019-04-01"), []);
    const after = (await db.query("SELECT current_setting('boatai.facts_racer_id', true) AS v")).rows[0].v;
    assert.equal(after ?? "", "", "呼んだ後に設定が残らない");
    assert.equal(await count("run_facts"), 0);
    assert.ok(await rejects("SELECT get_racer_runs(NULL, '2019-04-01')"), "NULL は例外");
    await db.exec("BEGIN");
    await db.query("SELECT set_config('boatai.facts_racer_id', '31', true)");
    assert.equal(await count("run_facts"), 1, "自分で立てても1選手");
    assert.equal(await count("race_facts"), 1);
    await db.exec("COMMIT");
    assert.ok(
      await rejects("INSERT INTO run_facts(race_id, boat_number, era, race_date, rule_version) VALUES ('2025-12-04-01-01', 1, 'main', '2025-12-04', 1)"),
      "anon は書けない",
    );
    await db.exec("BEGIN READ ONLY");
    assert.equal((await runs(11, "2019-04-01")).length, 2, "読み取り専用でも通る");
    await db.exec("COMMIT");
  } finally {
    await db.exec("RESET ROLE");
  }
});

test("取り込みの表の CHECK", async () => {
  const EXTRA = "INSERT INTO kb_archive_extra(race_id, boat_number, source, race_date, measure_status, fetched_at)";
  assert.ok(await rejects(`${EXTRA} VALUES ('2025-06-14-12-01', 1, 'boatcast_oriten', '2025-06-14', 1, now())`), "艇の行に計測の状態");
  assert.equal(await rejects(`${EXTRA} VALUES ('2025-06-14-12-01', 0, 'boatcast_oriten', '2025-06-14', 1, now())`), false);
  assert.ok(await rejects(`${EXTRA} VALUES ('2025-12-03-12-01', 0, 'boatcast_oriten', '2025-12-03', 1, now())`), "本体の期間");
  const PROG = "INSERT INTO backfill_progress(source, unit_id, target_date, status, last_attempt_at)";
  assert.ok(await rejects(`${PROG} VALUES ('boatcast_oriten', '2025-06-14-12-01', '2025-06-14', 'no_file', NULL)`), "試したのに時刻なし");
  assert.equal(await rejects(`${PROG} VALUES ('boatcast_oriten', '2025-06-14-12-01', '2025-06-14', 'retry', now())`), false);
});

test("戻しと当て直し", async () => {
  await db.exec(ROLLBACK);
  assert.equal((await db.query("SELECT to_regclass('public.run_facts') AS t")).rows[0].t, null);
  await apply();
  assert.equal(await count("run_facts"), 0);
});
