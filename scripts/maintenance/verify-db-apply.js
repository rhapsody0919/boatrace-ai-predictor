#!/usr/bin/env node
/**
 * verify-db-apply.js - 本番 DB 適用ワークフロー（.github/workflows/db-apply.yml・scripts/lib/dbApplySql.js）の検証。
 *
 * 確認する観点:
 *   1. パスの検証（実ファイルの命名は通り、ディレクトリの外・大文字・別拡張子は通らない）
 *   2. 文の分割（文字列・$$・"識別子"・入れ子のコメントの中の ; やキーワードを区切りにしない）
 *   3. 拒否する SQL（トランザクション制御の位置・CONCURRENTLY・VACUUM・ALTER SYSTEM・psql のメタコマンド 等）
 *   4. 触るテーブルの抽出
 *   5. 冒頭コメントの確認 SQL の抽出
 *   6. 台帳（APPLIED.md）の更新（既存の行・行が無い場合）
 *   7. docs/db-migration/ の実ファイルの判定（CONCURRENTLY を含む 050・055 以外は通る）
 *   8. ワークフローの配線（DB の secret は apply だけ、${{ inputs.* }} を run に直接書かない、GITHUB_TOKEN に書き込み権限を渡さない、
 *      record は ryujin-bot の App トークンで master に直接コミットする、
 *      Environment production-db を使うのは db-apply.yml だけ）
 *   9. 承認画面（job summary）を SQL の書き手が操作できない（表のセル・見出しのエスケープ、見えない制御文字の拒否、
 *      長い行の注意、本文を切り詰めない）
 *  10. psql の引数（lock_timeout・statement_timeout をファイルの前に設定する）
 *  11. 軽い／重い／止めるの判定（ADR-0097 の許可のリスト。列挙の外は全部重い、控えの無い削除・個人情報らしい列は止める）
 *  12. 実ファイルのラベルの一覧（scripts/lib/__fixtures__/db-apply-labels.json）と一致する。判定を変えたら一覧も同じ PR で直す
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyMigration,
  extractTables,
  inspectMigration,
  splitStatements,
  validateMigrationPath,
} from "../lib/dbApplySql.js";
import {
  runDbApplyScenes1,
  runDbApplyScenes2,
  runDbApplyScenes3,
  runDbApplyScenes4,
  runDbApplyScenes5,
  runDbApplyScenes6,
} from "./verifyData/db-apply-scenes-1.js";
import {
  runDbApplyScenes7,
  runDbApplyScenes8,
  runDbApplyScenes9,
  runDbApplyScenes10,
  runDbApplyScenes11,
  runDbApplyScenes12,
  runDbApplyScenes13,
  runDbApplyScenes14,
} from "./verifyData/db-apply-scenes-2.js";
import {
  runDbApplyScenes15,
  runDbApplyScenes16,
  runDbApplyScenes17,
} from "./verifyData/db-apply-scenes-3.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 1. パス
for (const ok of [
  "docs/db-migration/122_venues_first_win_rate_race_count.sql",
  "docs/db-migration/013b_accuracy_cache_rls_policy.sql",
]) {
  check(`パス可: ${ok}`, validateMigrationPath(ok).ok);
}
for (const ng of [
  "docs/db-migration/../../etc/passwd.sql",
  "docs/db-migration/122_x/../../y.sql",
  "docs/db-migration/008_ADD_EXHIBITION_TO_RPC.sql",
  "docs/db-migration/122_x.sql.bak",
  "docs/db-migration/APPLIED.md",
  "./docs/db-migration/122_x.sql",
  "docs/db-migration/122_x.sql\n",
  "docs/db-migration/122_$(id).sql",
  "",
  undefined,
]) {
  check(`パス不可: ${JSON.stringify(ng)}`, !validateMigrationPath(ng).ok);
}

// 2. 文の分割
{
  const sql = [
    "-- 先頭のコメント; ここは区切りではない",
    "SELECT 'a;b', E'it\\'s;', \"we;ird\" FROM t;",
    "/* 外 /* 入れ子; */ まだコメント; */",
    "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN; COMMIT; END $body$ LANGUAGE plpgsql;",
    "DO $$ BEGIN PERFORM 1; END $$;",
    "SELECT $1",
  ].join("\n");
  const { statements, metaCommands, errors } = splitStatements(sql);
  check(
    "文の数（文字列・$$・コメント内の ; を数えない）",
    statements.length === 4,
    String(statements.length),
  );
  check(
    "行番号",
    eq(
      statements.map((s) => s.line),
      [2, 4, 5, 6],
    ),
    JSON.stringify(statements.map((s) => s.line)),
  );
  check(
    "メタコマンドなし・エラーなし",
    metaCommands.length === 0 && errors.length === 0,
  );
  check("原文を保持", statements[0].text.includes("'a;b'"));
}
check(
  "閉じていない文字列はエラー",
  splitStatements("SELECT 'abc;").errors.length === 1,
);
check(
  "閉じていない $$ はエラー",
  splitStatements("DO $$ BEGIN").errors.length === 1,
);
check(
  "閉じていないコメントはエラー",
  splitStatements("SELECT 1; /* x").errors.length === 1,
);

