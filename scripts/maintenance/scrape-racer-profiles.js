// 選手プロフィール取得スクリプト（生年月日・支部・出身地等 + 期別成績）
//
// BOA-321（期別成績・能力指数）/ BOA-322（racer_profiles自動更新化）対応
// （docs/design/scraping-full-coverage/ FR-2/FR-5）。
// racer_profiles登録済みの選手と、直近に出走した選手（新規選手の検出）を1回巡回し、
// 選手ごとに以下を行う。処理本体は scripts/lib/racerProfileSync.js:
//   1. racer_profiles未登録の選手のみ: 基本プロフィール（生年月日・支部等）を取得・登録（FR-5）
//   2. 全選手: 期別成績ページ（能力指数・フライング回数・出遅れ回数・公式勝率等）を取得し、
//      値が変わっている選手だけ更新（FR-2）
// 失敗（期別成績の失敗率が5%超・書き込み0件・時間予算での中断等）は終了コード1で終了する。
//
// 使用方法:
//   node scripts/maintenance/scrape-racer-profiles.js
//   node scripts/maintenance/scrape-racer-profiles.js --dry-run --racer-ids=3159,4444 --verbose
//   node scripts/maintenance/scrape-racer-profiles.js --limit=10 --verbose
// オプション:
//   --racer-ids=1234,5678  指定した登録番号だけを対象にする（初回実行の少数確認用）
//   --limit=N / --offset=N 登録番号昇順の並びに対する件数・開始位置（途中再開用）
//   --recent-days=N        新規選手の検出に使う直近の出走日数（既定35）
//   --max-minutes=N        経過時間がNを超えたら中断して終了コード1（再開用の --offset をログ・レポートに出す）
//   --delay-ms=N           公式サイトへのリクエスト間隔（既定500ms）
//   --dry-run              DBへ書き込まない（公式サイトの取得・解析までは行う）

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";
import { parseArgs, runRacerProfileSync } from "../lib/racerProfileSync.js";

const REPORT_DIR = "data/analysis/racer-fortune-telling";
const REPORT_PATH = path.join(REPORT_DIR, "profile-scrape-report.json");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { summary, verdict } = await runRacerProfileSync({
    client: supabase,
    options,
  });

  if (!options.dryRun) {
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      REPORT_PATH,
      JSON.stringify({ ...summary, failureReasons: verdict.reasons }, null, 2),
    );
    console.log(`レポート保存: ${REPORT_PATH}`);
  }

  if (!verdict.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
