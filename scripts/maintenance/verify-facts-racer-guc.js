// facts の表の絞りの設定（boatai.facts_racer_id）を立てられるのが get_racer_runs だけであることを守る（ADR-0113 決定4 の verify (a)〜(e)）
// RLS の式は1トランザクションに1選手しか通さないので、ほかの関数が同じ設定を立てても出る量は1選手までだが、立てる道そのものを作らない。
//   (a) マイグレーション（注釈を除く）で boatai.facts_racer_id が出てよいのは、get_racer_runs の定義・run_facts と race_facts のポリシー・COMMENT だけ
//   (b) SET [LOCAL] boatai.〜 の文、ALTER ROLE|DATABASE … SET boatai.〜、関数の SET 句は全て NG（関数の SET 句は本番の postgres が作れない。212 の db-apply の失敗 2026-11-27）
//   (c) 関数の定義の中で set_config の第1引数が文字列の直書きでない物は NG（動的な名前で同じ設定を立てられる）
//   (d) get_racer_runs は SECURITY INVOKER で、set_config('boatai.facts_racer_id', …, true) で立て、読んだ後に set_config(…, '', true) で空に戻す
//   (e) docs/reference/schema-snapshot.json の関数の定義・設定も (a)〜(c) と同じ規則で照らす（マイグレーションの外で作られた関数も拾う）
// 外部接続なし。読むのは docs/db-migration/*.sql と docs/reference/schema-snapshot.json だけ（verifyData/race-facts-migration-files.js）
import assert from "node:assert/strict";
import { readAllMigrations, readSnapshotFunctions } from "./verifyData/race-facts-migration-files.js";
import { checkSql, snapshotFunctionErrors, splitTopLevel, statementErrors } from "../lib/factsRacerGucRules.js";

// 規則そのものの確かめ（scripts/lib/factsRacerGucRules.js の変異を落とす）
const OK_FN = `CREATE OR REPLACE FUNCTION public.get_racer_runs(p integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
  AS $$ BEGIN PERFORM set_config('boatai.facts_racer_id', p::text, true); PERFORM set_config('boatai.facts_racer_id', '', true); RETURN '[]'; END; $$;`;
assert.deepEqual(checkSql(OK_FN, "見本").errors, []);
assert.equal(checkSql(OK_FN, "見本").racerRuns, 1);
assert.equal(checkSql(OK_FN.replace("INVOKER", "DEFINER"), "x").errors.length, 2);
assert.equal(checkSql(OK_FN.replace("p::text, true)", "p::text, false)"), "x").errors.length, 2);
assert.equal(checkSql(OK_FN.replace("'', true)", "'', false)"), "x").errors.length, 2);
assert.equal(checkSql(OK_FN.replace("PERFORM set_config('boatai.facts_racer_id', '', true); ", ""), "x").errors.length, 1);
assert.equal(checkSql(OK_FN.replace("SECURITY INVOKER\n  AS", "SECURITY INVOKER\n  SET boatai.facts_racer_id = '' AS"), "x").errors.length, 1);
assert.equal(checkSql("CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT set_config('boatai.facts_racer_id', '1', true) $$;", "x").errors.length, 1);
assert.equal(checkSql("CREATE FUNCTION f(n text) RETURNS void LANGUAGE sql AS $$ SELECT set_config(n, '1', true) $$;", "x").errors.length, 1);
assert.equal(checkSql("SET LOCAL boatai.facts_racer_id = '3';", "x").errors.length, 2);
assert.equal(checkSql("ALTER ROLE anon SET boatai.x = '3';", "x").errors.length, 1);
assert.deepEqual(checkSql("-- boatai.facts_racer_id は注釈なら書いてよい\nCOMMENT ON TABLE t IS 'boatai.facts_racer_id';", "x").errors, []);
assert.deepEqual(
  checkSql("CREATE POLICY p ON public.run_facts FOR SELECT USING (racer_id = nullif(current_setting('boatai.facts_racer_id', true), '')::integer);", "x").errors,
  [],
);
assert.equal(checkSql("CREATE POLICY p ON public.races FOR SELECT USING (current_setting('boatai.facts_racer_id', true) = '1');", "x").errors.length, 1);
assert.deepEqual(
  snapshotFunctionErrors([
    { name: "f", definition: ["CREATE FUNCTION f() RETURNS void LANGUAGE sql AS $$ SELECT set_config('boatai.facts_racer_id', '1', true) $$"], config: [] },
    { name: "g", definition: "CREATE FUNCTION g() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$", config: ["boatai.x=1"] },
    { name: "get_racer_runs", definition: ["SET LOCAL boatai.facts_racer_id = 1"], config: ["boatai.facts_racer_id="] },
  ]).length,
  2,
);
assert.deepEqual(statementErrors("SELECT 1", "x"), []);
assert.deepEqual(splitTopLevel("SELECT ';'; SELECT $a$ ; $a$; /* ; */ SELECT 1"), ["SELECT ';'", "SELECT $a$ ; $a$", "SELECT 1"]);

// (a)〜(d): マイグレーション
const errors = [];
let racerRuns = 0;
for (const [file, text] of readAllMigrations()) {
  const r = checkSql(text, file);
  errors.push(...r.errors);
  racerRuns += r.racerRuns;
}
assert.ok(racerRuns >= 1, "get_racer_runs の定義がマイグレーションに無い");

// (e): 写しの関数
errors.push(...snapshotFunctionErrors(readSnapshotFunctions()));

assert.deepEqual(errors, [], errors.join("\n"));
console.log(`verify-facts-racer-guc: OK（get_racer_runs の定義 ${racerRuns}）`);
