/**
 * race_entries.racer_id が NULL の行を player_name 経由で復元するバックフィルスクリプト
 *
 * BOA-324対応。scripts/daily/update-race-info.jsのracer_id抽出正規表現
 * （scrapeRacers()内の `gradeText.match(/^(\d+)/)`）が2025-12-02〜2026-02-11の
 * 期間、高頻度で失敗し race_entries.racer_id がNULLのまま保存されていた。
 * player_name・grade等の他フィールドは正常に取得できているため、
 * player_nameとracer_profiles.nameの一致でracer_idを復元できる
 * （事前調査でracer_profiles.nameに重複が無いことを確認済み。本スクリプトでも
 * 実行時に重複を再検出し、重複名はスキップして安全側に倒す）。
 *
 * 使用方法:
 *   node --env-file=.env.local scripts/maintenance/backfill-race-entries-racer-id.js --dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-race-entries-racer-id.js
 */

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";

const REPORT_DIR = "data/analysis/racer-season-stats";
const REPORT_PATH = path.join(
  REPORT_DIR,
  "backfill-race-entries-racer-id-report.json",
);
const PAGE_SIZE = 1000;

function parseArgs() {
  const args = process.argv.slice(2);
  return { dryRun: args.includes("--dry-run") };
}

// orderColでソート列を明示する。OFFSET/LIMITページネーションは明示的な
// ORDER BYが無いと行の並び順が保証されず、race_entriesのように継続的に
// INSERTされるテーブル（scrape-scheduled.ymlが5-10分毎に実行）を対象にすると
// ページ間で行が欠落・重複しうるため必須（BOA-324セルフレビュー指摘）。
async function fetchAllPaged(table, selectCols, orderCol, applyFilter) {
  const rows = [];
  let offset = 0;
  while (true) {
    let query = supabase
      .from(table)
      .select(selectCols)
      .order(orderCol, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (applyFilter) query = applyFilter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}取得エラー: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// racer_profiles.name -> racer_id のマップを作る。重複nameは復元先が一意に
// 決まらないため対象から除外する（安全側）。
async function buildNameToRacerIdMap() {
  const profiles = await fetchAllPaged(
    "racer_profiles",
    "racer_id, name",
    "racer_id",
  );
  const nameToIds = new Map();
  for (const p of profiles) {
    if (!nameToIds.has(p.name)) nameToIds.set(p.name, []);
    nameToIds.get(p.name).push(p.racer_id);
  }
  const map = new Map();
  const duplicateNames = [];
  for (const [name, ids] of nameToIds) {
    if (ids.length === 1) {
      map.set(name, ids[0]);
    } else {
      duplicateNames.push({ name, racerIds: ids });
    }
  }
  return { map, duplicateNames };
}

async function main() {
  const { dryRun } = parseArgs();

  console.log("=== race_entries.racer_id バックフィル（BOA-324） ===");
  console.log(
    dryRun
      ? "モード: dry-run（更新は実行しません）"
      : "モード: 実行（race_entriesを更新します）",
  );
  console.log("");

  const { map: nameToRacerId, duplicateNames } = await buildNameToRacerIdMap();
  console.log(
    `racer_profiles: ${nameToRacerId.size}件のユニークな名前をロード（重複名 ${duplicateNames.length}件は対象外）`,
  );
  if (duplicateNames.length > 0) {
    console.log("重複名一覧:", JSON.stringify(duplicateNames));
  }

  const nullEntries = await fetchAllPaged(
    "race_entries",
    "race_id, boat_number, player_name",
    "race_id",
    (q) => q.is("racer_id", null),
  );
  console.log(`racer_id NULLの行: ${nullEntries.length}件`);
  console.log("");

  const distinctNames = new Set(nullEntries.map((e) => e.player_name));
  const matchedNames = [];
  const unmatchedNames = [];
  for (const name of distinctNames) {
    if (nameToRacerId.has(name)) {
      matchedNames.push(name);
    } else {
      unmatchedNames.push(name);
    }
  }

  console.log(
    `distinct player_name: ${distinctNames.size}件 -> 一致: ${matchedNames.length}件 / 未一致: ${unmatchedNames.length}件`,
  );
  if (unmatchedNames.length > 0) {
    console.log(
      "未一致の名前一覧（racer_profilesに存在しない、個別調査が必要）:",
    );
    console.log(unmatchedNames.join(", "));
  }
  console.log("");

  const nullCountByName = new Map();
  for (const e of nullEntries) {
    nullCountByName.set(
      e.player_name,
      (nullCountByName.get(e.player_name) || 0) + 1,
    );
  }

  let updatedRows = 0;
  let updateErrors = [];

  for (let i = 0; i < matchedNames.length; i++) {
    const name = matchedNames[i];
    const racerId = nameToRacerId.get(name);
    const expectedCount = nullCountByName.get(name);
    const progress = `[${i + 1}/${matchedNames.length}]`;

    if (dryRun) {
      updatedRows += expectedCount;
      continue;
    }

    const { data, error } = await supabase
      .from("race_entries")
      .update({ racer_id: racerId })
      .is("racer_id", null)
      .eq("player_name", name)
      .select("race_id, boat_number");

    if (error) {
      console.error(
        `${progress} ${name} (racer_id=${racerId}) 更新エラー: ${error.message}`,
      );
      updateErrors.push({ name, racerId, error: error.message });
      continue;
    }

    const actualCount = data?.length ?? 0;
    updatedRows += actualCount;
    if (actualCount !== expectedCount) {
      console.warn(
        `${progress} ${name} (racer_id=${racerId}): 期待${expectedCount}件 実際${actualCount}件（他プロセスが並行更新した可能性）`,
      );
    }
  }

  console.log("");
  console.log("=== 結果サマリー ===");
  const summary = {
    executedAt: new Date().toISOString(),
    dryRun,
    nullEntriesTotal: nullEntries.length,
    distinctNamesTotal: distinctNames.size,
    matchedNamesCount: matchedNames.length,
    unmatchedNamesCount: unmatchedNames.length,
    unmatchedNames,
    duplicateProfileNames: duplicateNames,
    updatedRows,
    updateErrorsCount: updateErrors.length,
    updateErrors,
  };
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`レポート保存: ${REPORT_PATH}`);

  if (updateErrors.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
