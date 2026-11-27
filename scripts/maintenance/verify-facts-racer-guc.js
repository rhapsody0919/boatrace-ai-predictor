// facts の表の絞りの設定（boatai.facts_racer_id）を立てられるのが get_racer_runs だけであることを守る（ADR-0113 決定4 の verify (a)〜(e)）
// RLS の式は1トランザクションに1選手しか通さないので、ほかの関数が同じ設定を立てても出る量は1選手までだが、立てる道そのものを作らない。
//   (a) マイグレーション（注釈を除く）で boatai.facts_racer_id が出てよいのは、get_racer_runs の定義・run_facts と race_facts のポリシー・COMMENT だけ
//   (b) SET [LOCAL] boatai.〜 の文、ALTER ROLE|DATABASE … SET boatai.〜 は全て NG（get_racer_runs の定義の SET 句は除く）
//   (c) 関数の定義の中で set_config の第1引数が文字列の直書きでない物は NG（動的な名前で同じ設定を立てられる）
//   (d) get_racer_runs は SECURITY INVOKER で、SET boatai.facts_racer_id = '' の句と set_config('boatai.facts_racer_id', …, true) を持つ
//   (e) docs/reference/schema-snapshot.json の関数の定義・設定も (a)〜(c) と同じ規則で照らす（マイグレーションの外で作られた関数も拾う）
// 外部接続なし。読むのは docs/db-migration/*.sql と docs/reference/schema-snapshot.json だけ（verifyData/race-facts-migration-files.js）
import assert from "node:assert/strict";
import { readAllMigrations, readSnapshotFunctions } from "./verifyData/race-facts-migration-files.js";

const GUC = "boatai.facts_racer_id";

/** 注釈（-- と /* *\/）を空白にする。文字列（'…'）と $タグ$ の中は残す */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'") {
      const end = sql.indexOf("'", i + 1);
      const stop = end < 0 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop;
    } else if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (!tag) {
        out += c;
        i += 1;
        continue;
      }
      const end = sql.indexOf(tag[0], i + tag[0].length);
      const stop = end < 0 ? sql.length : end + tag[0].length;
      out += sql.slice(i, stop);
      i = stop;
    } else if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
    } else if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** 注釈を除いた SQL を、文字列と $ 引用の外の ; で文に分ける */
export function splitTopLevel(sql) {
  const text = stripComments(sql);
  const out = [];
  let cur = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const tag = c === "$" ? /^\$[A-Za-z_]*\$/.exec(text.slice(i)) : null;
    if (c === "'" || tag) {
      const q = tag ? tag[0] : "'";
      const end = text.indexOf(q, i + q.length);
      const stop = end < 0 ? text.length : end + q.length;
      cur += text.slice(i, stop);
      i = stop;
    } else if (c === ";") {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      i += 1;
    } else {
      cur += c;
      i += 1;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const RACER_RUNS = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?get_racer_runs\s*\(/i;
const FACTS_POLICY = /^CREATE\s+POLICY\s+\w+\s+ON\s+(?:public\.)?(?:run_facts|race_facts)\b/i;
const COMMENT = /^COMMENT\s+ON\b/i;
const FUNCTION = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i;

/** 1つの文の違反（文字列の配列）。where は報告に使う場所の名前 */
export function statementErrors(stmt, where) {
  const errors = [];
  const isRacerRuns = RACER_RUNS.test(stmt);
  if (stmt.includes(GUC) && !isRacerRuns && !FACTS_POLICY.test(stmt) && !COMMENT.test(stmt)) {
    errors.push(`${where}: ${GUC} は get_racer_runs とファクトの表のポリシーの外で使わない`);
  }
  const isAlterDefault = /^ALTER\s+(?:ROLE|DATABASE|USER)\b[\s\S]*\bSET\s+"?boatai\./i.test(stmt);
  if (isAlterDefault) {
    errors.push(`${where}: ロール・DB の既定で boatai.〜 を立てない`);
  } else if (!isRacerRuns && /(?:^|\s)SET\s+(?:LOCAL\s+|SESSION\s+)?"?boatai\./i.test(stmt)) {
    errors.push(`${where}: boatai.〜 を SET で立てない`);
  }
  if (FUNCTION.test(stmt) && /set_config\s*\(\s*(?!')/i.test(stmt)) {
    errors.push(`${where}: set_config の第1引数は文字列の直書きにする`);
  }
  return errors;
}

/** get_racer_runs の定義が決定4 の形か（違反の配列） */
export function racerRunsErrors(stmt) {
  const errors = [];
  if (/\bSECURITY\s+DEFINER\b/i.test(stmt)) errors.push("get_racer_runs: SECURITY DEFINER にしない");
  if (!/\bSECURITY\s+INVOKER\b/i.test(stmt)) errors.push("get_racer_runs: SECURITY INVOKER を明示する");
  if (!new RegExp(`\\bSET\\s+${GUC.replace(".", "\\.")}\\s*(?:=|TO)\\s*''`, "i").test(stmt)) {
    errors.push(`get_racer_runs: SET ${GUC} = '' の句で関数の中に閉じる`);
  }
  if (!new RegExp(`set_config\\s*\\(\\s*'${GUC.replace(".", "\\.")}'\\s*,[^;]*?,\\s*true\\s*\\)`, "i").test(stmt)) {
    errors.push(`get_racer_runs: set_config('${GUC}', …, true) で立てる（第3引数は true）`);
  }
  return errors;
}

/** SQL の全文の違反と、get_racer_runs の定義の数 */
export function checkSql(sql, where) {
  const errors = [];
  let racerRuns = 0;
  splitTopLevel(sql).forEach((stmt, i) => {
    errors.push(...statementErrors(stmt, `${where} の ${i + 1} 文目`));
    if (RACER_RUNS.test(stmt)) {
      racerRuns += 1;
      errors.push(...racerRunsErrors(stmt).map((e) => `${where}: ${e}`));
    }
  });
  return { errors, racerRuns };
}

// 規則そのものの確かめ（変異を落とす）
const OK_FN = `CREATE OR REPLACE FUNCTION public.get_racer_runs(p integer) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER
  SET boatai.facts_racer_id = '' AS $$ BEGIN PERFORM set_config('boatai.facts_racer_id', p::text, true); RETURN '[]'; END; $$;`;
assert.deepEqual(checkSql(OK_FN, "見本").errors, []);
assert.equal(checkSql(OK_FN, "見本").racerRuns, 1);
assert.equal(checkSql(OK_FN.replace("INVOKER", "DEFINER"), "x").errors.length, 2);
assert.equal(checkSql(OK_FN.replace(", true)", ", false)"), "x").errors.length, 1);
assert.equal(checkSql(OK_FN.replace("SET boatai.facts_racer_id = ''", ""), "x").errors.length, 1);
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

// (e): 写しの関数（定義は行の配列、設定は 'name=value' の配列）
for (const fn of readSnapshotFunctions()) {
  const def = Array.isArray(fn.definition) ? fn.definition.join("\n") : String(fn.definition ?? "");
  const where = `写しの ${fn.name}`;
  if (fn.name !== "get_racer_runs") {
    errors.push(...statementErrors(stripComments(def).trim(), where));
    for (const c of fn.config ?? []) {
      if (/^boatai\./i.test(c)) errors.push(`${where}: 関数の設定で boatai.〜 を立てない`);
    }
  }
}

assert.deepEqual(errors, [], errors.join("\n"));
console.log(`verify-facts-racer-guc: OK（get_racer_runs の定義 ${racerRuns}）`);
