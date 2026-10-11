/**
 * aggregate-racer-stats.js（racer_aggregated_stats の日次集計）の取得・書き込み・起動の規則を守る（BOA-600）。
 *
 * ソースを読むだけの静的な検査（実DBに触らない）。
 *
 * 1. 取得エラーを握りつぶさない。以前は race_results の取得エラーで `continue` し、
 *    一部のレースだけで集計した分布をそのまま保存していた
 * 2. race_entries は fetchRacerEntries（ページング・例外。BOA-581）を通す。以前は4つの集計関数が
 *    .range() 無しで取り、1000行の上限で黙って切れる・エラーで null（データなし）になる作りだった
 * 3. 書き込みは upsertChangedRows（変わった行だけ）。以前は1日2回、全行を無条件に UPDATE していた
 * 4. aggregate-stats.yml は cron-job.org の workflow_dispatch だけで起動する（schedule を残すと
 *    3〜4時間遅れて同じ集計がもう一度走る）
 * 5. 枠番別の出走数（course_race_counts）は直近1年（BOA-824）。以前は全期間で、画面の注記と食い違っていた
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const script = fs.readFileSync(
  path.join(root, "scripts/analysis/aggregate-racer-stats.js"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/aggregate-stats.yml"),
  "utf8",
);

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "✅" : "❌"} ${label}`);
  if (!ok) failures.push(label);
};

check(
  "取得エラーを console.error して continue で飛ばす箇所が無い",
  !/取得エラー[^\n]*\n\s*continue;/.test(script),
);
check(
  "race_entries を集計関数の中で直接 .from() で取らない（fetchRacerEntries を通す）",
  !/\.from\("race_entries"\)\s*\n?\s*\.select\("race_id, boat_number"\)/.test(
    script,
  ),
);
check(
  "race_results の取得は fetchAll（throwOnError）を通す",
  /fetchAll\(\s*"race_results"[\s\S]*?throwOnError: true/.test(script) &&
    !/\.from\("race_results"\)/.test(script),
);
check(
  "racer_aggregated_stats への書き込みは upsertChangedRows を通し、calculated_at を比較から外す",
  /upsertChangedRows\([\s\S]*?"racer_aggregated_stats"[\s\S]*?ignoreColumns: \["calculated_at"\]/.test(
    script,
  ) && !/\.from\("racer_aggregated_stats"\)\s*\.upsert/.test(script),
);
check(
  "aggregate-stats.yml に schedule が無い（cron-job.org の dispatch だけで起動）",
  !/^\s*schedule:/m.test(workflow) && /workflow_dispatch:/.test(workflow),
);
check(
  "枠番別の出走数（course_race_counts）は直近365日で数える（データ出走表の「枠番勝率（直近1年）」、BOA-824）",
  /const COURSE_RACE_COUNTS_WINDOW_DAYS = 365;/.test(script) &&
    /async function calculateCourseRaceCounts[\s\S]*?getDateDaysAgo\(COURSE_RACE_COUNTS_WINDOW_DAYS\)[\s\S]*?fetchFilteredEntries\(racerId, venueCode, since\)/.test(
      script,
    ),
);

if (failures.length > 0) {
  console.error(`\n❌ ${failures.length}件失敗`);
  process.exit(1);
}
console.log("\n✅ 全ての検証に成功");
