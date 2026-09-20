// 選手ニュースの要確認リスト（DBの表 racer_news_pending）の項目を、承認・却下として記録する
// docs/design/scraping-vercel-consolidation/tasks.md T4b-15-1 / .claude/rules/content-ops.md フローC-4
//
// 従来は、承認・却下の反映として pending.json の該当項目の status を手で書き換えていた。
// 要確認リストがDBに移った（080_racer_news_pending.sql）ため、この CLI で更新する。
// 承認した候補の racer_news への投入は、従来どおり scripts/maintenance/add-racer-news.js で行う（本CLIは投入しない）。
//
// 使用方法:
//   node scripts/maintenance/resolve-racer-news-pending.js --list                     # 未確認の一覧
//   node scripts/maintenance/resolve-racer-news-pending.js --id=<id> --status=approved
//   node scripts/maintenance/resolve-racer-news-pending.js --id=<id> --status=rejected

import { supabase } from "../lib/supabaseClient.js";
import { createDbPendingStore } from "../lib/racerNews/pendingReview.js";

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else {
      const match = arg.match(/^--([a-z-]+)=(.*)$/s);
      if (!match) throw new Error(`不明な引数です: ${arg}`);
      options[match[1]] = match[2];
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!supabase) {
    throw new Error(
      "Supabase の環境変数が未設定です（SUPABASE_URL・SUPABASE_SERVICE_KEY）",
    );
  }
  const store = createDbPendingStore(supabase);

  if (options.list) {
    const items = await store.listPending();
    console.log(`未確認: ${items.length}件`);
    for (const item of items) {
      console.log(JSON.stringify(item, null, 2));
    }
    return;
  }

  const { id, status } = options;
  if (!id || !["approved", "rejected"].includes(status)) {
    throw new Error(
      "--id=<id> と --status=approved|rejected を指定してください（一覧は --list）",
    );
  }
  await store.updateStatus(id, status);
  console.log(`更新しました: ${id} → ${status}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
