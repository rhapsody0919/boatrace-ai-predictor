/**
 * SNS の verify（sns-research-image・sns-x-slots・sns-full-picture・sns-finals-image）の before() に共通の、PGlite への土台の作りと migration の読み込み。verify ではない。
 * 3つの db.exec（roles・test_clock・scrape_job_state）→ extraSql（あれば）→ files の順に当てる。判定と期待値は変えない。
 * base は各 verify の import.meta.url（migration の道 ../../docs/db-migration/ は verify から見た道のまま）。
 */

import { readFile } from "node:fs/promises";

export async function setupSnsDb(db, { base, extraSql, files }) {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  if (extraSql) await db.exec(extraSql);
  for (const file of files)
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, base),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
}
