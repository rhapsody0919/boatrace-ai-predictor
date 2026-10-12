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
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractConfirmationSections,
  extractTables,
  inspectMigration,
  isAppliedInLedger,
  markAppliedInLedger,
  psqlArgs,
  renderSummary,
  splitStatements,
  validateMigrationPath,
} from "../lib/dbApplySql.js";

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
check(
  "ALTER TABLE ONLY",
  eq(extractTables('ALTER TABLE ONLY "Bar" ADD COLUMN x int'), [
    { table: '"Bar"', op: "ALTER" },
  ]),
);
check(
  "INSERT（CTE の中も）",
  eq(extractTables("WITH x AS (SELECT 1) INSERT INTO a (c) SELECT 1"), [
    { table: "a", op: "INSERT" },
  ]),
);
check(
  "UPDATE（別名つき）",
  eq(extractTables("UPDATE races r SET x = 1"), [
    { table: "races", op: "UPDATE" },
  ]),
);
check(
  "ON UPDATE CASCADE はテーブルにしない",
  extractTables(
    "ALTER TABLE t ADD CONSTRAINT f FOREIGN KEY (a) REFERENCES u(a) ON UPDATE CASCADE",
  ).length === 1,
);
check(
  "DELETE FROM",
  eq(extractTables("DELETE FROM s.t WHERE a = 1"), [
    { table: "s.t", op: "DELETE" },
  ]),
);
check(
  "DROP TABLE の複数",
  eq(
    extractTables("DROP TABLE IF EXISTS a, b CASCADE").map((t) => t.table),
    ["a", "b"],
  ),
);
check(
  "TRUNCATE の複数",
  eq(
    extractTables("TRUNCATE TABLE a, public.b RESTART IDENTITY").map(
      (t) => t.table,
    ),
    ["a", "b"],
  ),
);
check(
  "inspectMigration は表ごとに操作をまとめる",
  eq(
    inspectMigration(
      "ALTER TABLE a ADD c int;\nUPDATE a SET c = 1;\nINSERT INTO b VALUES (1);",
    ).tables,
    [
      { table: "a", ops: ["ALTER", "UPDATE"] },
      { table: "b", ops: ["INSERT"] },
    ],
  ),
);

// 5. 冒頭コメントの確認 SQL
{
  const sql = [
    "-- 122: 説明",
    "-- 過去分: 埋めない。確認できておらず、",
    "--",
    "-- 適用後の確認（読み取りのみ）:",
    "--   SELECT 1",
    "--    FROM t;",
    "--   → 1",
    "--",
    "-- 確認（適用後）: scripts/x.js --rpc",
    "-- 元に戻す:",
    "--   DROP x;",
    "",
    "SELECT 1;",
    "-- 確認（本文より後ろは見ない）:",
    "--   SELECT 2;",
  ].join("\n");
  const sections = extractConfirmationSections(sql);
  check("確認の節は2つ", sections.length === 2, JSON.stringify(sections));
  check(
    "節の中身（字下げ行）",
    eq(sections[0]?.lines, ["SELECT 1", " FROM t;", "→ 1"]),
    JSON.stringify(sections[0]?.lines),
  );
  check("見出しと同じ行の中身", eq(sections[1]?.lines, ["scripts/x.js --rpc"]));
}

// 6. 台帳
{
  const ledger = [
    "## 台帳",
    "",
    "| 番号 | ファイル | 適用状況 | 確認した根拠（実スキーマ） |",
    "|---|---|---|---|",
    "| 121 | 121_a.sql | 未適用 | 説明 |",
    "| 122 | 122_b.sql | 未適用（先に適用する） | 説明 b |",
    "| （番号なし） | add-x.sql | 適用済み | x |",
    "",
    "後ろの文",
  ].join("\n");
  const args = {
    date: "2026-10-03",
    runUrl: "https://example.test/run/1",
    sha256: "a".repeat(64),
  };
  const updated = markAppliedInLedger(ledger, {
    ...args,
    fileName: "122_b.sql",
  });
  check("既存の行は updated", updated.action === "updated");
  check(
    "既存の行の適用状況だけが変わる",
    updated.text.includes(
      "| 122 | 122_b.sql | 適用済み（2026-10-03、db-apply",
    ) && updated.text.includes("| 説明 b |"),
  );
  check(
    "他の行は変わらない",
    updated.text.includes("| 121 | 121_a.sql | 未適用 | 説明 |"),
  );
  check(
    "更新後は isAppliedInLedger が真",
    isAppliedInLedger(updated.text, "122_b.sql") &&
      !isAppliedInLedger(updated.text, "121_a.sql"),
  );
  const inserted = markAppliedInLedger(ledger, {
    ...args,
    fileName: "123_c.sql",
  });
  const rows = inserted.text.split("\n");
  check("行が無ければ inserted", inserted.action === "inserted");
  check(
    "（番号なし）の前に足す",
    rows.findIndex((l) => l.startsWith("| 123 | 123_c.sql |")) ===
      rows.findIndex((l) => l.startsWith("| （番号なし）")) - 1,
  );
  const real = readFileSync(
    path.join(ROOT, "docs/db-migration/APPLIED.md"),
    "utf8",
  );
  check(
    "実台帳: 適用済みの判定（001 は適用済み）",
    isAppliedInLedger(real, "001_schema.sql"),
  );
  const realUpdate = markAppliedInLedger(real, {
    ...args,
    fileName: "122_venues_first_win_rate_race_count.sql",
  });
  check(
    "実台帳: 122 の行を更新でき、行数は変わらない",
    realUpdate.action === "updated" &&
      realUpdate.text.split("\n").length === real.split("\n").length,
  );
}

