#!/usr/bin/env node
/**
 * GitHub Actions（content-ops-nightly-check.yml）から呼ばれる、機械的チェック
 * 3種（トレーサビリティ索引・視覚素材鮮度・品質バックログ）の夜間サマリー。
 * 外部サイト閲覧を伴わない項目のみを扱う（詳細: docs/design/content-ops-flow/plan.md）。
 *
 * 閾値を超えている場合のみ、Slack通知用のテキストをstdoutに出力し、
 * exit code 1 を返す（ワークフロー側はexit codeで通知要否を判断する）。
 */

import { checkContentIndexCoverage } from "./check-content-index-coverage.js";
import { checkVisualAssetAge } from "./check-visual-asset-age.js";
import { checkQualityBacklog } from "./check-quality-backlog.js";

const VISUAL_ASSET_STALE_DAYS = 90;
const QUALITY_BACKLOG_ALERT_COUNT = 10;

async function main() {
  const [contentIndex, visualAssets, qualityBacklog] = await Promise.all([
    checkContentIndexCoverage(),
    checkVisualAssetAge(),
    checkQualityBacklog({ surfaceCount: 0 }).catch((error) => ({
      openCount: 0,
      error: error.message,
    })),
  ]);

  const staleAssets = visualAssets.assets.filter(
    (a) => (a.ageDays ?? 0) >= VISUAL_ASSET_STALE_DAYS,
  );

  const alerts = [];
  if (contentIndex.invalidFiles.length > 0) {
    alerts.push(
      `content-index.json 形式エラー: ${contentIndex.invalidFiles.length}件`,
    );
  }
  if (staleAssets.length > 0) {
    alerts.push(
      `視覚素材が${VISUAL_ASSET_STALE_DAYS}日以上未更新: ${staleAssets.length}件（最古: ${staleAssets[0].path}, ${staleAssets[0].ageDays}日）`,
    );
  }
  if (qualityBacklog.openCount >= QUALITY_BACKLOG_ALERT_COUNT) {
    alerts.push(`品質バックログが滞留: ${qualityBacklog.openCount}件`);
  }

  if (alerts.length === 0) {
    console.log("OK: 閾値超過なし");
    process.exit(0);
  }

  console.log(alerts.join("\n"));
  process.exit(1);
}

main().catch((error) => {
  console.error("❌ nightly-summary 実行中にエラー:", error.message);
  process.exit(1);
});
