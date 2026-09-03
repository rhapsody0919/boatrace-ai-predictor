/**
 * sns_drafts.format列の語彙統一（docs/design/sns-topic-gate/spec.md要件12・22）の
 * 移行整合性を検証するCLIスクリプト。
 *
 * 修正前のcontent-multi-channel-pipeline（Pipeline B）は、本来ビジュアル
 * テンプレート名を入れるべきformat列に「ネタのsourceId」
 * （new-feature/venue-characteristic/data-insight/daily-result）を格納していた。
 * 2026-09-03のドキュメント修正以降に生成される新規行はこの値を使わないはずだが、
 * 修正前に生成された既存行にはまだ残っている可能性がある。件数を報告する
 * （既存データの一括書き換えは本タスクのスコープ外、実データを見て要否を判断する）。
 */

import {
  supabase,
  isSupabaseEnabled,
  fetchAll,
} from "../lib/supabaseClient.js";

const LEGACY_TOPIC_SOURCE_IDS = [
  "new-feature",
  "venue-characteristic",
  "data-insight",
  "daily-result",
];

async function main() {
  if (!isSupabaseEnabled()) {
    console.error("❌ Supabase環境変数が未設定のため検証をスキップできません");
    process.exit(1);
  }

  const drafts = await fetchAll(
    "sns_drafts",
    "id,platform,format,created_at",
    (q) => q,
  );

  const legacyRows = drafts.filter((d) =>
    LEGACY_TOPIC_SOURCE_IDS.includes(d.format),
  );

  console.log(`全下書き ${drafts.length}件を確認`);

  if (legacyRows.length === 0) {
    console.log(
      "✅ format列にネタのsourceId（旧語彙）を格納している行は見つからなかった",
    );
    return;
  }

  console.log(
    `⚠️ format列にネタのsourceId（旧語彙）が残っている行が${legacyRows.length}件見つかった（修正前に生成された既存データ、要目視確認）:`,
  );
  for (const row of legacyRows) {
    console.log(
      `   - id=${row.id} platform=${row.platform} format=${row.format} created_at=${row.created_at}`,
    );
  }
  console.log(
    "\nこれらは書き換え必須ではないが、進捗マトリクスUI等で型バッジが正しく出ない可能性がある（紐づくsns_topicsが無いため）。新規生成分から順次是正される想定。",
  );
}

main().catch((error) => {
  console.error("❌ 検証中にエラーが発生しました:", error.message);
  process.exit(1);
});