// 7. 実ファイル
{
  const dir = path.join(ROOT, "docs/db-migration");
  const rejected = [];
  // 導入時点（122 まで）のファイルに限る。以後のファイルが CONCURRENTLY 等を含んでも（手で適用するもの）、
  // 無関係な PR の CI を落とさない
  const atIntroduction = (x) => x.endsWith(".sql") && Number.parseInt(x, 10) <= 122;
  for (const f of readdirSync(dir).filter(atIntroduction)) {
    if (
      inspectMigration(readFileSync(path.join(dir, f), "utf8")).rejections
        .length > 0
    )
      rejected.push(f);
  }
  check(
    "実ファイル（122 まで）で拒否されるのは CONCURRENTLY を含む 050・055 だけ",
    eq(rejected.sort(), [
      "050_race_entries_racer_id_index.sql",
      "055_get_latest_racer_grades_rpc.sql",
    ]),
    rejected.join(", "),
  );
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

// 8. ワークフローの配線（YAML を字句で見る。actionlint は文法、ここは安全の前提）
{
  const yml = readFileSync(
    path.join(ROOT, ".github/workflows/db-apply.yml"),
    "utf8",
  );
  const jobs = {};
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
  const body = (job) => (jobs[job] ?? []).join("\n");
  check(
    "job は inspect・apply・record",
    eq(Object.keys(jobs), ["inspect", "apply", "record"]),
  );
  check(
    "起動は workflow_dispatch だけ",
    /^on:\n {2}workflow_dispatch:/m.test(yml) &&
      !/^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|issue_comment):/m.test(
        yml,
      ),
  );
  check(
    "全体の既定権限は contents: read",
    /^permissions:\n {2}contents: read\s*$/m.test(yml),
  );
  check(
    "DB の secret を読むのは apply だけ・inspect は secret を読まない",
    !/secrets\./.test(body("inspect")) &&
      !/SUPABASE_DB_URL/.test(body("record")) &&
      /secrets\.SUPABASE_DB_URL/.test(body("apply")),
  );
  check(
    "record が読む secret は ryujin-bot の App の鍵だけ",
    eq(
      [...body("record").matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort(),
      ["RYUJIN_BOT_APP_ID", "RYUJIN_BOT_PRIVATE_KEY"],
    ),
  );
  check(
    "apply は environment: production-db",
    /^ {4}environment: production-db\s*$/m.test(body("apply")),
  );
  check("inspect は environment なし", !/environment:/.test(body("inspect")));
  check(
    "record は environment: ryujin-bot（App の鍵は master だけが使える）",
    /^ {4}environment: ryujin-bot\s*$/m.test(body("record")),
  );
  // 「Allow GitHub Actions to create and approve pull requests」を ON にさせない（ON にすると pull_request の
  // ワークフローが bot として PR を承認でき、master の承認1件の要件が実質なくなる）
  check(
    "GITHUB_TOKEN に書き込み権限を渡さない・PR を作らない",
    !/: write/.test(yml.replace(/permission-contents: write/g, "")) &&
      !/gh pr create/.test(yml),
  );
  check(
    "record は App トークンで push-with-retry.sh を使い、checkout に資格情報を残さない",
    /permission-contents: write/.test(body("record")) &&
      /PUSH_TOKEN: \$\{\{ steps\.app-token\.outputs\.token \}\}/.test(body("record")) &&
      /bash scripts\/maintenance\/push-with-retry\.sh/.test(body("record")) &&
      /persist-credentials: false/.test(body("record")),
  );
  check(
    "record のコミットは [automated]（Quality Gates・再生成ワークフローを再起動させない）",
    /git commit -m "[^"]*\[automated\]"/.test(body("record")),
  );
  const runLines = [];
  let inRun = false;
  let runIndent = 0;
  for (const l of yml.split("\n")) {
    const start = /^(\s*)(?:- )?run:\s*(.*)$/.exec(l);
    if (start) {
      inRun = start[2] === "|";
      runIndent = start[1].length;
      if (!inRun) runLines.push(start[2]);
      continue;
    }
    if (inRun) {
      if (l.trim() !== "" && l.search(/\S/) <= runIndent) inRun = false;
      else runLines.push(l);
    }
  }
  check(
    "run に ${{ }} を直接書かない（式インジェクション）",
    runLines.length > 0 && !runLines.some((l) => l.includes("${{")),
    runLines.filter((l) => l.includes("${{")).join(" / "),
  );
  check("set -x を使わない", !/set -[a-wyz]*x/.test(yml));
  check(
    "checkout は commit SHA で固定",
    [...yml.matchAll(/uses: (\S+)/g)].every((m) => /@[0-9a-f]{40}$/.test(m[1])),
  );
  check(
    "inspect・apply は起動時のコミット（github.sha）を取り出す",
    (body("inspect").match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length ===
      1 &&
      (body("apply").match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length === 1,
  );
  check(
    "inspect・apply は資格情報を残さない",
    /persist-credentials: false/.test(body("inspect")) &&
      /persist-credentials: false/.test(body("apply")),
  );
  check(
    "master 以外からの起動を落とす",
    /refs\/heads\/master/.test(body("inspect")),
  );
  check(
    "apply は承認前の sha256 を受け取る",
    /needs\.inspect\.outputs\.sha256/.test(body("apply")),
  );
}

// 8b. production-db の secret を読めるのは db-apply.yml だけ（他のワークフローが environment: production-db を宣言すると、
//     承認画面では区別できないまま同じ鍵が渡る）
{
  const dir = path.join(ROOT, ".github/workflows");
  const users = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) =>
      /environment:\s*(?:\n\s*name:\s*)?["']?production-db\b/.test(
        readFileSync(path.join(dir, f), "utf8"),
      ),
    );
  check(
    "Environment production-db を使うのは db-apply.yml だけ",
    eq(users, ["db-apply.yml"]),
    users.join(", "),
  );
}

