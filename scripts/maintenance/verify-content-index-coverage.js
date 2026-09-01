/**
 * docs/design/{slug}/content-index.json の形式を検証するCLIラッパー。
 * ロジック本体は content-ops-checks/check-content-index-coverage.js
 * （session-start-check.js・GitHub Actionsからも同じロジックを共有する）。
 */

import { checkContentIndexCoverage } from "./content-ops-checks/check-content-index-coverage.js";

async function main() {
  const { checkedCount, invalidFiles } = await checkContentIndexCoverage();

  if (invalidFiles.length === 0) {
    console.log(`✅ content-index.json 整合性OK（${checkedCount}件を確認）`);
    return;
  }

  console.error(
    `❌ content-index.json の形式エラー（${invalidFiles.length}件）:`,
  );
  for (const { file, errors } of invalidFiles) {
    console.error(`\n${file}`);
    errors.forEach((e) => console.error(`   - ${e}`));
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("❌ 検証中にエラーが発生しました:", error.message);
  process.exit(1);
});
