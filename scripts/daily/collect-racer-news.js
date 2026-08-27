// 選手ニュース自動収集オーケストレーター
// docs/design/racer-news-auto-collect/plan.md 2節 参照
//
// 現時点ではFR2（レーサーデータカテゴリの節目記録取り込み）のみを実行する。
// FR1（グレードレース優勝）・FR5（会場選手コメント）は見送り済み（spec.md「却下した要件」参照）。

import { collectGradeAnnouncementNews } from "../lib/racerNews/officialGradeAnnouncements.js";

function logSummary(label, summary) {
  console.log(
    `${label}: 生成${summary.generated}件 / 要確認${summary.pending}件 / スキップ${summary.skipped}件 / エラー${summary.errors}件`,
  );
}

async function main() {
  console.log("=== 選手ニュース自動収集 開始 ===");

  const fr2Summary = await collectGradeAnnouncementNews();
  logSummary("FR2（レーサーデータ節目記録）", fr2Summary);

  console.log("=== 選手ニュース自動収集 完了 ===");
}

main().catch((err) => {
  console.error("選手ニュース自動収集で致命的なエラーが発生しました:", err);
  process.exit(1);
});
