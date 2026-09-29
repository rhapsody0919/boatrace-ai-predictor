#!/usr/bin/env node
/**
 * ソースから機械生成してリポジトリに置いている文書の一覧と、まとめて作り直すCLI（ADR-0078）。
 *
 * ここに載せた生成物は PR に含めない。masterへのマージ後に
 * .github/workflows/regenerate-generated-docs.yml がこのCLIで作り直し、差分があれば
 * コミットする。PRに含めると、生成物はほぼ全PRで変わるため、並行するPRが同じファイルで
 * コンフリクトする（GitHubのマージは .gitattributes のマージドライバを使わないので、
 * 属性では解消できない）。
 *
 * 一覧を使う場所:
 *   - regenerate-generated-docs.yml（作り直し・コミット対象のパス）
 *   - verify-generated-docs-not-in-pr.js（PRが生成物を変更していないかの検査）
 *
 * 新しい生成物を追加するときは、ここに1行足す。生成スクリプトは
 * 「引数なしで書き込み、--dry-run で書き込まずに生成だけ試す」形にそろえる。
 *
 * 使い方:
 *   node scripts/maintenance/generated-docs.js regenerate   # 全件を作り直して書き込む
 *   node scripts/maintenance/generated-docs.js paths        # 生成物のパスを1行ずつ出す
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** @type {ReadonlyArray<{ output: string, generator: string }>} */
export const GENERATED_DOCS = Object.freeze([
  {
    output: "docs/reference/shared-logic-index.md",
    generator: "scripts/maintenance/generate-lib-index.js",
  },
  {
    output: "docs/reference/display-coverage.md",
    generator: "scripts/maintenance/generate-display-coverage.js",
  },
]);

function regenerate() {
  for (const { generator } of GENERATED_DOCS) {
    // 1本でも失敗したら非ゼロで終わる（途中までの生成物をコミットさせない）
    execFileSync("node", [path.join(repoRoot, generator)], {
      stdio: "inherit",
      cwd: repoRoot,
    });
  }
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (invokedDirectly) {
  const command = process.argv[2];
  if (command === "regenerate") {
    regenerate();
  } else if (command === "paths") {
    for (const { output } of GENERATED_DOCS) console.log(output);
  } else {
    console.error(
      "使い方: node scripts/maintenance/generated-docs.js <regenerate|paths>",
    );
    process.exit(2);
  }
}
