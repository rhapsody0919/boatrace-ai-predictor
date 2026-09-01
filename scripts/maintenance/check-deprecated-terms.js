/**
 * 廃止済み用語の検知結果を人間が読める形で出力するCLIラッパー。
 * ロジック本体は content-ops-checks/check-deprecated-terms.js。
 */

import { checkDeprecatedTerms } from "./content-ops-checks/check-deprecated-terms.js";

async function main() {
  const { hits, checkedFileCount, error } = await checkDeprecatedTerms();

  if (error) {
    console.error("❌", error);
    process.exit(1);
  }

  if (hits.length === 0) {
    console.log(
      `✅ 廃止済み用語の残留なし（${checkedFileCount}件のファイルを確認）`,
    );
    return;
  }

  const byFile = new Map();
  for (const hit of hits) {
    if (!byFile.has(hit.file)) byFile.set(hit.file, []);
    byFile.get(hit.file).push(hit);
  }

  console.log(
    `⚠️ 廃止済み用語が${hits.length}件見つかった（${byFile.size}ファイル、確認対象${checkedFileCount}件中）\n`,
  );
  for (const [file, fileHits] of byFile) {
    console.log(file);
    for (const hit of fileHits) {
      console.log(`   L${hit.line}: "${hit.pattern}" (${hit.termId})`);
    }
  }
  console.log(
    "\n意味理解による判定ではなく機械的な文字列一致のため、実際に現行仕様と矛盾しているかは目視確認が必要。",
  );
}

main().catch((error) => {
  console.error("❌ 実行中にエラーが発生しました:", error.message);
  process.exit(1);
});
