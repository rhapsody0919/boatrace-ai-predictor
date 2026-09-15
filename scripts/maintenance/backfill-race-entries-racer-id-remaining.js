/**
 * backfill-race-entries-racer-id.js（BOA-324）で racer_profiles.name に
 * 一致せず未解決だった残り239件（distinct 11名）を解消する追加バックフィル。
 *
 * 調査の結果、11名のうち10名は race_entries 自身に非NULLの racer_id が
 * 既に存在していた（同じ選手が2026年3月以降の正しく取得できた行で racer_id
 * 付きで記録されていたが、racer_profiles には未登録だったため1回目の
 * バックフィルでは解決できなかった）。racer_profiles が race_entries の
 * 非NULL racer_id を母集団にして選手を選定する設計（scrape-racer-profiles.js
 * の getTargetRacerIds()）のため、ある選手の race_entries が「バックフィル前
 * 時点で1件も非NULLでない」と racer_profiles にも一切登録されない、という
 * BOA-324の副次的な影響が判明した。
 *
 * 残り1名（本多宏和）は race_entries 内に非NULLの手がかりも無かったため、
 * boatrace.jp公式選手検索（https://www.boatrace.jp/owpc/pc/data/racersearch/profile?toban=4492）
 * で登録番号4492と確認した（生年月日1987-02-15、愛知支部。race_entriesの
 * 記録年齢38歳・出走期間2025-12-13〜2026-01-11とも矛盾しない）。
 *
 * 使用方法:
 *   node --env-file=.env.local scripts/maintenance/backfill-race-entries-racer-id-remaining.js --dry-run
 *   node --env-file=.env.local scripts/maintenance/backfill-race-entries-racer-id-remaining.js
 */

import fs from "fs";
import path from "path";
import { supabase } from "../lib/supabaseClient.js";

const REPORT_DIR = "data/analysis/racer-season-stats";
const REPORT_PATH = path.join(
  REPORT_DIR,
  "backfill-race-entries-racer-id-remaining-report.json",
);
const PAGE_SIZE = 1000;

// boatrace.jp公式選手検索で個別に確認した対応（race_entries自身にもracer_profiles
// にも手がかりが無かった名前のみ）
const MANUAL_OVERRIDES = {
  "本多　　宏和": 4492,
};

function parseArgs() {
  const args = process.argv.slice(2);
  return { dryRun: args.includes("--dry-run") };
}

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

// race_entries自身の非NULL行から player_name -> racer_id を作る（重複nameは除外）
async function buildNameToRacerIdMapFromRaceEntries() {
  const rows = await fetchAllPaged(
    "race_entries",
    "player_name, racer_id",
    "race_id",
    (q) => q.not("racer_id", "is", null),
  );
  const nameToIds = new Map();
  for (const r of rows) {
    if (!nameToIds.has(r.player_name)) nameToIds.set(r.player_name, new Set());
    nameToIds.get(r.player_name).add(r.racer_id);
  }
  const map = new Map();
  const ambiguousNames = [];
  for (const [name, ids] of nameToIds) {
    if (ids.size === 1) {
      map.set(name, [...ids][0]);
    } else {
      ambiguousNames.push({ name, racerIds: [...ids] });
    }
  }
  return { map, ambiguousNames };
}

async function main() {
  const { dryRun } = parseArgs();

  console.log("=== race_entries.racer_id 追加バックフィル（BOA-324残件） ===");
  console.log(dryRun ? "モード: dry-run" : "モード: 実行");
  console.log("");

  const { map: selfRefMap, ambiguousNames } =
    await buildNameToRacerIdMapFromRaceEntries();
  console.log(
    `race_entries自己参照マップ: ${selfRefMap.size}件の名前をロード（同名で複数racer_idに割れているため除外: ${ambiguousNames.length}件）`,
  );
  if (ambiguousNames.length > 0) {
    console.log("除外した曖昧な名前:", JSON.stringify(ambiguousNames));
  }

  const nullEntries = await fetchAllPaged(
    "race_entries",
    "player_name",
    "race_id",
    (q) => q.is("racer_id", null),
  );
  console.log(`racer_id NULLの行: ${nullEntries.length}件`);

  const nullCountByName = new Map();
  for (const e of nullEntries) {
    nullCountByName.set(
      e.player_name,
      (nullCountByName.get(e.player_name) || 0) + 1,
    );
  }
  const distinctNames = [...nullCountByName.keys()];
  console.log(`distinct player_name: ${distinctNames.length}件`);
  console.log("");

  let updatedRows = 0;
  const updateErrors = [];
  const unresolvedNames = [];

  for (let i = 0; i < distinctNames.length; i++) {
    const name = distinctNames[i];
    const racerId = selfRefMap.get(name) ?? MANUAL_OVERRIDES[name];
    const source = selfRefMap.has(name)
      ? "race_entries自己参照"
      : "手動確認(boatrace.jp)";
    const expectedCount = nullCountByName.get(name);
    const progress = `[${i + 1}/${distinctNames.length}]`;

    if (racerId === undefined) {
      unresolvedNames.push(name);
      console.log(`${progress} ${name}: 解決不能（要追加調査）`);
      continue;
    }

    if (dryRun) {
      console.log(
        `${progress} ${name} -> racer_id=${racerId}（${source}、${expectedCount}件）`,
      );
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
    console.log(
      `${progress} ${name} -> racer_id=${racerId}（${source}）: ${actualCount}件更新`,
    );
  }

  console.log("");
  console.log("=== 結果サマリー ===");
  const summary = {
    executedAt: new Date().toISOString(),
    dryRun,
    nullEntriesTotal: nullEntries.length,
    distinctNamesTotal: distinctNames.length,
    updatedRows,
    unresolvedNames,
    updateErrorsCount: updateErrors.length,
    updateErrors,
  };
  console.log(JSON.stringify(summary, null, 2));

  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`レポート保存: ${REPORT_PATH}`);

  if (updateErrors.length > 0 || unresolvedNames.length > 0)
    process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
