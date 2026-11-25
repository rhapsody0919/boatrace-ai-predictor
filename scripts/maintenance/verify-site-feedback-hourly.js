/**
 * verify-site-feedback-hourly.js - マイグレーション209（ご意見ボックスの時間ごとの件数 site_feedback_hourly）の検証。
 * PGlite に本番と同じロール・既定の権限を作り、208 を当ててから 209 を当てて次を確かめる。本番 DB には接続しない。
 *
 *   (a) 当てる前からある行を、時間ごとに数え直す。2回当てても同じ値
 *   (b) 受け付けた行ごとに、その時間の received が1増える
 *   (c) 拒否した送信（連投の制限・CHECK）は数えない
 *   (d) claude_ro は件数の表を読めて、ご意見の表は読めない。anon・authenticated は件数の表を読めない。RLS 有効
 *   (e) 戻しで表が消え、送信は 208 の形のまま通る
 *   (f) db-apply の検査で拒否が無い
 *   (g) 関数は 208 に足し込みだけを足した物・SECURITY DEFINER と権限・全体の上限と created_at が差し替えた後も効く・
 *       行を消してから2回目を当てても件数を下げない・UTC の正時で数える
 *
 * 実行: node scripts/maintenance/verify-site-feedback-hourly.js
 */
import { PGlite } from "@electric-sql/pglite";
import { classifyMigration, inspectMigration } from "../lib/dbApplySql.js";
import {
  BASE,
  FIXTURE_SQL,
  asRole,
  insert,
  key,
  readSiteFeedbackMigration,
} from "./verifyData/site-feedback-migration.js";
import { readSiteFeedbackHourlyMigration } from "./verifyData/site-feedback-hourly.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`[OK] ${label}`);
  else {
    failures++;
    console.error(`[NG] ${label}${detail ? `: ${detail}` : ""}`);
  }
}

const { sql: sql208 } = readSiteFeedbackMigration();
const { sql, rollbackSql } = readSiteFeedbackHourlyMigration();
const db = new PGlite();
await db.exec(FIXTURE_SQL);
await db.exec(sql208);

const hourly = async () =>
  (
    await db.query(
      "SELECT to_char(hour AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24') AS h, received FROM public.site_feedback_hourly ORDER BY hour",
    )
  ).rows.map((r) => `${r.h}=${r.received}`);
const nowHourReceived = async () =>
  Number(
    (
      await db.query(
        "SELECT coalesce((SELECT received FROM public.site_feedback_hourly WHERE hour = date_trunc('hour', now())), 0) AS n",
      )
    ).rows[0].n,
  );

// (a) 当てる前の行: 今の時間に2行、ちょうど2日前の時間に1行
await asRole(db, "anon", insert({ ...BASE, client_key: key(1) }));
await asRole(db, "anon", insert({ ...BASE, client_key: key(2) }));
await asRole(db, "anon", insert({ ...BASE, client_key: key(3) }));
await db.exec(
  `UPDATE public.site_feedback SET created_at = date_trunc('hour', now()) - interval '48 hours' WHERE client_key = '${key(3)}'`,
);
await db.exec(sql);
const first = await hourly();
check(
  "(a) 当てる前からある行を時間ごとに数え直す（2日前の時間に1、今の時間に2）",
  first.length === 2 && first[0].endsWith("=1") && first[1].endsWith("=2"),
  JSON.stringify(first),
);
await db.exec(sql);
check(
  "(a) 2回当てても同じ値",
  JSON.stringify(await hourly()) === JSON.stringify(first),
  JSON.stringify(await hourly()),
);

// (b) 受け付けた行ごとに1増える
check(
  "(b) anon の送信で今の時間の received が1増える",
  (await asRole(db, "anon", insert({ ...BASE, client_key: key(4) }))) ===
    null && (await nowHourReceived()) === 3,
  String(await nowHourReceived()),
);
check(
  "(b) authenticated の送信も数える",
  (await asRole(
    db,
    "authenticated",
    insert({ ...BASE, client_key: key(5) }),
  )) === null && (await nowHourReceived()) === 4,
);