// 3. 拒否
const rejects = (sql) => inspectMigration(sql).rejections;
check(
  "トランザクション制御なしは single-transaction",
  inspectMigration("ALTER TABLE t ADD COLUMN c int;").mode ===
    "single-transaction",
);
check(
  "先頭 BEGIN・末尾 COMMIT は file-transaction",
  (() => {
    const r = inspectMigration(
      "-- x\nBEGIN;\nSET LOCAL lock_timeout = '10s';\nALTER TABLE t ADD COLUMN c int;\nCOMMIT;\n",
    );
    return r.mode === "file-transaction" && r.rejections.length === 0;
  })(),
);
check(
  "START TRANSACTION〜END も file-transaction",
  inspectMigration("START TRANSACTION;\nSELECT 1;\nEND;").mode ===
    "file-transaction",
);
check(
  "途中の COMMIT は拒否",
  rejects("BEGIN;\nSELECT 1;\nCOMMIT;\nSELECT 2;\nCOMMIT;").length > 0,
);
check(
  "COMMIT の後に文があれば拒否",
  rejects("BEGIN;\nSELECT 1;\nCOMMIT;\nSELECT 2;").length > 0,
);
check(
  "BEGIN だけ（COMMIT なし）は拒否",
  rejects("BEGIN;\nSELECT 1;").length > 0,
);
check(
  "末尾が ROLLBACK は拒否",
  rejects("BEGIN;\nSELECT 1;\nROLLBACK;").length > 0,
);
check("SAVEPOINT は拒否", rejects("SELECT 1;\nSAVEPOINT a;").length > 0);
check(
  "BEGIN と COMMIT だけ（中身なし）でも形は通る",
  rejects("BEGIN;\nCOMMIT;").length === 0,
);
check(
  "関数本体（$$）の中の COMMIT は拒否しない",
  rejects("CREATE PROCEDURE p() AS $$ BEGIN COMMIT; END $$ LANGUAGE plpgsql;")
    .length === 0,
);
for (const [label, sql] of [
  ["CREATE INDEX CONCURRENTLY", "CREATE INDEX CONCURRENTLY i ON t(c);"],
  ["DROP INDEX CONCURRENTLY", "DROP INDEX CONCURRENTLY IF EXISTS i;"],
  ["REINDEX ... CONCURRENTLY", "REINDEX INDEX CONCURRENTLY i;"],
  ["VACUUM", "VACUUM ANALYZE t;"],
  ["ALTER SYSTEM", "ALTER SYSTEM SET work_mem = '1GB';"],
  ["CREATE DATABASE", "CREATE DATABASE x;"],
  ["DROP DATABASE", "drop database x;"],
  ["CREATE SUBSCRIPTION", "CREATE SUBSCRIPTION s CONNECTION '' PUBLICATION p;"],
  ["COPY", "COPY t FROM STDIN;"],
  ["DISCARD ALL", "DISCARD ALL;"],
  [
    "BEGIN ATOMIC",
    "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;",
  ],
  ["psql の \\! （シェル実行）", "SELECT 1;\n\\! env\n"],
  ["psql の \\i", "\\i other.sql\n"],
  ["psql の \\copy", "\\copy t from 'x'\n"],
  ["空のファイル", "-- コメントだけ\n"],
]) {
  check(`拒否: ${label}`, rejects(sql).length > 0);
}
check(
  "文字列の中の CONCURRENTLY・\\ は拒否しない",
  rejects("COMMENT ON TABLE t IS 'CONCURRENTLY \\! x';").length === 0,
);
check("E'' の中の \\ は拒否しない", rejects("SELECT E'a\\nb';").length === 0);
check(
  "コメントの中の VACUUM・BEGIN は拒否しない",
  rejects("-- VACUUM t; BEGIN;\nSELECT 1;").length === 0,
);

