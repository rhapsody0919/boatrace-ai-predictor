# 過去データの facts の表の verify の下書き（マイグレーションの PR に載せる）

> **未審査の案。** マイグレーションは作り手が作らない（AGENTS.md 安全の3）。人がマイグレーションの PR（db-draft.md §9 の SQL を `docs/db-migration/<番号>_race_facts.sql` に写す）を起こすとき、同じ PR に下の2本を `scripts/maintenance/` へそのまま置く。決定は [ADR-0113](../../adr/0113-race-facts-two-era-rows-behind-racer-rpc.md) 決定4。

| ファイル | 守ること | 置き方 |
|---|---|---|
| `verify-facts-racer-guc.js` | 絞りの設定（boatai.facts_racer_id）を立てられるのが get_racer_runs だけ（ADR-0113 決定4 の (a)〜(e)）。マイグレーションの全部と schema-snapshot.json の関数を照らす | 新しい verify。`verify-registry.json` に行を足さない（既定で tier=ci） |
| `verify-race-facts-migration.js` | PGlite に流して、表を直に引くと0行・RPC が1選手だけ・CHECK・戻し（db-draft.md §9 の試験） | 同上。`node --test` の形。`NNN_race_facts.sql` を名前で探す |

手元の確かめ（2026-11-27）:
- 2本とも、db-draft.md §9 の SQL を `212_race_facts.sql` として今のマイグレーション（〜211）と並べたフォルダで通った（環境変数 `FACTS_GUC_MIGRATION_DIR`・`RACE_FACTS_MIGRATION_DIR` でフォルダを差し替えた）。`verify-facts-racer-guc.js` は今の schema-snapshot.json の関数も全部通った
- SQL が無いと `verify-facts-racer-guc.js` は「get_racer_runs の定義がマイグレーションに無い」で落ちる
- SQL を壊すと落ちる: run_facts のポリシーを USING (true)・race_facts のポリシーを USING (true)・set_config の第3引数を false にすると、`verify-race-facts-migration.js` が落ちる。get_racer_runs の `SET boatai.facts_racer_id = ''` の句を消すと、PGlite の試験は通るが `verify-facts-racer-guc.js` の (d) が落ちる（2本で役を分ける）
- どちらも製品のファイルを import しない（guard-weakening は「比べる物なし」の警告になる見込み。新しい verify なので強める向き）。fs の書き・child_process は使わない

## verify-facts-racer-guc.js

```js
// facts の表の絞りの設定（boatai.facts_racer_id）を立てられるのが get_racer_runs だけであることを守る（ADR-0113 決定4 の verify (a)〜(e)）
// RLS の式は1トランザクションに1選手しか通さないので、ほかの関数が同じ設定を立てても出る量は1選手までだが、立てる道そのものを作らない。
//   (a) マイグレーション（注釈を除く）で boatai.facts_racer_id が出てよいのは、get_racer_runs の定義・run_facts と race_facts のポリシー・COMMENT だけ
//   (b) SET [LOCAL] boatai.〜 の文、ALTER ROLE|DATABASE … SET boatai.〜 は全て NG（get_racer_runs の定義の SET 句は除く）
//   (c) 関数の定義の中で set_config の第1引数が文字列の直書きでない物は NG（動的な名前で同じ設定を立てられる）
//   (d) get_racer_runs は SECURITY INVOKER で、SET boatai.facts_racer_id = '' の句と set_config('boatai.facts_racer_id', …, true) を持つ
//   (e) docs/reference/schema-snapshot.json の関数の定義・設定も (a)〜(c) と同じ規則で照らす（マイグレーションの外で作られた関数も拾う）
// 外部接続なし。読むのは docs/db-migration/*.sql と docs/reference/schema-snapshot.json だけ
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const GUC = "boatai.facts_racer_id";
const MIGRATION_DIR = process.env.FACTS_GUC_MIGRATION_DIR ?? "docs/db-migration";
const SNAPSHOT = process.env.FACTS_GUC_SNAPSHOT ?? "docs/reference/schema-snapshot.json";

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
for (const file of readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort()) {
  const r = checkSql(readFileSync(path.join(MIGRATION_DIR, file), "utf-8"), file);
  errors.push(...r.errors);
  racerRuns += r.racerRuns;
}
assert.ok(racerRuns >= 1, "get_racer_runs の定義がマイグレーションに無い");

// (e): 写しの関数（定義は行の配列、設定は 'name=value' の配列）
const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf-8"));
for (const fn of snapshot.functions ?? []) {
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
```

## verify-race-facts-migration.js

```js
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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const DIR = process.env.RACE_FACTS_MIGRATION_DIR ?? "docs/db-migration";
const file = readdirSync(DIR).find((f) => /^\d+_race_facts\.sql$/.test(f));
assert.ok(file, `${DIR} に NNN_race_facts.sql が無い`);
const sql = readFileSync(path.join(DIR, file), "utf-8");
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
```