// (c) 拒否した送信は数えない
{
  const err = await asRole(
    db,
    "anon",
    insert({ ...BASE, client_key: key(6), comment: "あ".repeat(501) }),
  );
  check(
    "(c) CHECK で落ちた送信（501字）は数えない",
    err !== null && (await nowHourReceived()) === 4,
    err?.message,
  );
  for (let i = 0; i < 10; i++)
    await asRole(db, "anon", insert({ ...BASE, client_key: key(7) }));
  const before = await nowHourReceived();
  const limited = await asRole(
    db,
    "anon",
    insert({ ...BASE, client_key: key(7) }),
  );
  check(
    "(c) 連投の制限で落ちた送信は数えない",
    limited !== null &&
      /too many/.test(limited.message) &&
      (await nowHourReceived()) === before,
    limited?.message ?? "通ってしまった",
  );
}

// (d) 権限
{
  const p = await db.query(`SELECT
    has_table_privilege('claude_ro', 'public.site_feedback_hourly', 'SELECT') AS ro_hourly,
    has_table_privilege('claude_ro', 'public.site_feedback', 'SELECT') AS ro_feedback,
    has_table_privilege('anon', 'public.site_feedback_hourly', 'SELECT') AS anon_hourly,
    has_table_privilege('authenticated', 'public.site_feedback_hourly', 'SELECT') AS auth_hourly,
    has_table_privilege('anon', 'public.site_feedback_hourly', 'INSERT') AS anon_insert,
    (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.site_feedback_hourly'::regclass) AS rls`);
  const r = p.rows[0];
  check(
    "(d) claude_ro は件数の表を読めて、ご意見の表は読めない",
    r.ro_hourly === true && r.ro_feedback === false,
    JSON.stringify(r),
  );
  check(
    "(d) claude_ro の SELECT が実際に通る",
    (await asRole(
      db,
      "claude_ro",
      "SELECT * FROM public.site_feedback_hourly",
    )) === null,
  );
  check(
    "(d) anon・authenticated は件数の表を読めず書けない。RLS 有効",
    r.anon_hourly === false &&
      r.auth_hourly === false &&
      r.anon_insert === false &&
      r.rls === true,
    JSON.stringify(r),
  );
}