// 4. テーブル
check(
  "CREATE TABLE IF NOT EXISTS",
  eq(extractTables("CREATE TABLE IF NOT EXISTS public.foo (a int)"), [
    { table: "foo", op: "CREATE" },
  ]),
);

// ---- 後半の場面（verifyData/db-apply-scenes-1.js） ----
runDbApplyScenes1({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });

/** { の中身を割った 2/3 */
function dbApplyLedger2() {
  const real = readFileSync(
    path.join(ROOT, "docs/db-migration/APPLIED.md"),
    "utf8",
  );
  return { real };
}

// ---- 後半の場面（verifyData/db-apply-scenes-1.js） ----
runDbApplyScenes2({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });

/** { の中身を割った 2/4 */
function dbApplyRealFiles2({ atIntroduction, dir, rejected }) {
  for (const f of readdirSync(dir).filter(atIntroduction)) {
    if (
      inspectMigration(readFileSync(path.join(dir, f), "utf8")).rejections
        .length > 0
    )
      rejected.push(f);
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-1.js） ----
runDbApplyScenes3({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });

/** { の中身を割った 4/4 */
function dbApplyRealFiles4({ dir }) {
  check(
    "122（BEGIN〜COMMIT で包んだ現行の書き方）は file-transaction",
    inspectMigration(
      readFileSync(
        path.join(dir, "122_venues_first_win_rate_race_count.sql"),
        "utf8",
      ),
    ).mode === "file-transaction",
  );
}

// ---- 後半の場面（verifyData/db-apply-scenes-1.js） ----
runDbApplyScenes4({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });

// 8. ワークフローの配線（YAML を字句で見る。actionlint は文法、ここは安全の前提）
/** { の中身を割った 1/5 */
function dbApplyWiring1() {
  const yml = readFileSync(
    path.join(ROOT, ".github/workflows/db-apply.yml"),
    "utf8",
  );
  return { yml };
}

// ---- 後半の場面（verifyData/db-apply-scenes-1.js） ----
runDbApplyScenes5({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });

/** { の中身を割った 3/5 */
function dbApplyWiring3({ jobs, yml }) {
  let current = null;
  let inJobs = false;
  for (const l of yml.split("\n")) {
    if (/^jobs:/.test(l)) inJobs = true;
    const m = inJobs && /^ {2}([a-z-]+):\s*$/.exec(l);
    if (m) {
      current = m[1];
      jobs[current] = [];
    } else if (current) {
      jobs[current].push(l);
    }
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-1.js・db-apply-scenes-2.js） ----
runDbApplyScenes6({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 });
runDbApplyScenes7({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

// 8a. 定期の起動（ADR-0097 段取り D）の配線
/** { の中身を割った 1/13 */
function dbApplyWorkflow1() {
  const yml = readFileSync(path.join(ROOT, ".github/workflows/db-apply.yml"), "utf8");
  return { yml };
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes8({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 3/13 */
function dbApplyWorkflow3({ jobs, yml }) {
  let current = null;
  let inJobs = false;
  for (const l of yml.split("\n")) {
    if (/^jobs:/.test(l)) inJobs = true;
    const m = inJobs && /^ {2}([a-z-]+):\s*$/.exec(l);
    if (m) {
      current = m[1];
      jobs[current] = [];
    } else if (current) {
      jobs[current].push(l);
    }
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes9({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 5/13 */
function dbApplyWorkflow5({ body }) {
  {
    // 台帳に書くファイルを決める step を実際に bash で動かす（手での起動は inputs・inspect、定期の起動は judge）
    const script = /id: target\n[\s\S]*?run: \|\n((?: {10}.*\n)+)/.exec(body("record") + "\n")?.[1]?.replace(/^ {10}/gm, "") ?? "";
    const pick = (env) => {
      const out = path.join(tmpdir(), `db-apply-target-${process.pid}-${Math.random().toString(36).slice(2)}`);
      const r = spawnSync("bash", ["-c", script], { env: { PATH: process.env.PATH, GITHUB_OUTPUT: out, ...env }, encoding: "utf8" });
      const text = r.status === 0 && existsSync(out) ? readFileSync(out, "utf8") : "";
      rmSync(out, { force: true });
      return { status: r.status, text };
    };
    const both = { INPUT_MIGRATION: "docs/db-migration/1_a.sql", INSPECT_SHA256: "aaa", JUDGE_FILE: "docs/db-migration/2_b.sql", JUDGE_SHA256: "bbb" };
    const manual = pick({ MANUAL: "true", ...both });
    const periodic = pick({ MANUAL: "false", ...both });
    const empty = pick({ MANUAL: "false", INPUT_MIGRATION: "docs/db-migration/1_a.sql", INSPECT_SHA256: "aaa", JUDGE_FILE: "", JUDGE_SHA256: "" });
    check(
      "record: 手での起動は inputs と inspect、定期の起動は judge のファイルを台帳に書き、空なら落とす（片方に寄せない）",
      script !== "" &&
        manual.text === "migration=docs/db-migration/1_a.sql\nsha256=aaa\n" &&
        periodic.text === "migration=docs/db-migration/2_b.sql\nsha256=bbb\n" &&
        empty.status !== 0,
      JSON.stringify({ manual, periodic, empty }),
    );
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes10({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 7/13 */
function dbApplyWorkflow7() {
  check(
    "台帳の確認の fetch に --depth を付けない（手元の clone を shallow にしない）",
    !/["']--depth/.test(readFileSync(path.join(ROOT, "scripts/db/db-apply.js"), "utf8")),
  );
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes11({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 9/13 */
function dbApplyWorkflow9() {
  // 当てる直前の判定（apply-auto）: 重い・止めるのファイルは、DB の接続より前に落ちる
  for (const f of ["163_drop_sns_mobile_approval.sql", "166_claude_ro_readonly_role.sql"]) {
    const rel = `docs/db-migration/${f}`;
    const sha = createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");
    const env = { ...process.env, SUPABASE_DB_URL: "", DB_APPLY_DRY_RUN: "false" };
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/db/db-apply.js"), "apply-auto", rel, sha], { cwd: ROOT, env, encoding: "utf8" });
    check(`apply-auto は軽いでない ${f} を当てずに落とす`, r.status === 1 && /軽い」でない/.test(r.stderr), r.stderr.slice(0, 200));
  }
}

/** { の中身を割った 10/13 */
function dbApplyWorkflow10() {
  {
    // 試運転の間は、軽いファイルでも apply-auto の中で止める（judge の mode と合わせて2段）
    const rel = "docs/db-migration/125_raw_snapshots.sql";
    const sha = createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/db/db-apply.js"), "apply-auto", rel, sha], {
      cwd: ROOT,
      env: { ...process.env, SUPABASE_DB_URL: "", DB_APPLY_DRY_RUN: "" },
      encoding: "utf8",
    });
    check("apply-auto は試運転の間は軽いファイルでも当てない", r.status === 1 && /試運転/.test(r.stderr), r.stderr.slice(0, 200));
    const j = spawnSync(process.execPath, [path.join(ROOT, "scripts/db/db-apply.js"), "judge-all"], {
      cwd: ROOT,
      env: {
        ...process.env,
        GITHUB_OUTPUT: "",
        PENDING: JSON.stringify([
          { file: rel, ok: true, reasons: [], pr: 1 },
          { file: "docs/db-migration/163_drop_sns_mobile_approval.sql", ok: true, reasons: [], pr: 2 },
          { file: "docs/db-migration/166_claude_ro_readonly_role.sql", ok: false, reasons: ["x"], pr: 3 },
        ]),
      },
      encoding: "utf8",
    });
    check("judge-all は5点の検査を通ったものだけを判定する", j.status === 0 && /125_raw_snapshots\.sql=light, 163_drop_sns_mobile_approval\.sql=stop$/m.test(j.stdout), j.stdout + j.stderr);
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes12({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 12/13 */
function dbApplyWorkflow12({ dir }) {
  const autoUsers = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => /environment:\s*(?:\n\s*name:\s*)?["']?production-db-auto\b/.test(readFileSync(path.join(dir, f), "utf8")));
  return { autoUsers };
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes13({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 2/3 */
function dbApplyEnvUsers2({ dir }) {
  const users = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) =>
      /environment:\s*(?:\n\s*name:\s*)?["']?production-db\b/.test(
        readFileSync(path.join(dir, f), "utf8"),
      ),
    );
  return { users };
}

// ---- 後半の場面（verifyData/db-apply-scenes-2.js） ----
runDbApplyScenes14({ ROOT, check, eq, rejects, dbApplyWiring1, dbApplyWiring3, dbApplyWorkflow1, dbApplyWorkflow3, dbApplyWorkflow5, dbApplyWorkflow7, dbApplyWorkflow9, dbApplyWorkflow10, dbApplyWorkflow12, dbApplyEnvUsers2 });

/** { の中身を割った 2/3 */
function dbApplyClassify2() {

  // 本文は 001（748行）まで切り詰めずに全文を出す
  const big = readFileSync(
    path.join(ROOT, "docs/db-migration/001_schema.sql"),
    "utf8",
  );
  return { big };
}

// ---- 後半の場面（verifyData/db-apply-scenes-3.js） ----
runDbApplyScenes15({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 });

/** { の中身を割った 2/5 */
function dbApplyLabels2() {
  const expected = JSON.parse(readFileSync(path.join(ROOT, "scripts/lib/__fixtures__/db-apply-labels.json"), "utf8"));
  return { expected };
}

// ---- 後半の場面（verifyData/db-apply-scenes-3.js） ----
runDbApplyScenes16({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 });

/** { の中身を割った 4/5 */
function dbApplyLabels4({ diffs, dir, expected }) {
  for (const f of readdirSync(dir).filter((x) => /^\d{3}[a-z]?_.*\.sql$/.test(x)).sort()) {
    const got = classifyMigration(readFileSync(path.join(dir, f), "utf8"), f).label;
    if (!(f in expected)) {
      console.log(`  （一覧に無い新しいファイル: ${f} → ${got}）`);
      continue;
    }
    if (expected[f] !== got) diffs.push(`${f}: 一覧 ${expected[f]} / 今 ${got}`);
  }
}

// ---- 後半の場面（verifyData/db-apply-scenes-3.js） ----
runDbApplyScenes17({ ROOT, check, dbApplyClassify2, dbApplyLabels2, dbApplyLabels4 });

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
