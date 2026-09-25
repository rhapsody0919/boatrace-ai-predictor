/**
 * 津(09) 2025-12-03分12レースを、正しい開催日2025-12-02へ修正する（BOA-413）
 *
 * 背景: BOA-325（Done、PR #664/666）は、自社データ初日(2025-12-03)の120レース
 * （10会場×12レース）について、race_idの日付部分(2025-12-02)をrace_date列
 * （2025-12-03）に合わせて訂正した。これは「race_date側が正しい」という前提に
 * 立っていたが、BOA-413（docs/issues/opening-day-race-date-premise-reverification.md）
 * の再検証で、津(09)のみこの前提が誤りだったと判明した：公式K-file 2025-12-03分に
 * 津のブロック自体が存在せず、2025-12-02分の出走表（racer_id）と6艇×12レース=72値
 * が完全一致する。つまり津は実際には2025-12-02に開催されており、BOA-325の訂正
 * （race_id・race_dateとも2025-12-03へ）は誤りだった。
 *
 * 本スクリプトは、津の12レースを2025-12-02-09-01〜12・race_date=2025-12-02へ
 * 戻す。他の9会場（108レース）はBOA-325の対応が正しかったため対象にしない。
 *
 * 子テーブルの付け替え・UNIQUE制約回避・DELETE前の参照確認の手順は
 * fix-opening-day-race-id-date.js（BOA-325）と同じロジックを流用する。
 *
 * 使用方法:
 *   node --env-file=.env.local scripts/maintenance/fix-tsu-2025-12-02-date.js --dry-run
 *   node --env-file=.env.local scripts/maintenance/fix-tsu-2025-12-02-date.js
 */

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";

const REPORT_DIR = "data/analysis/racer-season-stats";
const REPORT_PATH = path.join(
  REPORT_DIR,
  "fix-tsu-2025-12-02-date-report.json",
);

const OLD_DATE = "2025-12-03";
const NEW_DATE = "2025-12-02";
const VENUE_CODE = 9;

const CHILD_TABLES = [
  "race_entries",
  "race_start_timings",
  "predictions",
  "race_results",
  "race_conditions",
  "race_odds",
  "exhibition_data",
  "prediction_odds",
  "bet_recommendations",
  "model_bet_candidates",
  "sns_campaign_entries",
  "mycroft_predictions",
  "poirot_predictions",
  "watson_predictions",
];

const RACE_NUMBER_QUARANTINE_OFFSET = 10000;

function isMissingColumnError(error) {
  return Boolean(
    error?.message?.includes("column") &&
    error.message?.includes("does not exist"),
  );
}

function parseArgs() {
  const args = process.argv.slice(2);
  return { dryRun: args.includes("--dry-run") };
}

async function findTsuRaces() {
  const { data, error } = await supabase
    .from("races")
    .select("*")
    .eq("race_date", OLD_DATE)
    .eq("venue_code", VENUE_CODE)
    .order("race_id", { ascending: true });
  if (error) throw new Error(`races取得エラー: ${error.message}`);
  return data ?? [];
}

async function countRemainingReferences(raceId) {
  const remaining = {};
  for (const table of CHILD_TABLES) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("race_id", raceId);
    if (error) {
      if (isMissingColumnError(error)) continue;
      throw new Error(`${table}参照確認エラー: ${error.message}`);
    }
    if (count > 0) remaining[table] = count;
  }
  return remaining;
}

