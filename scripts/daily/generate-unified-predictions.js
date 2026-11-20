/**
 * 新AI予想モデル「unified」朝の日次バッチ（Task9a、オッズ不要）
 *
 * FR1複勝予想・FR2展開予測・FR3イン崩れバッジを算出し、predictions（model_id='unified'）へ
 * 書き込む。BOA-822 のイン崩れ注意度（feature_contributions.inCaution）も書く（夜の表の RPC を1回読む。
 * 旧キー volatility* は、読み手を全部切り替えるまで書き続ける。docs/design/in-collapse-caution/plan.md §1）。FR4（3連単参考情報）はオッズが必要なため、別バッチ
 * generate-unified-trifecta-reference.js（Task9b、発走前）で扱う（plan.md参照）。
 *
 * predictions.top_pick/top_2nd/top_3rd の意味（model_id='unified'の場合）:
 *   top_pick = 複勝予想1位艇、top_2nd = 複勝予想2位艇、top_3rd = 未使用（null）
 *   ※他モデル（standard等）とは意味が異なる。feature_contributions.placeRecommendationが正本
 *
 * 使い方:
 *   node scripts/daily/generate-unified-predictions.js              # 今日
 *   node scripts/daily/generate-unified-predictions.js --date=2026-08-13
 *   node scripts/daily/generate-unified-predictions.js --dry-run
 *   node scripts/daily/generate-unified-predictions.js --date=2026-08-13 --include-started  # 発走済みも書く（過去日の作り直し）
 *
 * 発走済みのレースは、既定では書かない（BOA-628）。発走後に作り直すと、発走後のデータ（結果を含む集計等）で作った
 * 予想が、発走前の予想に見えてしまう（2026年8月は、当日の結果を含む racer_aggregated_stats で作り直した日があった）
 */

import { fileURLToPath } from "node:url";
import { getTodayDateJST, parseDateArg } from "../lib/dateUtils.js";
import { generateUnifiedPredictions } from "../lib/unifiedPredictionsRun.js";

function parseArgs(argv = process.argv.slice(2)) {
  return {
    dryRun: argv.includes("--dry-run"),
    includeStarted: argv.includes("--include-started"),
  };
}

async function main() {
  const { dryRun, includeStarted } = parseArgs();
  const date = parseDateArg() || getTodayDateJST();
  await generateUnifiedPredictions({ date, dryRun, includeStarted });
}

// スタンドアローン実行時のみ実行する（import 時に実行させない。Vercel Function から import される）
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("❌ エラー:", error);
    process.exit(1);
  });
}

export {
  findRacesMissingUnified,
  generateUnifiedPredictions,
} from "../lib/unifiedPredictionsRun.js";
