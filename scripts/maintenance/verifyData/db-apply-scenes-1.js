/**
 * verify-db-apply.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-db-apply.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import path from "node:path";
import {
  extractTables,
  inspectMigration,
  extractConfirmationSections,
  markAppliedInLedger,
  isAppliedInLedger,
} from "../../lib/dbApplySql.js";

let ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4;

// 6. 台帳
/** { の中身を割った 1/3 */
function dbApplyLedger1() {
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
  return { args };
}

/** { の中身を割った 3/3 */
function dbApplyLedger3({ args, real }) {
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
/** { の中身を割った 1/4 */
function dbApplyRealFiles1() {
  const dir = path.join(ROOT, "docs/db-migration");
  const rejected = [];
  // 導入時点（122 まで）のファイルに限る。以後のファイルが CONCURRENTLY 等を含んでも（手で適用するもの）、
  // 無関係な PR の CI を落とさない
  const atIntroduction = (x) => x.endsWith(".sql") && Number.parseInt(x, 10) <= 122;
  return { dir, rejected, atIntroduction };
}

/** { の中身を割った 3/4 */
function dbApplyRealFiles3({ rejected }) {
  check(
    "実ファイル（122 まで）で拒否されるのは CONCURRENTLY を含む 050・055 だけ",
    eq(rejected.sort(), [
      "050_race_entries_racer_id_index.sql",
      "055_get_latest_racer_grades_rpc.sql",
    ]),
    rejected.join(", "),
  );
}

/** { の中身を割った 2/5 */
export function dbApplyWiring2() {
  const jobs = {};
  return { jobs };
}

/** { の中身を割った 4/5 */
export function dbApplyWiring4({ jobs, yml }) {
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
  return { body, runLines };
}

function scene1() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes1(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);
  scene1();
}

function scene2() {
  {
    const { args } = dbApplyLedger1();
    const { real } = dbApplyLedger2();
    dbApplyLedger3({ args, real });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes2(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);
  scene2();
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes3(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);

}

function scene3() {
  {
    const { dir, rejected, atIntroduction } = dbApplyRealFiles1();
    dbApplyRealFiles2({ atIntroduction, dir, rejected });
    dbApplyRealFiles3({ rejected });
    dbApplyRealFiles4({ dir });
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes4(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);
  scene3();
}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes5(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（ROOT・check・eq・dbApplyLedger2・dbApplyRealFiles2・dbApplyRealFiles4） */
export function runDbApplyScenes6(env) {
  ({ ROOT, check, eq, dbApplyLedger2, dbApplyRealFiles2, dbApplyRealFiles4 } = env);

}
