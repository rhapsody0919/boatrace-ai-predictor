/**
 * sns_topic_targetsのclaim機構（ADR 0036）の並行実行テスト。
 *
 * 複数のチャネル別パイプラインが同時に同じターゲットをポーリング・claimしようと
 * しても、成功するのは1件のみであることを実際のSupabase接続で検証する
 * （docs/design/sns-topic-gate/spec.md要件20、tasks.md T10）。
 * テスト用のネタ・ターゲットを作成→並行claim→結果確認→後始末の順に実行する。
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import {
  getContentTypeByKey,
  getTargetAccounts,
  createTopicWithTargets,
  claimTopicTarget,
} from "../lib/snsTopics.js";

async function cleanup(topicId) {
  // sns_topic_targetsはON DELETE CASCADEのため、sns_topicsの削除だけで良い
  const { error } = await supabase
    .from("sns_topics")
    .delete()
    .eq("id", topicId);
  if (error) {
    console.error(
      `⚠️ テストデータの後始末に失敗: ${error.message}（手動削除が必要）`,
    );
  }
}

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定のため検証をスキップできません");
    process.exit(1);
  }

  const contentType = await getContentTypeByKey("daily-auto");
  if (!contentType) {
    console.error(
      "❌ sns_content_typesに'daily-auto'が見つかりません。マイグレーション043が適用済みか確認してください",
    );
    process.exit(1);
  }
  const [account] = await getTargetAccounts({ platform: "x" });
  if (!account) {
    console.error(
      "❌ sns_target_accountsにplatform='x'が見つかりません。マイグレーション043が適用済みか確認してください",
    );
    process.exit(1);
  }

  const { topic, targets } = await createTopicWithTargets({
    topicText: "[verify-topic-target-claim.js テスト用、削除してよい]",
    contentTypeId: contentType.id,
    autoApprove: true,
    targetAccountIds: [account.id],
  });
  const target = targets[0];

  try {
    // 2つの独立したパイプライン実行を模して同時にclaimを試みる
    const [resultA, resultB] = await Promise.all([
      claimTopicTarget(target.id, "test-routine-run-a"),
      claimTopicTarget(target.id, "test-routine-run-b"),
    ]);

    const successCount = [resultA, resultB].filter(Boolean).length;

    if (successCount === 1) {
      console.log(
        "✅ claim機構OK: 並行呼び出しのうち成功は1件のみだった（二重生成は起きない）",
      );
    } else {
      console.error(
        `❌ claim機構エラー: 並行呼び出しで${successCount}件が成功した（1件であるべき）`,
      );
      process.exit(1);
    }
  } finally {
    await cleanup(topic.id);
  }
}

main().catch((error) => {
  console.error("❌ 検証中にエラーが発生しました:", error.message);
  process.exit(1);
});
