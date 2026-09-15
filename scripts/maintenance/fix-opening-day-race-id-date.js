/**
 * races.race_id に埋め込まれた日付が races.race_date と食い違っている行を修正する（BOA-325）
 *
 * 2025-12-03（自社データの初日、races 120件）のみ、race_id の日付部分が
 * "2025-12-02"になっており、race_date列（正しくは2025-12-03）と1日ズレていた。
 * 原因調査の結果、scripts/daily/generate-predictions.jsの現行コードでは
 * race_id生成とrace_date書き込みが同一のtoday変数から行われ、さらに
 * racesData.date!==todayで例外を投げるガードもあるため、現行コードでは
 * このズレは構造的に発生し得ない。初日の一回限りの投入経路に起因する
 * 過去の異常値であり、再発リスクは無いと判断した。
 *
 * このズレはsrc/services/racerService.js・supabaseDataService.js等、
 * フロントエンドがrace_idから日付を復元している箇所にも影響するため
 * （選手個人ページの対戦日表示等）、データ側を修正する。
 *
 * races.race_idは10以上のテーブルから外部キー参照されており
 * （ON UPDATE CASCADEは未設定）、単純なUPDATEはFK制約違反になる。
 * そのため「正しいIDで新規races行をINSERT → 子テーブルのrace_idを
 * 新IDにUPDATE → 旧race_idのraces行をDELETE」の手順で行う。
 * 各ステップは冪等（既に修正済みならスキップ）。
 *
 * 【重要】information_schemaで実際のFK定義を確認した結果、races(race_id)への
 * FKのほとんど（race_entries/predictions/race_results/race_conditions/
 * race_odds/exhibition_data/prediction_odds/bet_recommendations/
 * model_bet_candidates/race_start_timings）はON DELETE CASCADEが付いている
 * （sns_campaign_entriesのみFK句にON DELETE指定なし=デフォルトRESTRICT）。
 * また mycroft_predictions/poirot_predictions/watson_predictions は
 * race_idを持つがracesへのFK自体が存在しない。
 * つまり「子テーブルの更新漏れがあればDELETEがFK違反で安全に失敗する」という
 * 想定は成り立たない——更新漏れのままDELETEすると、CASCADE先は黙って
 * 巻き込み削除され、FK無しの3テーブルは孤児レコード化する。
 * そのためDELETE直前に、CHILD_TABLES全件についてoldIdを参照する行が
 * 本当に0件になったことを明示的に確認してから削除する（更新件数の
 * self-reportを信用しない）。
 *
 * 【重要・実行時に判明】racesには UNIQUE(race_date, venue_code, race_number)
 * も存在する（001_schema.sql）。旧行をDELETEする前に新IDの行をINSERTする
 * と、旧行が(race_date, venue_code, race_number)の組を既に占有しているため
 * 一意制約違反でINSERTが失敗する（実際に本番実行で120件全て失敗、
 * データ破損は無し=安全に何もしていない状態で停止）。
 * そのためINSERT前に旧行のrace_numberを一時的にずらし、その組を
 * 空けてからINSERTする。venue_code/race_numberはrace_id文字列
 * （"YYYY-MM-DD-VV-RR"のVV/RR部分）から都度パースする。race_id文字列は
 * このスクリプトが変更するまで不変なため、DBのrace_number列を
 * どれだけずらしても正しい値を再計算でき、中断後の再実行でも安全。
 *
 * 使用方法:
 *   node --env-file=.env.local scripts/maintenance/fix-opening-day-race-id-date.js --dry-run
 *   node --env-file=.env.local scripts/maintenance/fix-opening-day-race-id-date.js
 */

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";

const REPORT_DIR = "data/analysis/racer-season-stats";
const REPORT_PATH = path.join(
  REPORT_DIR,
  "fix-opening-day-race-id-date-report.json",
);

// race_idのFK参照を持つテーブルのうち、実際にデータが存在しうるもの
// （race_results/race_conditions/race_odds等は初日時点で0件と確認済みだが、
// 念のため全テーブルを対象にし、0件なら何もしない設計にする）
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

function parseArgs() {
  const args = process.argv.slice(2);
  const raceIdArg = args.find((a) => a.startsWith("--race-id="));
  return {
    dryRun: args.includes("--dry-run"),
    onlyRaceId: raceIdArg ? raceIdArg.split("=")[1] : null,
  };
}

