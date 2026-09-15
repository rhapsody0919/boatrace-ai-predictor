/**
 * 指定した設計slugに紐づくdocs/db-migration/のDDLから、mermaid erDiagramの
 * コードブロックを機械生成して標準出力に表示する。
 *
 * 使い方:
 *   node scripts/maintenance/generate-er-diagram.js {slug}
 *
 * `/step2`（システム設計）でplan.mdの「データ設計」に新規テーブル・新規の
 * 外部キー関係を書いたら、対応するdocs/db-migration/の.sqlファイルを
 * 作成した後にこのコマンドを実行し、出力されたmermaidブロックをそのまま
 * plan.mdに貼り付ける（`npm run verify:er-diagram`がこの有無を検証する）。
 */

import {
  findLinkedMigrations,
  parseTablesFromSql,
  buildMermaidErDiagram,
} from "../lib/erDiagramFromDdl.js";

const slug = process.argv[2];

if (!slug) {
  console.error(
    "使い方: node scripts/maintenance/generate-er-diagram.js {slug}",
  );
  console.error(
    "例:     node scripts/maintenance/generate-er-diagram.js scraping-full-coverage",
  );
  process.exit(1);
}

async function main() {
  const migrations = await findLinkedMigrations(slug);

  if (migrations.length === 0) {
    console.error(
      `docs/db-migration/配下に「docs/design/${slug}/」を参照するSQLファイルが見つかりませんでした。`,
    );
    console.error(
      "マイグレーションファイルのヘッダーコメントに対応spec/planへの参照（例: -- 対応spec/plan: docs/design/{slug}/plan.md）を書いているか確認してください。",
    );
    process.exit(1);
  }

  const allTables = new Map();
  const allRelationships = [];
  for (const { content } of migrations) {
    const { tables, relationships } = parseTablesFromSql(content);
    for (const t of tables) {
      if (!allTables.has(t.name)) {
        allTables.set(t.name, t);
      } else {
        allTables.get(t.name).columns.push(...t.columns);
      }
    }
    allRelationships.push(...relationships);
  }

  if (allTables.size === 0 && allRelationships.length === 0) {
    console.log(
      `参照SQLファイル（${migrations.map((m) => m.file).join(", ")}）にCREATE TABLE/REFERENCESが見つかりませんでした。` +
        "新規テーブル・新規リレーションが無い変更なら、ER図は不要です。",
    );
    return;
  }

  console.log(`参照SQLファイル: ${migrations.map((m) => m.file).join(", ")}\n`);
  console.log("以下をplan.mdの「データ設計」節に貼り付けてください:\n");
  console.log("```mermaid");
  console.log(
    buildMermaidErDiagram({
      tables: [...allTables.values()],
      relationships: allRelationships,
    }),
  );
  console.log("```");
}

main();
