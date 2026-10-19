/**
 * revise/redoの発火先ルーティング（ADR 0038）を検証するCLIスクリプト。
 *
 * 修正前は下書きの生成元パイプラインに関わらず一律SNS_HUB_ROUTINEを発火しており、
 * Pipeline B（ネタ駆動）産の下書きの修正指摘がPipeline A用Routineに誤発火する
 * バグがあった（docs/design/sns-topic-gate/spec.md要件21、tasks.md T7）。
 * resolveRoutineEnvPrefix()が全platform×フォールバックケースで正しくマッピング
 * されることを機械的に確認する。
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveRoutineEnvPrefix,
  isRetiredPlatform,
} from "../../api/_lib/snsHubHelpers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const CASES = [
  { platform: "blog", expected: "SNS_BLOG_ROUTINE" },
  { platform: "note", expected: "SNS_NOTE_ROUTINE" },
  { platform: "x", expected: "SNS_X_ROUTINE" },
  { platform: "youtube", expected: "SNS_YOUTUBE_ROUTINE" },
  // 未展開・不明なplatformはフォールバック（ADR 0037の段階展開中の暫定措置）
  { platform: "instagram", expected: "SNS_HUB_ROUTINE" },
  // TikTok は運用をやめたので専用の Routine は無い（過去の tiktok の下書きはフォールバック）
  { platform: "tiktok", expected: "SNS_HUB_ROUTINE" },
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

  // 運用をやめたプラットフォームは、作り直し・今すぐ生成の入口（redo.js・fire.js）で止める
  for (const [platform, expected] of [
    ["tiktok", true],
    ["x", false],
    ["youtube", false],
    [undefined, false],
  ]) {
    if (isRetiredPlatform(platform) !== expected) {
      failures.push(`isRetiredPlatform('${platform}'): 期待値=${expected}`);
    }
  }
  for (const file of [
    "api/admin/sns-hub/drafts/[id]/redo.js",
    "api/admin/sns-hub/topics/[id]/targets/[targetId]/fire.js",
  ]) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    if (!/if \(isRetiredPlatform\(/.test(src)) {
      failures.push(`${file}: isRetiredPlatform で止めていない`);
    }
  }

  if (failures.length === 0) {
    console.log(`✅ ルーティング解決OK（${CASES.length}ケース確認、やめたプラットフォームの止め方も確認）`);
    return;
  }

  console.error(`❌ ルーティング解決エラー（${failures.length}件）:`);
  failures.forEach((f) => console.error(`   - ${f}`));
  process.exit(1);
}

main();