// 9. 承認画面（job summary）
{
  const summaryOf = (sql) =>
    renderSummary({
      path: "docs/db-migration/999_x.sql",
      sha256: "0".repeat(64),
      sql,
      inspection: inspectMigration(sql),
      fileUrl: "https://example.invalid/x",
      alreadyApplied: false,
    });
  const tableRows = (md) =>
    md
      .split("\n")
      .filter((l) => /^\| `/.test(l) && !/^\| [0-9]/.test(l));

  // 引用識別子には ` | < 改行を入れられる。コードスパンを抜けて表を壊したり HTML を差し込んだりさせない
  const evil = summaryOf(
    'CREATE TABLE "a`<details><summary>確認済み</summary>|x" (id int);\n',
  );
  const evilRow = tableRows(evil)[0] ?? "";
  check(
    "触るテーブル: 識別子の ` でコードスパンを抜けない",
    (evilRow.match(/`/g) ?? []).length === 2,
    evilRow,
  );
  check(
    "触るテーブル: 識別子の | で列を増やさない",
    evilRow.split(/(?<!\\)\|/).length === 4,
    evilRow,
  );
  const stmtRows = evil
    .split("\n")
    .filter((l) => /^\| [0-9]+ \| `/.test(l));
  check(
    "文の一覧: 識別子の ` でコードスパンを抜けない",
    stmtRows.length === 1 && (stmtRows[0].match(/`/g) ?? []).length === 2,
    stmtRows.join(" / "),
  );

  // 冒頭コメントの見出しは地の文に出る。HTML・強調を解釈させない
  const heading = summaryOf(
    "-- <details><summary>x</summary> **済** 確認:\n--   SELECT 1;\nSELECT 1;\n",
  );
  const headingLine =
    heading.split("\n").find((l) => l.includes("確認") && l.startsWith("**")) ??
    "";
  check(
    "確認 SQL の見出し: < > と * をエスケープする",
    headingLine.includes("&lt;details&gt;") &&
      !headingLine.includes("<details>") &&
      headingLine.includes("\\*\\*済\\*\\*"),
    headingLine,
  );

  // 見えない制御文字（Trojan Source）
  for (const [label, ch] of [
    ["RLO（U+202E）", "\u202E"],
    ["LRI（U+2066）", "\u2066"],
    ["ゼロ幅スペース（U+200B）", "\u200B"],
    ["BOM（U+FEFF）", "\uFEFF"],
  ]) {
    check(
      `見えない制御文字は拒否: ${label}`,
      rejects(`SELECT 1; -- a${ch}b\n`).some((r) => r.includes("見えない制御文字")),
    );
  }
  check(
    "日本語のコメントは拒否しない",
    rejects("-- 日本語のコメント（全角）\nSELECT 1;\n").length === 0,
  );

  // 長い行は注意を出す
  const long = summaryOf(`SELECT 1;${" ".repeat(300)}DROP TABLE t;\n`);
  check("200字を超える行には注意を出す", /200 字を超える行がある（1行目/.test(long));
  check(
    "短い行だけなら注意を出さない",
    !/字を超える行がある/.test(summaryOf("SELECT 1;\n")),
  );

  // 本文は 001（748行）まで切り詰めずに全文を出す
  const big = readFileSync(
    path.join(ROOT, "docs/db-migration/001_schema.sql"),
    "utf8",
  );
  const bigSummary = summaryOf(big);
  check(
    "本文: 既存の最長のマイグレーション（001）を切り詰めない",
    bigSummary.includes("### 本文\n") &&
      bigSummary.includes(big.trimEnd().split("\n").at(-1)),
  );
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

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
