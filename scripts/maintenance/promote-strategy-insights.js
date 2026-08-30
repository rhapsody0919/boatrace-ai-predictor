// SNSマーケティングハブ Phase 2: insight週次昇格処理
// docs/design/sns-hub-phase2-pdca-loop/plan.md「Routine側の変更」、ADR 0030参照
//
// status='proposed'かつ提案から1週間以上経過したinsightを対象に、
// risk-rules.jsonとの決定的パターンマッチ（ADR 0028）で照合し、
// 抵触しなければactiveへ昇格、抵触すればretiredにする。
// sns-hub-content-generation Routineの週次バッチ生成フロー（月曜）冒頭から呼び出される想定。
//
// 使用方法:
//   node scripts/maintenance/promote-strategy-insights.js

import { checkRiskRules } from "../lib/riskRules.js";
import {
  getProposedInsightsForPromotion,
  activateInsight,
  retireInsight,
} from "../lib/snsStrategyInsights.js";

async function main() {
  console.log("=== insight週次昇格処理 ===");

  const targets = await getProposedInsightsForPromotion();
  console.log(`昇格判定対象: ${targets.length}件`);

  if (targets.length === 0) {
    console.log("対象なし。終了します。");
    return;
  }

  let activatedCount = 0;
  let retiredCount = 0;
  let failedCount = 0;

  for (const insight of targets) {
    try {
      const violations = checkRiskRules(insight.insight_text, insight.platform);

      if (violations.length > 0) {
        const reason = `risk-rules抵触のため自動却下: ${violations
          .map((v) => `${v.id}(${v.matchedPattern})`)
          .join(", ")}`;
        await retireInsight(insight.id, reason);
        retiredCount += 1;
        console.log(`  [retired] ${insight.id}: ${reason}`);
        continue;
      }

      await activateInsight(insight.id);
      activatedCount += 1;
      console.log(
        `  [active] ${insight.id}: ${insight.insight_text.slice(0, 40)}...`,
      );
    } catch (error) {
      // 1件の失敗（一時的なネットワーク断等）が他の独立したinsightの判定を
      // 巻き込んで中断させないよう、ログに残して次のinsightの処理を続ける
      failedCount += 1;
      console.error(`  [failed] ${insight.id}: ${error.message}`);
    }
  }

  console.log("");
  console.log(
    `完了: active化 ${activatedCount}件 / risk-rules抵触でretired化 ${retiredCount}件 / 失敗 ${failedCount}件`,
  );

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("insight昇格処理で予期しないエラーが発生しました:", error);
  process.exit(1);
});
