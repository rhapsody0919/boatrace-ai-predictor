#!/usr/bin/env node
/**
 * generate-schema-er-diagram.js — DB 全体の ER 図 docs/reference/schema-er-diagram.md を作る（基盤の計画 段6）。
 *
 *   node scripts/maintenance/generate-schema-er-diagram.js            # 作って書く
 *   node scripts/maintenance/generate-schema-er-diagram.js --dry-run  # 作るだけで書かない（件数を出す）
 *
 * 入力は本番スキーマの写し docs/reference/schema-snapshot.json だけ（ADR-0102。DB に接続しない）。
 * 組み立ては scripts/lib/schemaErDiagram.js。生成物は PR に含めず、master へのマージ後に
 * regenerate-generated-docs.yml が作り直す（generated-docs.js の GENERATED_DOCS、ADR-0078）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SNAPSHOT_FILE } from "../lib/schemaSnapshot.js";
import {
  ER_DIAGRAM_FILE,
  buildSchemaEr,
  renderSchemaErMarkdown,
} from "../lib/schemaErDiagram.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function generate() {
  const snapshot = JSON.parse(
    readFileSync(path.join(ROOT, SNAPSHOT_FILE), "utf8"),
  );
  const { counts } = buildSchemaEr(snapshot);
  // 写しが壊れて空になったときに、空の図で上書きしない
  if (counts.tables < 50 || counts.foreignKeys < 20) {
    throw new Error(
      `表 ${counts.tables}・外部キー ${counts.foreignKeys} は少なすぎる。${SNAPSHOT_FILE} が壊れていないか確かめる`,
    );
  }
  return { counts, md: renderSchemaErMarkdown(snapshot) };
}

function main() {
  const { counts, md } = generate();
  console.log(JSON.stringify(counts));
  if (process.argv.includes("--dry-run")) return;
  writeFileSync(path.join(ROOT, ER_DIAGRAM_FILE), md);
  console.error(`generate-schema-er-diagram: ${ER_DIAGRAM_FILE} に書いた`);
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`generate-schema-er-diagram: ${e.message}`);
    process.exit(1);
  }
}
