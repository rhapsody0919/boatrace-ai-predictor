/**
 * verify-db-apply.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-db-apply.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import path from "node:path";
import { psqlArgs, classifyMigration } from "../../lib/dbApplySql.js";
import { dbApplyClassify1 } from "./db-apply-scenes-2.js";

let ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4;

/** { の中身を割った 3/3 */
function dbApplyClassify3({ big, summaryOf }) {
  const bigSummary = summaryOf(big);
  check(
    "本文: 既存の最長のマイグレーション（001）を切り詰めない",
    bigSummary.includes("### 本文\n") &&
      bigSummary.includes(big.trimEnd().split("\n").at(-1)),
  );
}

// 12. 実ファイルのラベルの一覧
/** { の中身を割った 1/5 */
function dbApplyLabels1() {
  const dir = path.join(ROOT, "docs/db-migration");
  return { dir };
}

/** { の中身を割った 3/5 */
function dbApplyLabels3() {
  const diffs = [];
  return { diffs };
}

/** { の中身を割った 5/5 */
function dbApplyLabels5({ diffs }) {
  check(
    "実ファイルのラベルが一覧（db-apply-labels.json）と一致する",
    diffs.length === 0,
    diffs.join("; "),
  );
}

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const label = (sql, file = "900_x.sql") => classifyMigration(sql, file).label;
  const NEW_TABLE = `CREATE TABLE IF NOT EXISTS public.t (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  race_id text NOT NULL REFERENCES races(id) ON DELETE CASCADE,
  score numeric(5,2) CHECK (score >= 0),
  note varchar(200) CHECK (char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (race_id)
);`;
  const lights = {
    "CREATE TABLE（既定値は now・制約・REFERENCES）": NEW_TABLE,
    "BEGIN〜COMMIT で包んだ新しい表一式": `BEGIN;
SET LOCAL lock_timeout = '5s';
${NEW_TABLE}
COMMENT ON TABLE public.t IS 'x';
COMMENT ON COLUMN public.t.score IS 'x';
CREATE INDEX IF NOT EXISTS t_race_idx ON public.t (race_id DESC NULLS LAST) WHERE score IS NOT NULL;
ALTER TABLE public.t ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_read ON public.t FOR SELECT TO anon, authenticated USING (true);
REVOKE ALL ON public.t FROM claude_ro;
NOTIFY pgrst, 'reload schema';
COMMIT;`,
    "既存の表への ADD COLUMN（既定値・NOT NULL なし）": "ALTER TABLE races ADD COLUMN IF NOT EXISTS memo text, ADD COLUMN x numeric(4,1);",
    "既存の表への CREATE INDEX": "CREATE UNIQUE INDEX IF NOT EXISTS a_idx ON race_entries USING btree (race_id, boat_number);",
  };
  for (const [name, sql] of Object.entries(lights)) {
    const r = classifyMigration(sql, "900_x.sql");
    check(`軽い: ${name}`, r.label === "light", JSON.stringify(r.statements.filter((x) => x.kind === "heavy")));
  }
  const bak = (t) => `CREATE TABLE db_backup._bak_900_${t} AS TABLE ${t};\n`;
  return { label, NEW_TABLE, bak };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ label, NEW_TABLE, bak }) {
  const heavies = {
    "CREATE OR REPLACE FUNCTION": "CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    "CREATE FUNCTION": "CREATE FUNCTION f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;",
    "DO ブロック": "DO $$ BEGIN DELETE FROM races; END $$;",
    "DROP TABLE（控えあり）": `${bak("t")}DROP TABLE t;`,
    "DROP COLUMN（控えあり）": `${bak("t")}ALTER TABLE t DROP COLUMN c;`,
    "COLUMN を省いた DROP（控えあり）": `${bak("t")}ALTER TABLE t DROP c;`,
    "TRUNCATE（控えあり）": `${bak("t")}TRUNCATE t;`,
    "DELETE（控えあり）": `${bak("t")}DELETE FROM t WHERE true;`,
    "DROP FUNCTION": "DROP FUNCTION IF EXISTS f();",
    "DROP POLICY": "DROP POLICY IF EXISTS p ON t;",
    "DROP TRIGGER": "DROP TRIGGER IF EXISTS g ON t;",
    "DROP INDEX": "DROP INDEX IF EXISTS i;",
    "DROP CONSTRAINT": "ALTER TABLE t DROP CONSTRAINT c;",
    "DROP VIEW": "DROP VIEW IF EXISTS v;",
    "DISABLE TRIGGER": "ALTER TABLE t DISABLE TRIGGER ALL;",
    "RENAME": "ALTER TABLE t RENAME TO u;",
    "RENAME COLUMN": "ALTER TABLE t RENAME COLUMN a TO b;",
    "UPDATE": "UPDATE t SET a = 1 WHERE true;",
    "MERGE": "MERGE INTO t USING u ON t.id = u.id WHEN MATCHED THEN UPDATE SET a = u.a;",
    "INSERT": "INSERT INTO t (a) VALUES (1);",
    "ON CONFLICT DO UPDATE": "INSERT INTO t (a) VALUES (1) ON CONFLICT (a) DO UPDATE SET a = excluded.a;",
    "型の変更": "ALTER TABLE t ALTER COLUMN a TYPE bigint;",
    "GRANT": "GRANT SELECT ON t TO anon;",
    "ALTER DEFAULT PRIVILEGES": "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;",
    "RLS の無効": "ALTER TABLE t DISABLE ROW LEVEL SECURITY;",
    "既存の表の ENABLE RLS": "ALTER TABLE races ENABLE ROW LEVEL SECURITY;",
    "既存の表の REVOKE": "REVOKE SELECT ON races FROM anon;",
    "REVOKE ON FUNCTION": "REVOKE ALL ON FUNCTION f() FROM PUBLIC;",
    "REVOKE ON ALL TABLES": "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;",
    "書き込みの policy": `${NEW_TABLE}\nCREATE POLICY w ON public.t FOR INSERT TO anon WITH CHECK (true);`,
    "FOR を省いた policy（ALL）": `${NEW_TABLE}\nCREATE POLICY w ON public.t TO anon USING (true);`,
    "既存の表の SELECT policy": "CREATE POLICY r ON races FOR SELECT USING (true);",
    "policy の USING で関数": `${NEW_TABLE}\nCREATE POLICY r ON public.t FOR SELECT USING (f(id));`,
    "CREATE RULE": "CREATE RULE r AS ON INSERT TO t DO INSTEAD NOTHING;",
    "CREATE TRIGGER": "CREATE TRIGGER g AFTER INSERT ON t FOR EACH ROW EXECUTE FUNCTION f();",
    "CREATE EXTENSION": "CREATE EXTENSION IF NOT EXISTS pg_cron;",
    "ALTER ROLE": "ALTER ROLE claude_ro SET statement_timeout = '0';",
    "SET ROLE": "SET ROLE postgres;",
    "SET LOCAL の上限超え": "SET LOCAL statement_timeout = '30min';",
    "最上位の SELECT fn()": "SELECT f();",
    "CALL": "CALL p();",
    "CREATE TABLE AS": "CREATE TABLE u AS SELECT * FROM t;",
    "MATERIALIZED VIEW": "CREATE MATERIALIZED VIEW m AS SELECT 1;",
    "CREATE VIEW": "CREATE VIEW v AS SELECT 1;",
    "関数を呼ぶ DEFAULT": "CREATE TABLE t (a int DEFAULT f());",
    "関数を呼ぶ CHECK": "CREATE TABLE t (a int CHECK (f(a)));",
    "nextval の DEFAULT": "CREATE TABLE t (a int DEFAULT nextval('s'));",
    "ADD COLUMN の DEFAULT": "ALTER TABLE t ADD COLUMN a int DEFAULT 0;",
    "ADD COLUMN の NOT NULL": "ALTER TABLE t ADD COLUMN a int NOT NULL;",
    "COLUMN を省いた ADD": "ALTER TABLE t ADD a int;",
    "ADD CONSTRAINT": "ALTER TABLE t ADD CONSTRAINT c CHECK (a > 0);",
    "式の索引": "CREATE INDEX i ON t ((lower(a)));",
    "索引の WHERE で関数": "CREATE INDEX i ON t (a) WHERE f(a);",
    "public 以外の表": "CREATE TABLE other.t (a int);",
    "LIKE で作る表": "CREATE TABLE t (LIKE u INCLUDING ALL);",
    "除外マーカー": `${NEW_TABLE}\n-- rls-exempt: t 理由`,
    "SECURITY DEFINER": "CREATE FUNCTION f() RETURNS int LANGUAGE sql SECURITY DEFINER AS $$ SELECT 1 $$;",
    "ALTER FUNCTION": "ALTER FUNCTION f() SECURITY DEFINER;",
    "CREATE SCHEMA": "CREATE SCHEMA db_backup;",
    "SET LOCAL の 0（無制限）": "SET LOCAL statement_timeout = '0';",
    "SET LOCAL lock_timeout の 0": "SET LOCAL lock_timeout = 0;",
    "ADD COLUMN の serial": "ALTER TABLE t ADD COLUMN seq bigserial;",
    "ADD COLUMN の serial4": "ALTER TABLE t ADD COLUMN seq serial4;",
    "public. を付けた同名の関数": "CREATE TABLE t (a text CHECK (public.lower(a) = a));",
    "DROP TYPE（CASCADE なし）": "DROP TYPE IF EXISTS race_grade;",
  };
  for (const [name, sql] of Object.entries(heavies)) {
    check(`重い: ${name}`, label(sql) === "heavy", label(sql));
  }
  return { label, bak };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ label, bak }) {
  const stops = {
    "DROP TABLE（控えなし）": "DROP TABLE t;",
    "DELETE（控えなし）": "DELETE FROM t WHERE id = 1;",
    "TRUNCATE（控えなし）": "TRUNCATE t;",
    "DROP COLUMN（控えなし）": "ALTER TABLE t DROP COLUMN c;",
    "COLUMN を省いた DROP（控えなし）": "ALTER TABLE t DROP c;",
    "控えの名前が番号と違う": "CREATE TABLE db_backup._bak_899_t AS TABLE t;\nDROP TABLE t;",
    "控えが消す文より後": "DROP TABLE t;\nCREATE TABLE db_backup._bak_900_t AS TABLE t;",
    "控えが別の表": `${bak("u")}DROP TABLE t;`,
    "DROP COLUMN の控えに列が無い": "CREATE TABLE db_backup._bak_900_t AS SELECT id, a FROM t;\nALTER TABLE t DROP COLUMN c;",
    "個人情報らしい列（CREATE TABLE）": "CREATE TABLE t (id int, user_email text);",
    "個人情報らしい列（ADD COLUMN）": "ALTER TABLE t ADD COLUMN phone_number text;",
    "個人情報らしい列（生年月日）": "ALTER TABLE t ADD COLUMN birth_date date;",
    "適用できない文（CONCURRENTLY）": "CREATE INDEX CONCURRENTLY i ON t (a);",
    "途中の BEGIN": "SELECT 1;\nBEGIN;\nCOMMIT;",
    "DROP TYPE … CASCADE（列ごと消える）": "DROP TYPE race_grade CASCADE;",
    "DROP SCHEMA … CASCADE": "DROP SCHEMA old CASCADE;",
    "DROP OWNED": "DROP OWNED BY someone;",
  };
  for (const [name, sql] of Object.entries(stops)) {
    check(`止める: ${name}`, label(sql) === "stop", label(sql));
  }
  check(
    "控えの列に消す列があれば DROP COLUMN は止めない（重い）",
    label("CREATE TABLE db_backup._bak_900_t AS SELECT id, c FROM t;\nALTER TABLE t DROP COLUMN c;") === "heavy",
  );
  check(
    "no-backup のマーカーで控えの要求を外せる（重い）",
    label("-- db-apply: no-backup sns_oauth_tokens 暗号文を控えに写さない\nDROP TABLE sns_oauth_tokens;") === "heavy",
  );
  check("控えの表を消すのに控えは要らない（重い）", label("DROP TABLE IF EXISTS db_backup._bak_163_x;") === "heavy");
  check("racer_name・zipcount は個人情報にしない", label("ALTER TABLE t ADD COLUMN racer_name text, ADD COLUMN zipcount int;") === "light");
  check(
    "文字列・コメントの中の語で判定しない",
    label("COMMENT ON TABLE t IS 'DROP TABLE races; GRANT ALL';\n-- DELETE FROM races;\nALTER TABLE t ADD COLUMN memo text;") === "light",
  );
  const r = classifyMigration("BEGIN;\nGRANT SELECT ON t TO anon;\nCOMMIT;", "900_x.sql");
  check("重いの理由に行番号と文が出る", r.statements.some((x) => x.kind === "heavy" && x.line === 2 && /GRANT/.test(x.reason)), JSON.stringify(r.statements));
}

