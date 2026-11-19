/**
 * verify-eve-deadlines.js の後半の場面（2/2）。verify ではない。
 * 判定と期待値は分ける前の verify-eve-deadlines.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

let read, t;

function scene1() {
  // ---------- 202（PGlite） ----------

  t("202: race_id の CHECK・RLS・権限・ジョブの行", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE claude_ro BYPASSRLS;
      CREATE TABLE scrape_job_state (job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off',
        last_success_at TIMESTAMPTZ, last_tick_at TIMESTAMPTZ, updated_at TIMESTAMPTZ DEFAULT now());
      INSERT INTO scrape_job_state (job, mode) VALUES ('eve_deadlines', 'off');
      GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role, anon, authenticated;
    `);
    const sql = read("docs/db-migration/202_eve_race_deadlines.sql");
    await db.exec(sql);
    await db.exec(sql); // 2回当てても失敗しない
    const modes = (
      await db.query("SELECT job, mode FROM scrape_job_state ORDER BY job")
    ).rows;
    assert.deepEqual(modes, [
      { job: "eve_deadlines", mode: "live" },
      { job: "eve_deadlines_reconcile", mode: "live" },
    ]);
    // 手で off にして動いた後の行は上書きしない
    await db.exec(
      "UPDATE scrape_job_state SET mode='off', last_tick_at=now() WHERE job='eve_deadlines'",
    );
    await db.exec(sql);
    assert.equal(
      (
        await db.query(
          "SELECT mode FROM scrape_job_state WHERE job='eve_deadlines'",
        )
      ).rows[0].mode,
      "off",
    );

    const ins = (id, date, v, r) =>
      db.query(
        `INSERT INTO eve_race_deadlines (race_id, race_date, venue_code, race_number, deadline, first_fetched_at, updated_at)
         VALUES ($1, $2, $3, $4, '15:45:00', now(), now())`,
        [id, date, v, r],
      );
    await ins("2026-11-05-04-01", "2026-11-05", 4, 1);
    await assert.rejects(
      ins("2026-11-05-4-01", "2026-11-05", 4, 1),
      /race_id_shape/,
    );
    await assert.rejects(
      ins("2026-11-05-04-02", "2026-11-05", 4, 1),
      /race_id_shape/,
    );
    await assert.rejects(
      db.query(
        `UPDATE eve_race_deadlines SET day_mismatch = true WHERE race_id = '2026-11-05-04-01'`,
      ),
      /reconciled_pair/,
    );
    const priv = (
      await db.query(`SELECT
        has_table_privilege('anon', 'eve_race_deadlines', 'SELECT') AS anon_select,
        has_table_privilege('authenticated', 'eve_race_deadlines', 'SELECT') AS auth_select,
        has_table_privilege('claude_ro', 'eve_race_deadlines', 'SELECT') AS ro_select,
        has_table_privilege('claude_ro', 'eve_race_deadlines', 'UPDATE') AS ro_update,
        has_table_privilege('service_role', 'eve_race_deadlines', 'UPDATE') AS sr_update,
        has_table_privilege('service_role', 'eve_race_deadlines', 'DELETE') AS sr_delete,
        (SELECT relrowsecurity FROM pg_class WHERE relname = 'eve_race_deadlines') AS rls`)
    ).rows[0];
    assert.deepEqual(priv, {
      anon_select: false,
      auth_select: false,
      ro_select: true,
      ro_update: false,
      sr_update: true,
      sr_delete: false,
      rls: true,
    });
    await db.close();
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（read・t） */
export function runEveDeadlinesScenes5(env) {
  ({ read, t } = env);
  scene1();
}
