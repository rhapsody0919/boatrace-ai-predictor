// 進入コース(actual_course_1〜6)バックフィルスクリプト（BOA-257）
//
// race_results.course_1〜6は艇番と完全一致する不良データのため使えない。
// 公式の成績ファイル（Kファイル）アーカイブから実際の進入コースを取得し、
// race_results.actual_course_1〜6（docs/db-migration/063_race_results_actual_course_kfile.sql）
// に反映する。Kファイルは1日1ファイルに全会場分が含まれるため、日単位で処理する
// （scripts/daily/scrape-results.jsの日次同期＝直近4日分の自己修復とは別に、
// 過去の全期間を一括処理するためのスクリプト）。
//
// 使用方法:
//   node scripts/maintenance/backfill-actual-course.js --from=2025-12-04 --to=2026-09-14
//   node scripts/maintenance/backfill-actual-course.js --from=2025-12-04 --to=2026-09-14 --dry-run
//
// 注意: race_results.actual_course_1が既に取得済みの日はスキップする（レジューム可能）。
// 書き込むのは actual_course_1 が未取得のレースだけ（BOA-523）。同期済みのレースまで UPDATE し直すと、
// race_results の UPDATE トリガー（trg_update_predictions）が同期済みの行にも走るため。
// 日次のKファイル同期（直近 KFILE_SYNC_LOOKBACK_DAYS 日）より後に結果の行が作られたレース（過去日の結果の
// バックフィル）は、日次の同期では埋まらない。結果をバックフィルしたら、このスクリプトをその期間で実行する。
// 対象期間が長い場合、1日1リクエスト（レート制限のためsleep付き）で相応の時間がかかる。

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { fetchKFileText, parseKFileText } from "../lib/kfileParser.js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { from: null, to: null, dryRun: false, sleepMs: 300 };
  for (const arg of args) {
    if (arg.startsWith("--from=")) options.from = arg.replace("--from=", "");
    else if (arg.startsWith("--to=")) options.to = arg.replace("--to=", "");
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--sleep-ms=")) {
      options.sleepMs = parseInt(arg.replace("--sleep-ms=", ""), 10);
    }
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* dateRange(from, to) {
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().split("T")[0];
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
}

/**
 * 指定日について、race_resultsに実進入（actual_course_1〜6）が全て未取得のレースの race_id の集合を返す
 * （空なら、バックフィル対象が無い）。1日は最大でも24会場×12レースで、上限1000行に収まる。
 */
async function fetchPendingRaceIds(dateStr) {
  const { data, error } = await supabase
    .from("race_results")
    .select("race_id")
    .gte("race_id", dateStr)
    .lt("race_id", `${dateStr}~`)
    .not("rank1", "is", null)
    // 6列とも NULL のレースだけを未取得とみなす（1号艇が欠場したレースは actual_course_1 だけが NULL で、同期済み）
    .is("actual_course_1", null)
    .is("actual_course_2", null)
    .is("actual_course_3", null)
    .is("actual_course_4", null)
    .is("actual_course_5", null)
    .is("actual_course_6", null);
  if (error) {
    throw new Error(`対象確認エラー(${dateStr}): ${error.message}`);
  }
  return new Set((data || []).map((r) => r.race_id));
}

