#!/usr/bin/env node
/**
 * verify-display-coverage.js — 表示カバレッジ台帳がソースと一致しているかを機械検査する。
 *
 * 台帳（docs/reference/display-coverage.md）は
 * scripts/maintenance/generate-display-coverage.js がマイグレーションと src/・api/ から生成する。
 *
 * なぜ検査するか: 手で書いた台帳は必ず陳腐化する。取得側は台帳を3本持っていたのに、
 * orchestration.md 自身が「WS4bが『未着手』のままだが実際には21ジョブがliveで稼働していた。
 * この乖離自体が、オーケストレーションの記録として直すべき点」と書いている。
 * 共通ロジック索引（verify-lib-index.js）・ER図（ADR-0065）と同じ方式で最新性を担保する。
 *
 * 併せて、抽出のロジック（SQLコメントの除去・関係の収集・コードの参照抽出）も
 * 固定の入力で検証する。抽出が壊れると台帳が静かに空になり、最新性の検査も通ってしまうため。
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRelations,
  extractCodeReferences,
  OUT_PATH,
  stripSqlComments,
} from "./generate-display-coverage.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const failures = [];
let checked = 0;

function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

// --- SQLコメントの除去 ---
// マイグレーションはロールバック手順を `--` コメントで併記する（081など）。
// 外さないと、コメント内の DROP TABLE / GRANT を本物として拾ってしまう。
check(
  "行コメント内のDROPは無視される",
  stripSqlComments("CREATE TABLE a (x int);\n-- DROP TABLE a;").includes(
    "DROP TABLE",
  ),
  false,
);
check(
  "ブロックコメントも落とす",
  stripSqlComments(
    "/* GRANT SELECT ON a TO anon; */ CREATE TABLE a ();",
  ).includes("GRANT"),
  false,
);
check(
  "コメント外のSQLは残る",
  stripSqlComments("CREATE TABLE a (); -- 説明").includes("CREATE TABLE a"),
  true,
);

// --- 関係の収集 ---
const rel = (sql, file = "001_x.sql") => collectRelations([{ file, sql }]);

check(
  "CREATE TABLE IF NOT EXISTS と public. 修飾を同一視する",
  rel("CREATE TABLE IF NOT EXISTS public.Foo (x int);").map((r) => [
    r.name,
    r.kind,
  ]),
  [["foo", "table"]],
);
check(
  "ビューも拾う",
  rel("CREATE OR REPLACE VIEW v_a AS SELECT 1;").map((r) => r.kind),
  ["view"],
);
check(
  "GRANT SELECT … TO anon を権限ありと判定する",
  rel("CREATE TABLE a (); GRANT SELECT ON a TO anon, authenticated;").map((r) =>
    Boolean(r.grantAnon),
  ),
  [true],
);
check(
  "anonを含まないGRANTは権限ありにしない",
  rel("CREATE TABLE a (); GRANT SELECT ON a TO service_role;").map((r) =>
    Boolean(r.grantAnon),
  ),
  [false],
);
check(
  "FOR SELECT のポリシーを拾う",
  rel('CREATE TABLE a (); CREATE POLICY "p" ON a FOR SELECT USING (true);').map(
    (r) => Boolean(r.selectPolicy),
  ),
  [true],
);
check(
  "FOR INSERT のポリシーは読み取り権限として数えない",
  rel(
    'CREATE TABLE a (); CREATE POLICY "p" ON a FOR INSERT WITH CHECK (true);',
  ).map((r) => Boolean(r.selectPolicy)),
  [false],
);
check(
  "後で DROP されたテーブルは対象外",
  rel("CREATE TABLE a (); DROP TABLE a;").length,
  0,
);
check(
  "同じファイル内で作り直されたテーブルは残す",
  rel("DROP TABLE IF EXISTS a; CREATE TABLE a (x int);").length,
  1,
);

// --- コードの参照抽出 ---
check(
  'supabase.from("t") を拾う',
  extractCodeReferences('await supabase.from("races").select("*")').tables,
  ["races"],
);
check(
  ".rpc( の直後に改行が入る書き方を拾う（実在する）",
  extractCodeReferences('await supabase.rpc(\n  "get_today_races",\n  {}\n)')
    .rpcs,
  ["get_today_races"],
);
check(
  "REST直叩きのテーブルを拾う（api/ のEdge Functionsが使う）",
  extractCodeReferences("`${URL}/rest/v1/sns_drafts?select=*`").tables,
  ["sns_drafts"],
);
check(
  "rest/v1/rpc/ はRPCとして拾い、rpc をテーブル名にしない",
  extractCodeReferences("`${URL}/rest/v1/rpc/get_today_races`"),
  { tables: [], rpcs: ["get_today_races"] },
);
check(
  "同じ参照を重複させない",
  extractCodeReferences('.from("a");\n.from("a")').tables,
  ["a"],
);
check(
  "先頭にドットが無い from( は拾わない（SQL文字列やJS変数名の誤検出を避ける）",
  extractCodeReferences('const sql = `select * from("a")`').tables,
  [],
);

if (failures.length > 0) {
  console.error(
    "NG: 表示カバレッジ台帳の抽出ロジックが期待どおりに動いていません",
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

// --- 生成物がソースと一致しているか ---
try {
  execFileSync(
    "node",
    [
      path.join(repoRoot, "scripts/maintenance/generate-display-coverage.js"),
      "--check",
    ],
    { stdio: "inherit", cwd: repoRoot },
  );
} catch {
  process.exit(1);
}

console.log(
  `OK: 抽出ロジック${checked}件と、${path.relative(repoRoot, OUT_PATH)} の最新性を検証`,
);