async function main() {
  const { dryRun } = parseArgs();
  console.log("=== 津(09) 2025-12-03→2025-12-02 是正（BOA-413） ===");
  console.log(dryRun ? "モード: dry-run" : "モード: 実行");
  console.log("");

  const races = await findTsuRaces();
  console.log(`対象: ${races.length}件`);
  if (races.length === 0) {
    console.log("対象なし（既に是正済み、または該当データなし）。終了します。");
    return;
  }
  if (races.length !== 12) {
    console.error(
      `想定外: 12件のはずが${races.length}件。安全のため中断します。手動確認してください。`,
    );
    process.exitCode = 1;
    return;
  }

  const summary = {
    executedAt: new Date().toISOString(),
    dryRun,
    perRace: [],
    errors: [],
  };

  for (const oldRace of races) {
    const oldId = oldRace.race_id; // "2025-12-03-09-RR"
    const raceNumber = parseInt(oldId.substring(14, 16), 10);
    const newId = `${NEW_DATE}-${String(VENUE_CODE).padStart(2, "0")}-${String(raceNumber).padStart(2, "0")}`;
    const raceReport = { oldId, newId, childUpdates: {} };
    console.log(`[${raceNumber}/12] ${oldId} -> ${newId}`);

    if (dryRun) {
      for (const table of CHILD_TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("race_id", oldId);
        if (error) {
          if (isMissingColumnError(error)) continue;
          console.error(`  ${table}件数確認エラー: ${error.message}`);
          summary.errors.push({
            oldId,
            newId,
            step: `dryrun_count_${table}`,
            error: error.message,
          });
          continue;
        }
        if (count > 0) raceReport.childUpdates[table] = count;
      }
      summary.perRace.push(raceReport);
      continue;
    }

    // 1. 新IDでracesに行が無ければ作成（冪等）
    const { data: existingNew } = await supabase
      .from("races")
      .select("race_id")
      .eq("race_id", newId)
      .maybeSingle();

    if (!existingNew) {
      // 1a. UNIQUE(race_date, venue_code, race_number)の組を一時的に空ける
      const { error: quarantineError } = await supabase
        .from("races")
        .update({ race_number: raceNumber + RACE_NUMBER_QUARANTINE_OFFSET })
        .eq("race_id", oldId);
      if (quarantineError) {
        console.error(`  旧race_number退避失敗: ${quarantineError.message}`);
        summary.errors.push({
          oldId,
          newId,
          step: "quarantine_old_race_number",
          error: quarantineError.message,
        });
        continue;
      }

      const {
        race_id: _drop,
        updated_at: _dropUpdatedAt,
        venue_code: _dropVenueCode,
        race_number: _dropRaceNumber,
        race_date: _dropRaceDate,
        ...rest
      } = oldRace;
      const { error: insertError } = await supabase.from("races").insert({
        race_id: newId,
        venue_code: VENUE_CODE,
        race_number: raceNumber,
        race_date: NEW_DATE,
        ...rest,
        updated_at: new Date().toISOString(),
      });
      if (insertError) {
        console.error(`  races新規行INSERT失敗: ${insertError.message}`);
        summary.errors.push({
          oldId,
          newId,
          step: "insert_races",
          error: insertError.message,
        });
        continue;
      }
    }

    // 2. 子テーブルのrace_idを新IDに付け替え
    let childFailed = false;
    for (const table of CHILD_TABLES) {
      const { data, error } = await supabase
        .from(table)
        .update({ race_id: newId })
        .eq("race_id", oldId)
        .select("race_id");
      if (error) {
        if (isMissingColumnError(error)) continue;
        console.error(`  ${table}のrace_id付け替え失敗: ${error.message}`);
        summary.errors.push({
          oldId,
          newId,
          step: `update_${table}`,
          error: error.message,
        });
        childFailed = true;
        continue;
      }
      const updatedCount = data?.length ?? 0;
      if (updatedCount > 0) raceReport.childUpdates[table] = updatedCount;
    }

    if (childFailed) {
      console.error(
        `  子テーブル更新に失敗したため旧raceの削除をスキップ: ${oldId}`,
      );
      summary.perRace.push(raceReport);
      continue;
    }

    // 3. DELETE直前に参照が本当に0件か独立確認
    const remaining = await countRemainingReferences(oldId);
    if (Object.keys(remaining).length > 0) {
      console.error(
        `  旧race_id(${oldId})への参照が残っているため削除をスキップ:`,
        JSON.stringify(remaining),
      );
      summary.errors.push({
        oldId,
        newId,
        step: "verify_no_remaining_references",
        remaining,
      });
      summary.perRace.push(raceReport);
      continue;
    }

    // 4. 旧raceを削除
    const { error: deleteError } = await supabase
      .from("races")
      .delete()
      .eq("race_id", oldId);
    if (deleteError) {
      console.error(`  旧races行DELETE失敗: ${deleteError.message}`);
      summary.errors.push({
        oldId,
        newId,
        step: "delete_old_races",
        error: deleteError.message,
      });
    }

    summary.perRace.push(raceReport);
  }

  console.log("");
  console.log("=== 結果サマリー ===");
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`レポート保存: ${REPORT_PATH}`);

  if (summary.errors.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
