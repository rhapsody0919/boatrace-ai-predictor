/**
 * verify-rls-migration.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-rls-migration.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

let TARGET_TABLES, check, as, WRITE_STATEMENTS, migrationSql, rollbackSql, db;

async function scene1() {
  // (f) 書き込み系RPC
  {
    const anon = await as(db, "anon", "SELECT public.update_venue_stats()");
    check(
      "(f) anon は update_venue_stats() を呼べない（権限エラー）",
      !anon.ok && anon.code === "42501",
      JSON.stringify(anon),
    );
    const svc = await as(
      db,
      "service_role",
      "SELECT public.update_venue_stats()",
    );
    check(
      "(f) service_role は update_venue_stats() を呼べる",
      svc.ok,
      JSON.stringify(svc),
    );
  }
  // (g) 既定権限
  {
    await db.exec(
      "CREATE TABLE public.future_table (id serial PRIMARY KEY, note text)",
    );
    const priv = await db.query(`
      SELECT has_table_privilege('anon', 'public.future_table', 'SELECT') AS a_sel,
             has_table_privilege('anon', 'public.future_table', 'INSERT') AS a_ins,
             has_table_privilege('authenticated', 'public.future_table', 'SELECT') AS u_sel,
             has_table_privilege('authenticated', 'public.future_table', 'INSERT') AS u_ins,
             has_table_privilege('service_role', 'public.future_table', 'INSERT') AS s_ins`);
    const p = priv.rows[0];
    check(
      "(g) 適用後に作る新規テーブルは、anon/authenticatedに権限が付かない（service_roleには付く）",
      !p.a_sel && !p.a_ins && !p.u_sel && !p.u_ins && p.s_ins,
      JSON.stringify(p),
    );
  }
  // (h) 再実行可能
  {
    let ok = true;
    let detail = "";
    try {
      await db.exec(migrationSql);
    } catch (e) {
      ok = false;
      detail = e.message;
    }
    check("(h) マイグレーションを2回適用しても失敗しない", ok, detail);
  }
  // (i) ロールバック
  {
    if (!rollbackSql) {
      check("(i) ロールバックSQLがマイグレーション末尾にある", false);
    } else {
      let ok = true;
      let detail = "";
      try {
        await db.exec(rollbackSql);
      } catch (e) {
        ok = false;
        detail = e.message;
      }
      check("(i) ロールバックSQLを適用できる", ok, detail);
      const back = [];
      for (const t of TARGET_TABLES) {
        const r = await as(db, "anon", WRITE_STATEMENTS(t).INSERT);
        if (!r.ok) back.push(t);
      }
      check(
        "(i) ロールバック後は適用前の状態に戻る（対象16テーブルにanonが書き込める）",
        back.length === 0,
        back.join(","),
      );
      const rls = await db.query(
        `
        SELECT count(*)::int AS n FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) AND relrowsecurity`,
        [TARGET_TABLES],
      );
      check("(i) ロールバック後は対象16テーブルのRLSが無効", rls.rows[0].n === 0);
      const opts = await db.query(`
        SELECT reloptions FROM pg_class
        WHERE relnamespace = 'public'::regnamespace AND relname = 'v_production_models'`);
      check(
        "(i) ロールバック後は security_invoker が解除される",
        !(opts.rows[0].reloptions ?? []).includes("security_invoker=true"),
        JSON.stringify(opts.rows[0]),
      );
    }
  }
  await db.close();
}

/** verify から呼ぶ入口。env は verify 側の束縛（TARGET_TABLES・check・as・WRITE_STATEMENTS・migrationSql・rollbackSql・db） */
export async function runRlsMigrationScenes1(env) {
  ({ TARGET_TABLES, check, as, WRITE_STATEMENTS, migrationSql, rollbackSql, db } = env);
  await scene1();
}