function scene4() {
  {
    const { summaryOf } = dbApplyClassify1();
    const { big } = dbApplyClassify2();
    dbApplyClassify3({ big, summaryOf });
  }
  // 10. psql の引数
  {
    const single = psqlArgs("single-transaction", "docs/db-migration/999_x.sql");
    const file = psqlArgs("file-transaction", "docs/db-migration/999_x.sql");
    const idx = (args, needle) => args.findIndex((a) => a.includes(needle));
    for (const [label, args] of [
      ["single-transaction", single],
      ["file-transaction", file],
    ]) {
      check(
        `${label}: lock_timeout・statement_timeout を -f より前に設定する`,
        idx(args, "lock_timeout") !== -1 &&
          idx(args, "statement_timeout") !== -1 &&
          idx(args, "lock_timeout") < args.indexOf("-f") &&
          idx(args, "statement_timeout") < args.indexOf("-f"),
        args.join(" "),
      );
      check(
        `${label}: ON_ERROR_STOP=1 と -X`,
        args.includes("ON_ERROR_STOP=1") && args.includes("-X"),
      );
      check(`${label}: 最後がファイル`, args.at(-1) === "docs/db-migration/999_x.sql");
    }
    check(
      "--single-transaction は single-transaction のときだけ",
      single.includes("--single-transaction") &&
        !file.includes("--single-transaction"),
    );
  }
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・dbApplyClassify2・dbApplyLabels2・dbApplyLabels4） */
export function runDbApplyScenes15(env) {
  ({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 } = env);
  scene4();
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・dbApplyClassify2・dbApplyLabels2・dbApplyLabels4） */
export function runDbApplyScenes16(env) {
  ({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 } = env);

}

function scene5() {
  {
    const { dir } = dbApplyLabels1();
    const { expected } = dbApplyLabels2();
    const { diffs } = dbApplyLabels3();
    dbApplyLabels4({ diffs, dir, expected });
    dbApplyLabels5({ diffs });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・dbApplyClassify2・dbApplyLabels2・dbApplyLabels4） */
export function runDbApplyScenes17(env) {
  ({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 } = env);
  scene5();
}