async function backfillOneDay(dateStr, pendingIds, dryRun) {
  const text = await fetchKFileText(dateStr);
  if (!text) {
    return { status: "no_kfile", updated: 0, notFound: 0 };
  }

  const parsed = parseKFileText(text, dateStr);
  if (parsed.length === 0) {
    return { status: "no_races_parsed", updated: 0, notFound: 0 };
  }
  // 未取得のレースだけを書く。Kファイルに載っていない未取得のレースは、埋められない（件数だけ出す）
  const rows = parsed.filter((row) => pendingIds.has(row.race_id));
  const notInKFile = pendingIds.size - rows.length;

  if (dryRun) {
    return {
      status: "ok",
      updated: rows.length,
      notFound: 0,
      notInKFile,
      dryRun: true,
    };
  }

  let updated = 0;
  let notFound = 0;
  for (const row of rows) {
    const { data, error } = await supabase
      .from("race_results")
      .update({
        actual_course_1: row.actual_course_1,
        actual_course_2: row.actual_course_2,
        actual_course_3: row.actual_course_3,
        actual_course_4: row.actual_course_4,
        actual_course_5: row.actual_course_5,
        actual_course_6: row.actual_course_6,
      })
      .eq("race_id", row.race_id)
      .select("race_id");
    if (error) {
      console.error(`  ⚠️ 更新エラー(${row.race_id}): ${error.message}`);
      continue;
    }
    if (data && data.length > 0) {
      updated++;
    } else {
      // race_resultsに該当行が無い（中止・結果未確定等）。Kファイルには
      // 出走表に載っている艇の情報が含まれるため、こういうケースはあり得る
      notFound++;
    }
  }
  return { status: "ok", updated, notFound, notInKFile };
}

async function main() {
  const options = parseArgs();
  if (!options.from || !options.to) {
    console.log("使用方法:");
    console.log(
      "  node scripts/maintenance/backfill-actual-course.js --from=2025-12-04 --to=2026-09-14",
    );
    console.log("オプション:");
    console.log(
      "  --dry-run         実際には更新しない（対象日数・レース数のみ集計）",
    );
    console.log(
      "  --sleep-ms=N      1日ごとのダウンロード間隔(ms、デフォルト300)",
    );
    process.exit(1);
  }

  console.log("=== 進入コースバックフィル(Kファイル方式, BOA-257) ===");
  console.log(`期間: ${options.from} 〜 ${options.to}`);
  console.log(`モード: ${options.dryRun ? "ドライラン" : "本番実行"}`);
  console.log("");

  let daysProcessed = 0;
  let daysSkippedAlreadySynced = 0;
  let daysNoKFile = 0;
  let daysError = 0;
  let totalUpdated = 0;
  let totalNotFound = 0;
  let totalNotInKFile = 0;

  for (const dateStr of dateRange(options.from, options.to)) {
    try {
      const pendingIds = await fetchPendingRaceIds(dateStr);
      if (pendingIds.size === 0) {
        daysSkippedAlreadySynced++;
        continue;
      }

      const result = await backfillOneDay(dateStr, pendingIds, options.dryRun);
      if (result.status === "no_kfile" || result.status === "no_races_parsed") {
        daysNoKFile++;
      } else {
        daysProcessed++;
        totalUpdated += result.updated;
        totalNotFound += result.notFound || 0;
        totalNotInKFile += result.notInKFile || 0;
        console.log(
          `[${dateStr}] ${result.dryRun ? "(dry-run) " : ""}更新: ${result.updated}件${result.notFound ? `, 該当行なし: ${result.notFound}件` : ""}${result.notInKFile ? `, Kファイルに無い未取得: ${result.notInKFile}件` : ""}`,
        );
      }
    } catch (e) {
      daysError++;
      console.error(`[${dateStr}] ❌ ${e.message}`);
    }
    await sleep(options.sleepMs);
  }

  console.log("");
  console.log("=== 完了 ===");
  console.log(`処理日数: ${daysProcessed}`);
  console.log(`既に同期済みでスキップ: ${daysSkippedAlreadySynced}日`);
  console.log(`Kファイル無し/開催なし: ${daysNoKFile}日`);
  console.log(`エラー: ${daysError}日`);
  console.log(`更新レース数合計: ${totalUpdated}件`);
  if (totalNotFound > 0) {
    console.log(`race_resultsに該当行が無かった件数: ${totalNotFound}件`);
  }
  if (totalNotInKFile > 0) {
    console.log(
      `未取得だがKファイルに無かった件数（埋められない）: ${totalNotInKFile}件`,
    );
  }
}

main().catch((e) => {
  console.error("致命的エラー:", e);
  process.exit(1);
});
