/**
 * unifiedモデル 月次パラメータ見直しレポート（FR8、AI予想モデル大規模改修 Task16）
 *
 * 直近N日（デフォルト30日）の複勝的中率・展開予測的中率・イン崩れ相関・3連単参考回収率を
 * 既存の検証スクリプト（Task7-8bで実装済み）に委譲して出力する。自動でパラメータを
 * 書き換えることはしない（判断材料の提示のみ、係数調整は人手で行う）。
 *
 * 使い方:
 *   node scripts/maintenance/review-unified-model-params.js              # 直近30日
 *   node scripts/maintenance/review-unified-model-params.js --days=60    # 直近60日
 *   node scripts/maintenance/review-unified-model-params.js --from=2026-07-01 --to=2026-08-01
 */

import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYSIS_DIR = path.join(__dirname, "../analysis");

function parseArgs(argv = process.argv.slice(2)) {
  const get = (name) => {
    const a = argv.find((x) => x.startsWith(`--${name}=`));
    return a ? a.split("=")[1] : null;
  };
  const days = get("days") ? parseInt(get("days"), 10) : 30;
  return { from: get("from"), to: get("to"), days };
}

function jstToday() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().split("T")[0];
}

function daysAgo(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().split("T")[0];
}

function runScript(scriptName, args, label) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`📋 ${label}`);
  console.log(`${"=".repeat(70)}`);
  try {
    const output = execFileSync(
      "node",
      [path.join(ANALYSIS_DIR, scriptName), ...args],
      { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 },
    );
    console.log(output);
  } catch (error) {
    console.error(`❌ ${scriptName} 実行エラー:`, error.message);
    if (error.stdout) console.log(error.stdout);
  }
}

async function main() {
  const { from: fromArg, to: toArg, days } = parseArgs();
  const to = toArg || jstToday();
  const from = fromArg || daysAgo(to, days);

  console.log(`unifiedモデル 月次パラメータ見直しレポート`);
  console.log(`対象期間: ${from} 〜 ${to}`);
  console.log(
    `\n⚠️ このレポートは判断材料の提示のみ。係数調整は人手でscripts/lib/配下の該当ファイルを編集して行う`,
  );

  const rangeArgs = [`--from=${from}`, `--to=${to}`];

  runScript(
    "backtest-course-rate-only.js",
    rangeArgs,
    "FR1 複勝予想（コース別勝率）",
  );
  runScript(
    "verify-turn-prediction-accuracy-v6.js",
    rangeArgs,
    "FR2 展開予測の的中率",
  );
  runScript(
    "verify-volatility-predictive-power.js",
    rangeArgs,
    "FR3 イン崩れ指数パーセンタイルの予測力",
  );
  runScript(
    "backtest-unified-model.js",
    rangeArgs,
    "FR4 3連単参考情報（EV閾値別回収率）",
  );

  console.log(`\n${"=".repeat(70)}`);
  console.log(
    "✅ レポート完了。各指標の悪化・改善傾向を確認し、必要な場合のみ係数を見直す",
  );
  console.log(`${"=".repeat(70)}`);
}

main().catch((error) => {
  console.error("❌ エラー:", error);
  process.exit(1);
});
