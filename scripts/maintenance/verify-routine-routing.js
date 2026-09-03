/**
 * revise/redoの発火先ルーティング（ADR 0038）を検証するCLIスクリプト。
 *
 * 修正前は下書きの生成元パイプラインに関わらず一律SNS_HUB_ROUTINEを発火しており、
 * Pipeline B（ネタ駆動）産の下書きの修正指摘がPipeline A用Routineに誤発火する
 * バグがあった（docs/design/sns-topic-gate/spec.md要件21、tasks.md T7）。
 * resolveRoutineEnvPrefix()が全platform×フォールバックケースで正しくマッピング
 * されることを機械的に確認する。
 */

import { resolveRoutineEnvPrefix } from "../../api/_lib/snsHubHelpers.js";

const CASES = [
  { platform: "blog", expected: "SNS_BLOG_ROUTINE" },
  { platform: "note", expected: "SNS_NOTE_ROUTINE" },
  { platform: "x", expected: "SNS_X_ROUTINE" },
  { platform: "tiktok", expected: "SNS_TIKTOK_ROUTINE" },
  { platform: "youtube", expected: "SNS_YOUTUBE_ROUTINE" },
  // 未展開・不明なplatformはフォールバック（ADR 0037の段階展開中の暫定措置）
  { platform: "instagram", expected: "SNS_HUB_ROUTINE" },
  { platform: undefined, expected: "SNS_HUB_ROUTINE" },
];

function main() {
  const failures = [];
  for (const { platform, expected } of CASES) {
    const actual = resolveRoutineEnvPrefix(platform);
    if (actual !== expected) {
      failures.push(
        `platform='${platform}': 期待値='${expected}' 実際='${actual}'`,
      );
    }
  }

  if (failures.length === 0) {
    console.log(`✅ ルーティング解決OK（${CASES.length}ケース確認）`);
    return;
  }

  console.error(`❌ ルーティング解決エラー（${failures.length}件）:`);
  failures.forEach((f) => console.error(`   - ${f}`));
  process.exit(1);
}

main();