// (g) 差し替えた関数（system-architect の審査 2026-11-25）
{
  const body = (src) =>
    src.slice(
      src.indexOf("CREATE OR REPLACE FUNCTION public.site_feedback_guard()"),
      src.indexOf("$$;", src.indexOf("AS $$")) + 3,
    );
  const added = body(sql)
    .split("\n")
    .filter(
      (l) =>
        !/site_feedback_hourly|VALUES \(date_trunc|ON CONFLICT \(hour\)|受け付けた数だけ/.test(
          l,
        ),
    )
    .join("\n");
  check(
    "(g) 209 の関数は、208 の本文に件数の足し込みだけを足した物",
    added === body(sql208),
  );
  const fn = (
    await db.query(
      "SELECT prosecdef, proconfig, has_function_privilege('claude_ro', oid, 'EXECUTE') AS ro, has_function_privilege('anon', oid, 'EXECUTE') AS anon FROM pg_proc WHERE oid = 'public.site_feedback_guard()'::regprocedure",
    )
  ).rows[0];
  check(
    "(g) 差し替えた後も SECURITY DEFINER・search_path 固定・claude_ro と anon は EXECUTE できない",
    fn.prosecdef === true &&
      JSON.stringify(fn.proconfig) ===
        JSON.stringify(["search_path=public, pg_temp"]) &&
      fn.ro === false &&
      fn.anon === false,
    JSON.stringify(fn),
  );
  // 行を消してから2回目を当てても、受け付けた数を下げない。
  // 行の created_at を動かす下の確かめより先に行う（前の時間帯へずらすと、2回目の数え直しがその時間を新しく足し、
  // 毎時0〜10分に走ると結果が変わった。2026-11-25 master で赤）
  const before = JSON.stringify(await hourly());
  // 一部だけ消す（全部消すと数え直しが何もせず、確かめにならない）
  await db.exec(
    `DELETE FROM public.site_feedback WHERE client_key = '${key(7)}'`,
  );
  await db.exec(sql);
  check(
    "(g) 行を消してから2回目を当てても、件数は変わらない",
    JSON.stringify(await hourly()) === before,
    JSON.stringify(await hourly()),
  );
  // 全体の上限と created_at の上書きも、差し替えた後に効く
  await db.exec(
    "UPDATE public.site_feedback SET created_at = now() - interval '11 minutes'",
  );
  let overall = null;
  for (let i = 0; i < 31 && overall === null; i++)
    overall = await asRole(
      db,
      "anon",
      insert({ ...BASE, client_key: key(100 + i) }),
    );
  check(
    "(g) 差し替えた後も全体の10分30行が効く",
    overall !== null && /too many overall/.test(overall.message),
    overall?.message ?? "通ってしまった",
  );
  const fresh = await db.query(
    "SELECT bool_and(created_at > now() - interval '1 minute') AS ok FROM public.site_feedback WHERE client_key::text LIKE '00000000-0000-4000-8000-0000000001%'",
  );
  check("(g) created_at は now() のまま", fresh.rows[0].ok === true);
  // セッションの TimeZone に依らず UTC の時間で数える
  await db.exec("SET TIME ZONE 'Asia/Kolkata'");
  await asRole(db, "anon", insert({ ...BASE, client_key: key(900) }));
  const odd = await db.query(
    "SELECT count(*)::int AS n FROM public.site_feedback_hourly WHERE extract(minute FROM hour AT TIME ZONE 'UTC') <> 0",
  );
  await db.exec("SET TIME ZONE 'UTC'");
  check("(g) +5:30 のセッションでも時間は UTC の正時", odd.rows[0].n === 0);
}

// (e) 戻し
// (g) で全体の上限まで入れたので、制限の窓の外へずらしてから戻しを確かめる
await db.exec(
  "UPDATE public.site_feedback SET created_at = now() - interval '25 hours'",
);
check("(e) 戻しの SQL がある", !!rollbackSql?.includes("DROP TABLE"));
await db.exec(rollbackSql);
check(
  "(e) 戻しで件数の表が消える",
  (await db.query("SELECT to_regclass('public.site_feedback_hourly') AS t"))
    .rows[0].t === null,
);
check(
  "(e) 戻した後も送信は 208 の形で通る",
  (await asRole(db, "anon", insert({ ...BASE, client_key: key(8) }))) === null,
);

// (f) db-apply の検査
{
  const inspection = inspectMigration(sql);
  check(
    "(f) db-apply の検査で拒否が無く、ファイル自身の BEGIN〜COMMIT で1つのトランザクション",
    inspection.rejections.length === 0 &&
      inspection.mode === "file-transaction",
    JSON.stringify({
      rejections: inspection.rejections,
      mode: inspection.mode,
    }),
  );
  const lane = classifyMigration(sql, "209_site_feedback_hourly.sql");
  check(
    "(f) 止める理由が無い",
    lane.stops.length === 0,
    JSON.stringify({ label: lane.label, stops: lane.stops }),
  );
  console.log(
    `    （db-apply の分け: ${lane.label}・触る表 ${JSON.stringify(inspection.tables.map((t) => t.table))}）`,
  );
}

await db.close();
if (failures > 0) {
  console.error(`\nverify-site-feedback-hourly: NG（${failures} 件）`);
  process.exit(1);
}
console.log("\nverify-site-feedback-hourly: OK");
