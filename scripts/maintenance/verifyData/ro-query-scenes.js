/**
 * verify-ro-query.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-ro-query.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { upsertEnvLine } from "../../db/ro-setup.js";

let MIGRATION, check, rejects, freshDb;

async function scene1() {
  // (g) 166 の末尾の検査。どれも例外になり、claude_ro は作られない（全体が戻る）
  for (const [label, extraSql, pattern] of [
    [
      "PUBLIC が呼べる VOLATILE な SECURITY DEFINER 関数",
      `CREATE FUNCTION public.legacy_writer() RETURNS void LANGUAGE sql SECURITY DEFINER
       AS $$ DELETE FROM public.races $$;
     GRANT EXECUTE ON FUNCTION public.legacy_writer() TO PUBLIC;`,
      /legacy_writer/,
    ],
    [
      "STABLE な SECURITY DEFINER 関数（中で VOLATILE な関数を呼べば書ける）",
      `CREATE FUNCTION public.vw() RETURNS int LANGUAGE sql VOLATILE
       AS $$ INSERT INTO public.races VALUES ('LEAK', 'x') RETURNING 1 $$;
     REVOKE ALL ON FUNCTION public.vw() FROM PUBLIC;
     CREATE FUNCTION public.st() RETURNS int LANGUAGE sql STABLE SECURITY DEFINER
       AS $$ SELECT public.vw() $$;
     GRANT EXECUTE ON FUNCTION public.st() TO PUBLIC;`,
      /public\.st\(\)|st\(\)/,
    ],
    [
      "列単位の UPDATE の GRANT",
      "GRANT UPDATE (note) ON public.races TO PUBLIC;",
      /races\(UPDATE\)/,
    ],
    [
      "public 以外のスキーマの表への書き込み",
      `CREATE SCHEMA ext; GRANT USAGE ON SCHEMA ext TO PUBLIC;
     CREATE TABLE ext.t (x int); GRANT INSERT ON ext.t TO PUBLIC;`,
      /ext\.t\(INSERT\)/,
    ],
    [
      "public 以外のスキーマへの CREATE",
      "CREATE SCHEMA ext2; GRANT USAGE, CREATE ON SCHEMA ext2 TO PUBLIC;",
      /CREATE できるスキーマがある: ext2/,
    ],
    [
      "シーケンスの USAGE",
      "CREATE SEQUENCE public.s1; GRANT USAGE ON SEQUENCE public.s1 TO PUBLIC;",
      /シーケンス/,
    ],
    [
      "データベースの設定の秘密（値は出さない）",
      "ALTER DATABASE postgres SET app.settings.jwt_secret = 'super-secret-value';",
      /app\.settings\.jwt_secret/,
    ],
    [
      "許可リストの jwt_exp と並んでいても jwt_secret は止まる",
      `ALTER DATABASE postgres SET app.settings.jwt_exp = '3600';
     ALTER DATABASE postgres SET app.settings.jwt_secret = 'super-secret-value';`,
      /: app\.settings\.jwt_secret$/,
    ],
    [
      "許可リストは完全一致（jwt_exp で始まる別の名前は止まる）",
      "ALTER DATABASE postgres SET app.settings.jwt_exp_secret = 'x';",
      /app\.settings\.jwt_exp_secret/,
    ],
    [
      "全ロール向けの設定の秘密も止まる",
      "ALTER ROLE ALL SET app.settings.service_key = 'x';",
      /app\.settings\.service_key/,
    ],
  ]) {
    const db = await freshDb(extraSql);
    const r = await rejects(() => db.exec(MIGRATION));
    check(`166: 例外になる: ${label}`, r.rejected && pattern.test(r.message), r.message ?? "通った");
    if (/jwt_secret/.test(extraSql)) {
      check("166: 秘密の設定の値はエラーの文に出さない", !/super-secret-value/.test(r.message ?? ""));
    }
    await db.exec("ROLLBACK").catch(() => {});
    const exists = (
      await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='claude_ro'")
    ).rows[0].n;
    check(`166: 例外のとき claude_ro は作られない: ${label}`, exists === 0);
    await db.close();
  }
  {
    const db = await freshDb("GRANT CREATE ON SCHEMA public TO PUBLIC;");
    const r = await rejects(() => db.exec(MIGRATION));
    check(
      "166: PUBLIC が public に CREATE できれば例外",
      r.rejected && /CREATE できる/.test(r.message),
      r.message,
    );
    await db.close();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（MIGRATION・check・rejects・freshDb） */
export async function runRoQueryScenes1(env) {
  ({ MIGRATION, check, rejects, freshDb } = env);
  await scene1();
}

function scene2() {
  // ---------------------------------------------------------------------------
  // (i) .env.local の書き換え
  // ---------------------------------------------------------------------------
  check(
    "env: 無ければ末尾に足す",
    upsertEnvLine("A=1\n", "SUPABASE_RO_DB_URL=u", false) ===
      "A=1\nSUPABASE_RO_DB_URL=u\n",
  );
  check(
    "env: 改行の無い末尾にも足す",
    upsertEnvLine("A=1", "SUPABASE_RO_DB_URL=u", false) ===
      "A=1\nSUPABASE_RO_DB_URL=u\n",
  );
  check(
    "env: 既にあれば --force なしで止まる",
    upsertEnvLine("SUPABASE_RO_DB_URL=old\n", "SUPABASE_RO_DB_URL=u", false) ===
      null,
  );
  check(
    "env: --force なら置き換える",
    upsertEnvLine(
      "A=1\nSUPABASE_RO_DB_URL=old\nB=2\n",
      "SUPABASE_RO_DB_URL=u",
      true,
    ) === "A=1\nSUPABASE_RO_DB_URL=u\nB=2\n",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（MIGRATION・check・rejects・freshDb） */
export function runRoQueryScenes2(env) {
  ({ MIGRATION, check, rejects, freshDb } = env);
  scene2();
}
