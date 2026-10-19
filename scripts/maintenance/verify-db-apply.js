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
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTO_TIMEOUTS,
  classifyMigration,
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
    "job は inspect・apply（手での起動）、reconcile・judge・apply-auto・apply-gated（定期の起動）、record・notify",
    eq(Object.keys(jobs), ["inspect", "apply", "reconcile", "judge", "apply-auto", "apply-gated", "record", "notify"]),
  );
  check(
    "起動は workflow_dispatch と schedule だけ（push では動かさない。bot の push で適用が走らない）",
    /^on:\n {2}workflow_dispatch:/m.test(yml) &&
      /^ {2}schedule:/m.test(yml) &&
      !/^ {2}(push|pull_request|pull_request_target|workflow_run|issue_comment):/m.test(
        yml,
      ),
  );
  check(
    "全体の既定権限は contents: read",
    /^permissions:\n {2}contents: read\s*$/m.test(yml),
  );
  check(
    "DB の secret を読むのは apply・apply-auto・apply-gated だけ・inspect・reconcile・judge は secret を読まない",
    ["inspect", "reconcile", "judge"].every((j) => !/secrets\./.test(body(j))) &&
      ["record", "notify"].every((j) => !/SUPABASE_DB_URL/.test(body(j))) &&
      ["apply", "apply-auto", "apply-gated"].every((j) =>
        /secrets\.SUPABASE_DB_URL/.test(body(j)),
      ),
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
    "GITHUB_TOKEN の書き込み権限は notify の pull-requests（元の PR へのコメント）だけ・PR を作らない",
    !/: write/.test(
      yml
        .replace(/permission-contents: write/g, "")
        .replace(body("notify"), ""),
    ) &&
      eq(
        [...body("notify").matchAll(/^ {6}([a-z-]+): write$/gm)].map((m) => m[1]),
        ["pull-requests"],
      ) &&
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

// 8a. 定期の起動（ADR-0097 段取り D）の配線
{
  const yml = readFileSync(path.join(ROOT, ".github/workflows/db-apply.yml"), "utf8");
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
  check("試運転の印 DB_APPLY_DRY_RUN は \"true\" か \"false\" の文字", /^ {2}DB_APPLY_DRY_RUN: "(true|false)"$/m.test(yml));
  check("切り替えのコミットは40桁の SHA で固定", /^ {2}DB_APPLY_SWITCH_SHA: [0-9a-f]{40}$/m.test(yml));
  check("workflow 全体に concurrency を掛けない（承認待ちの間も定期の起動が動き、6時間の通知を出せる）", !/^concurrency:/m.test(yml));
  check(
    "DB に当てる job は同じ group の job ごとの concurrency",
    ["apply", "apply-auto", "apply-gated"].every((j) => /concurrency:\n {6}group: db-apply-db\n {6}cancel-in-progress: false/.test(body(j))),
  );
  check("手での起動の inspect は workflow_dispatch だけ", /github\.event_name == 'workflow_dispatch'/.test(body("inspect")));
  check(
    "reconcile は schedule だけ・審査の App の ID が入るまで動かない",
    /github\.event_name == 'schedule'/.test(body("reconcile")) && /vars\.REVIEWER_BOT_USER_ID != ''/.test(body("reconcile")),
  );
  check("judge は reconcile が選んだときだけ", /if: needs\.reconcile\.outputs\.status == 'selected'/.test(body("judge")));
  check(
    "apply-auto は mode auto・Environment production-db-auto・apply-auto コマンド",
    /if: needs\.judge\.outputs\.mode == 'auto'/.test(body("apply-auto")) &&
      /^ {4}environment: production-db-auto$/m.test(body("apply-auto")) &&
      /db-apply\.js apply-auto /.test(body("apply-auto")),
  );
  check(
    "apply-gated は mode gated・Environment production-db・apply-gated コマンド",
    /if: needs\.judge\.outputs\.mode == 'gated'/.test(body("apply-gated")) &&
      /^ {4}environment: production-db$/m.test(body("apply-gated")) &&
      /db-apply\.js apply-gated /.test(body("apply-gated")),
  );
  check("reconcile・judge は Environment を持たない", ["reconcile", "judge"].every((j) => !/environment:/.test(body(j))));
  check(
    "record は手での起動か定期の起動の適用が成功したときだけ",
    /needs\.apply\.result == 'success'/.test(body("record")) &&
      /needs\.apply-auto\.result == 'success'/.test(body("record")) &&
      /needs\.apply-gated\.result == 'success'/.test(body("record")),
  );
  check(
    "台帳の確認の fetch に --depth を付けない（手元の clone を shallow にしない）",
    !/["']--depth/.test(readFileSync(path.join(ROOT, "scripts/db/db-apply.js"), "utf8")),
  );
  check("notify は Environment prod-jobs（Slack の鍵）", /^ {4}environment: prod-jobs$/m.test(body("notify")));
  check(
    "notify は知らせることがありうるときだけ動く（selected・blocked・承認待ち）",
    /status == 'selected'/.test(body("notify")) && /status == 'blocked'/.test(body("notify")) && /stale != '\[\]'/.test(body("notify")),
  );
  // 当てる直前の判定（apply-auto）: 重い・止めるのファイルは、DB の接続より前に落ちる
  for (const f of ["163_drop_sns_mobile_approval.sql", "166_claude_ro_readonly_role.sql"]) {
    const rel = `docs/db-migration/${f}`;
    const sha = createHash("sha256").update(readFileSync(path.join(ROOT, rel))).digest("hex");
    const env = { ...process.env, SUPABASE_DB_URL: "", DB_APPLY_DRY_RUN: "false" };
    const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/db/db-apply.js"), "apply-auto", rel, sha], { cwd: ROOT, env, encoding: "utf8" });
    check(`apply-auto は軽いでない ${f} を当てずに落とす`, r.status === 1 && /軽い」でない/.test(r.stderr), r.stderr.slice(0, 200));
  }
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
  const dir = path.join(ROOT, ".github/workflows");
  const autoUsers = readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .filter((f) => /environment:\s*(?:\n\s*name:\s*)?["']?production-db-auto\b/.test(readFileSync(path.join(dir, f), "utf8")));
  check("Environment production-db-auto を使うのは db-apply.yml だけ", eq(autoUsers, ["db-apply.yml"]), autoUsers.join(", "));
  const auto = psqlArgs("single-transaction", "docs/db-migration/999_x.sql", AUTO_TIMEOUTS);
  check(
    "自動の経路は statement を短く（120s）、lock はファイルの SET LOCAL の上限と同じ10s",
    auto.includes("SET lock_timeout = '10s'") && auto.includes("SET statement_timeout = '120s'"),
    auto.join(" "),
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

// 11. 軽い／重い／止めるの判定（ADR-0097）
{
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

// 12. 実ファイルのラベルの一覧
{
  const dir = path.join(ROOT, "docs/db-migration");
  const expected = JSON.parse(readFileSync(path.join(ROOT, "scripts/lib/__fixtures__/db-apply-labels.json"), "utf8"));
  const diffs = [];
  for (const f of readdirSync(dir).filter((x) => /^\d{3}[a-z]?_.*\.sql$/.test(x)).sort()) {
    const got = classifyMigration(readFileSync(path.join(dir, f), "utf8"), f).label;
    if (!(f in expected)) {
      console.log(`  （一覧に無い新しいファイル: ${f} → ${got}）`);
      continue;
    }
    if (expected[f] !== got) diffs.push(`${f}: 一覧 ${expected[f]} / 今 ${got}`);
  }
  check(
    "実ファイルのラベルが一覧（db-apply-labels.json）と一致する",
    diffs.length === 0,
    diffs.join("; "),
  );
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
