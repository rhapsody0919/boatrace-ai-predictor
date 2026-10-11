/**
 * キャッシュ設定の整合性検証
 * Cache-Control ヘッダーと更新頻度の対応を確認
 */

import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// キャッシュ設定の定義
const CACHE_PATTERNS = {
  // 毎日1回更新（バッチ実行）
  DAILY_BATCH: {
    name: "毎日1回更新（バッチ実行）",
    expectedMaxAge: 86400,
    expectedSWR: 3600,
    examples: ["accuracy_cache", "race_history_cache", "outcome-distribution"],
  },
  // リアルタイム更新
  REALTIME: {
    name: "リアルタイム/頻繁更新",
    expectedMaxAge: 300,
    expectedSWR: 60,
    examples: ["races/today"],
  },
};

// Edge Function のマッピング
const EDGE_FUNCTIONS = {
  "api/accuracy/index.js": CACHE_PATTERNS.DAILY_BATCH,
  "api/race-history/summary.js": CACHE_PATTERNS.DAILY_BATCH,
  "api/outcome-distribution/index.js": CACHE_PATTERNS.DAILY_BATCH,
  "api/races/today.js": CACHE_PATTERNS.REALTIME,
  // ボット向け HTML の関数（ADR 0089）。材料の api/races/today.js と同じ s-maxage・swr
  "api/_lib/botPage.js": CACHE_PATTERNS.REALTIME,
};

async function verifyCacheConfig() {
  console.log("🔍 キャッシュ設定検証を開始します\n");

  let hasErrors = false;

  for (const [filePath, expectedPattern] of Object.entries(EDGE_FUNCTIONS)) {
    const fullPath = path.join(__dirname, "../../", filePath);

    try {
      const content = await fs.readFile(fullPath, "utf-8");

      // Cache-Control ヘッダーを抽出
      const cacheControlMatch = content.match(
        /["']Cache-Control["']\s*:\s*["']([^"']+)["']/,
      );
      if (!cacheControlMatch) {
        console.log(`❌ ${filePath}`);
        console.log(`   Cache-Control ヘッダーが見つかりません\n`);
        hasErrors = true;
        continue;
      }

      const cacheControl = cacheControlMatch[1];
      const maxAgeMatch = cacheControl.match(/s-maxage=(\d+)/);
      const swrMatch = cacheControl.match(/stale-while-revalidate=(\d+)/);

      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1]) : null;
      const swr = swrMatch ? parseInt(swrMatch[1]) : null;

      // 検証
      const isMaxAgeCorrect = maxAge === expectedPattern.expectedMaxAge;
      const isSwrCorrect = swr === expectedPattern.expectedSWR;

      if (isMaxAgeCorrect && isSwrCorrect) {
        console.log(`✅ ${filePath}`);
        console.log(
          `   パターン: ${expectedPattern.name} (s-maxage=${maxAge}, swr=${swr})\n`,
        );
      } else {
        console.log(`⚠️  ${filePath}`);
        console.log(`   期待: ${expectedPattern.name}`);
        console.log(
          `        s-maxage=${expectedPattern.expectedMaxAge}, swr=${expectedPattern.expectedSWR}`,
        );
        console.log(`   実際: s-maxage=${maxAge}, swr=${swr}\n`);
        hasErrors = true;
      }
    } catch (error) {
      console.log(`❌ ${filePath}`);
      console.log(`   エラー: ${error.message}\n`);
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error("\n❌ キャッシュ設定に不整合があります");
    process.exit(1);
  } else {
    console.log("\n✅ キャッシュ設定は正しく統一されています");
  }
}

verifyCacheConfig();
