/**
 * docs/design/{slug}/plan.md が、新規テーブルまたは新規の外部キー関係を
 * 導入するdocs/db-migration/のDDLを持っているにもかかわらず、mermaid
 * erDiagramブロックを含んでいないケースを検知する。
 *
 * 「実装前にER図を手で描く」という散文ルールだけでは、コンテキストが
 * 圧迫される長時間セッションで読み飛ばされるリスクが高いと判断し
 * （2026-09-15、天才エンジニア視点レビューでの指摘）、機械的に検証する。
 * ER図自体は `node scripts/maintenance/generate-er-diagram.js {slug}` で
 * DDLから逆算生成できる。
 *
 * 使い方:
 *   node scripts/maintenance/verify-plan-erd.js
 */

import { promises as fs } from "fs";
import path from "path";
import {
  DESIGN_DIR,
  findLinkedMigrations,
  parseTablesFromSql,
} from "../lib/erDiagramFromDdl.js";

async function listSlugs() {
  const entries = await fs.readdir(DESIGN_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function hasErDiagram(slug) {
  const planPath = path.join(DESIGN_DIR, slug, "plan.md");
  try {
    const content = await fs.readFile(planPath, "utf-8");
    return /```mermaid\s*\n\s*erDiagram/i.test(content);
  } catch {
    return null; // plan.md自体が無い（spec段階で止まっている等）
  }
}

async function main() {
  const slugs = await listSlugs();
  const missing = [];

  for (const slug of slugs) {
    const migrations = await findLinkedMigrations(slug);
    if (migrations.length === 0) continue;

    const introducesSchema = migrations.some(({ content }) => {
      const { tables, relationships } = parseTablesFromSql(content);
      const hasNewTable = tables.some((t) => t.newTable);
      return hasNewTable || relationships.length > 0;
    });
    if (!introducesSchema) continue;

    const erdPresent = await hasErDiagram(slug);
    if (erdPresent === null) continue; // plan.md未作成はこのスクリプトの対象外
    if (!erdPresent) {
      missing.push({ slug, migrations: migrations.map((m) => m.file) });
    }
  }

  if (missing.length === 0) {
    console.log(
      "OK: 新規テーブル・新規リレーションを導入するdocs/design/*/plan.mdは、すべてmermaid erDiagramを含んでいます。",
    );
    return;
  }

  console.error(
    `NG: ${missing.length}件のplan.mdが新規テーブル・新規リレーションを導入しているのにER図がありません。\n`,
  );
  for (const { slug, migrations } of missing) {
    console.error(`  - docs/design/${slug}/plan.md`);
    console.error(`    根拠となるDDL: ${migrations.join(", ")}`);
    console.error(
      `    修正方法: node scripts/maintenance/generate-er-diagram.js ${slug}`,
    );
  }
  process.exit(1);
}

main();