// race_idの日付部分(先頭10文字)がrace_dateと食い違っている行を全件検出する
async function findMismatchedRaces() {
  const mismatched = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("races")
      .select("*")
      .order("race_id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(`races取得エラー: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const race of data) {
      const idDate = race.race_id.slice(0, 10);
      if (idDate !== race.race_date) mismatched.push(race);
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return mismatched;
}

function computeCorrectRaceId(race) {
  // race_id形式: YYYY-MM-DD-VV-RR。日付部分だけをrace_dateで置き換える
  const suffix = race.race_id.slice(10); // "-VV-RR"
  return `${race.race_date}${suffix}`;
}

// race_id文字列(YYYY-MM-DD-VV-RR)からvenue_code/race_numberを取得する。
// races.venue_code/race_number列は一時退避で書き換えることがあるため、
// 常に不変なrace_id文字列側から読む（scripts/lib/raceSchedule.jsと同じ
// パース位置）。
function parseVenueAndRaceNumberFromId(raceId) {
  return {
    venueCode: parseInt(raceId.substring(11, 13), 10),
    raceNumber: parseInt(raceId.substring(14, 16), 10),
  };
}

// 一意制約 UNIQUE(race_date, venue_code, race_number) の組を一時的に
// 空けるためのrace_number退避値。実在するrace_number(1-12)と衝突しない
// 固定オフセットで、race_id文字列から再計算するため何度実行しても同じ値
// になり冪等（DBの現在値に依存しない）。
const RACE_NUMBER_QUARANTINE_OFFSET = 10000;

// race_id列が存在しないテーブル（PostgRESTのエラーメッセージで判別）かどうか
function isMissingColumnError(error) {
  return Boolean(
    error?.message?.includes("column") &&
    error.message?.includes("does not exist"),
  );
}

// 指定raceIdを参照する行がCHILD_TABLES全体で本当に0件かを確認する。
// UPDATE呼び出しの自己申告（成功件数）を信用せず、DELETE直前に独立して
// 検証するための関数（races(race_id)へのFKはほとんどON DELETE CASCADEで
// あり、更新漏れがあってもDELETE自体は失敗せず巻き込み削除されてしまうため）。
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
  const { dryRun, onlyRaceId } = parseArgs();

  console.log("=== races.race_id 日付ズレ修正（BOA-325） ===");
  console.log(dryRun ? "モード: dry-run" : "モード: 実行");
  if (onlyRaceId) console.log(`対象を1件に限定: ${onlyRaceId}`);
  console.log("");

  let mismatched = await findMismatchedRaces();
  if (onlyRaceId)
    mismatched = mismatched.filter((r) => r.race_id === onlyRaceId);
  console.log(
    `race_idとrace_dateが食い違っているレース: ${mismatched.length}件`,
  );
  if (mismatched.length === 0) {
    console.log("対象なし。終了します。");
    return;
  }

  const summary = {
    executedAt: new Date().toISOString(),
    dryRun,
    mismatchedCount: mismatched.length,
    perRace: [],
    errors: [],
  };

  for (let i = 0; i < mismatched.length; i++) {
    const oldRace = mismatched[i];
    const oldId = oldRace.race_id;
    const newId = computeCorrectRaceId(oldRace);
    const progress = `[${i + 1}/${mismatched.length}]`;
    const raceReport = { oldId, newId, childUpdates: {} };

    console.log(`${progress} ${oldId} -> ${newId}`);

    if (dryRun) {
      for (const table of CHILD_TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true })
          .eq("race_id", oldId);
        if (error) {
          if (isMissingColumnError(error)) continue;
          console.error(`${progress} ${table}件数確認エラー: ${error.message}`);
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

    // 1. 新IDでracesに行が無ければ作成（冪等: 既にあればスキップ）
    const { data: existingNew } = await supabase
      .from("races")
      .select("race_id")
      .eq("race_id", newId)
      .maybeSingle();

    if (!existingNew) {
      const { venueCode, raceNumber } = parseVenueAndRaceNumberFromId(oldId);

      // 1a. UNIQUE(race_date, venue_code, race_number)の組を一時的に空ける
      // （race_numberはrace_id文字列から再計算するため冪等・何度実行しても同じ値）
      const { error: quarantineError } = await supabase
        .from("races")
        .update({ race_number: raceNumber + RACE_NUMBER_QUARANTINE_OFFSET })
        .eq("race_id", oldId);
      if (quarantineError) {
        console.error(
          `${progress} 旧race_number退避失敗: ${quarantineError.message}`,
        );
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
        ...rest
      } = oldRace;
      const { error: insertError } = await supabase.from("races").insert({
        race_id: newId,
        venue_code: venueCode,
        race_number: raceNumber,
        ...rest,
        updated_at: new Date().toISOString(),
      });
      if (insertError) {
        console.error(
          `${progress} races新規行INSERT失敗: ${insertError.message}`,
        );
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
        // race_id列が存在しないテーブルはPostgRESTがエラーを返すため無視する
        if (isMissingColumnError(error)) continue;
        console.error(
          `${progress} ${table}のrace_id付け替え失敗: ${error.message}`,
        );
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
        `${progress} 子テーブル更新に失敗したため旧raceの削除をスキップ: ${oldId}`,
      );
      summary.perRace.push(raceReport);
      continue;
    }

    // 3. DELETE直前に、oldIdを参照する行がCHILD_TABLES全件で本当に0件か
    // 独立して確認する。races(race_id)へのFKはほとんどON DELETE CASCADEの
    // ため、上のUPDATE呼び出しの成功報告を信用してそのままDELETEすると、
    // 何らかの理由で更新漏れがあった場合に検知できず巻き込み削除・
    // 孤児レコード化しうる（セルフレビューで判明、詳細はファイル冒頭コメント）。
    const remaining = await countRemainingReferences(oldId);
    if (Object.keys(remaining).length > 0) {
      console.error(
        `${progress} 旧race_id(${oldId})への参照が残っているため削除をスキップ:`,
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

    // 4. 旧raceを削除（全子テーブルの付け替え完了を確認済みのため安全）
    const { error: deleteError } = await supabase
      .from("races")
      .delete()
      .eq("race_id", oldId);
    if (deleteError) {
      console.error(`${progress} 旧races行DELETE失敗: ${deleteError.message}`);
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
