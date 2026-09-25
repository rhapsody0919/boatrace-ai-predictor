#!/usr/bin/env node
/**
 * 出走表（race_entries）の複製汚染を、公式Bファイル（番組表）から復元するCLI（BOA-422）
 *
 * 監査結果と列ごとの方針: docs/issues/race-entries-duplicate-contamination-audit.md
 *                          scripts/lib/raceEntriesKbRestore.js（純粋関数・正本）
 *
 * 【新規の公式サイトアクセスは無い】（DB読み取り + ローカルのK/Bアーカイブ読み取りのみ）。
 * 書き込みは `--apply` を付けたときだけ。既定は検証（DB読み取りのみ）。
 * 書き込みは upsertChangedRows で、値の変わる行だけを書く（Disk IOへの配慮。.claude/rules/data-acquisition.md）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/restore-contaminated-race-entries.js plan
 *   node --env-file=.env.local scripts/maintenance/restore-contaminated-race-entries.js apply           # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/restore-contaminated-race-entries.js apply --apply   # 書き込み（要承認）
 *
 * オプション:
 *   --dates=2026-01-09,2026-04-11,...  対象日（既定: 監査で汚染を確認した4日）
 *   --archive=<dir>                    K/Bアーカイブ（既定: data/kb-archive）
 *   --max-match=<n>                    汚染とみなす一致艇数の上限（既定1）。
 *                                      欠場による差し替え（6艇中5艇一致）を汚染と取り違えないための安全弁
 *   --json=<file>                      計画の詳細をJSONで書き出す
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import { _internal as kbBackfillInternal } from "./kb-backfill.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import { PRE_RACE_OPTIONAL_COLUMN_GROUPS } from "../lib/preRaceSchema.js";
import {
  COLUMNS_FROM_B,
  COLUMNS_FROM_PROFILE,
  COLUMNS_TO_NULL,
  DEFAULT_MAX_MATCH_FOR_CONTAMINATED,
  buildRestorePlan,
  indexBEntriesByRace,
} from "../lib/raceEntriesKbRestore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

/** 監査（docs/issues/race-entries-duplicate-contamination-audit.md）で汚染を確認した日 */
const DEFAULT_DATES = ["2026-01-09", "2026-04-11", "2026-04-24", "2026-04-25"];

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const command = process.argv[2];
const DATES = arg("dates", DEFAULT_DATES.join(","))
  .split(",")
  .map((s) => s.trim());
const ARCHIVE = path.resolve(REPO_ROOT, arg("archive", "data/kb-archive"));
const JSON_OUT = arg("json", null);
const MAX_MATCH = Number(
  arg("max-match", String(DEFAULT_MAX_MATCH_FOR_CONTAMINATED)),
);
const APPLY = has("apply") && command === "apply";

if (!["plan", "apply"].includes(command)) {
  console.error(
    "使い方: restore-contaminated-race-entries.js <plan|apply> [--apply]",
  );
  process.exit(1);
}
for (const d of DATES)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
    throw new Error(`--dates は YYYY-MM-DD です: ${d}`);
if (!Number.isInteger(MAX_MATCH) || MAX_MATCH < 0 || MAX_MATCH > 5)
  throw new Error(`--max-match は 0〜5 の整数です: ${MAX_MATCH}`);
if (!fs.existsSync(ARCHIVE))
  throw new Error(
    `K/Bアーカイブが見つかりません: ${ARCHIVE}（--archive= で指定してください）`,
  );

/** その日のDBの出走表を race_id → (艇番 → 行) に畳む */
async function loadDbIndex(date) {
  const rows = await fetchAll(
    "race_entries",
    "race_id, boat_number, racer_id",
    (q) => q.gte("race_id", date).lte("race_id", `${date}~`).order("race_id"),
    { throwOnError: true },
  );
  const index = new Map();
  for (const r of rows) {
    if (!index.has(r.race_id)) index.set(r.race_id, new Map());
    index.get(r.race_id).set(r.boat_number, r);
  }
  return index;
}

/** 復元後の racer_id の分の racer_profiles をまとめて引く */
async function loadProfiles(racerIds) {
  const ids = [...racerIds];
  const profiles = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const rows = await fetchAll(
      "racer_profiles",
      "racer_id, name, branch, hometown",
      (q) => q.in("racer_id", chunk).order("racer_id"),
      { throwOnError: true },
    );
    for (const r of rows) profiles.set(r.racer_id, r);
  }
  return profiles;
}

async function main() {
  const perDate = [];
  const allRows = [];
  const allRaces = [];
  const allNearMisses = [];
  const allMissingProfiles = new Set();

  for (const date of DATES) {
    const day = kbBackfillInternal.readParsedDay(ARCHIVE, date);
    if (!day?.b?.venues?.length) {
      perDate.push({ date, skipped: "Bファイルが無い（未取得）" });
      continue;
    }
    // アーカイブの中身が、本当にその日のものか確かめる（取り違えたまま書くと、
    // 別の日の出走表で「復元」してしまう）
    if (day.date !== date)
      throw new Error(
        `アーカイブの日付が一致しません（要求 ${date} / 中身 ${day.date}）: ${ARCHIVE}`,
      );
    const bIndex = indexBEntriesByRace(day);
    const dbIndex = await loadDbIndex(date);
    if (dbIndex.size === 0) {
      perDate.push({ date, skipped: "DBに出走表が無い" });
      continue;
    }
    // 汚染レースを先に特定し、その分の racer_profiles だけを引く
    const { races: dryRaces } = buildRestorePlan({
      bIndex,
      dbIndex,
      profiles: new Map(),
      maxMatch: MAX_MATCH,
    });
    const racerIds = new Set();
    for (const { race_id } of dryRaces)
      for (const e of bIndex.get(race_id).values()) racerIds.add(e.racer_id);
    const profiles = await loadProfiles(racerIds);

    const { rows, races, nearMisses, missingProfiles } = buildRestorePlan({
      bIndex,
      dbIndex,
      profiles,
      maxMatch: MAX_MATCH,
    });
    for (const id of missingProfiles) allMissingProfiles.add(id);
    allRows.push(...rows);
    allRaces.push(...races);
    allNearMisses.push(...nearMisses);
    perDate.push({
      date,
      races: races.length,
      rows: rows.length,
      nearMisses: nearMisses.length,
    });
  }

  const summary = {
    dates: DATES,
    archive: ARCHIVE,
    maxMatchForContaminated: MAX_MATCH,
    contaminatedRaces: allRaces.length,
    rowsToRestore: allRows.length,
    // 一致しないが上限を超えるため対象外にしたレース（欠場の差し替え等）。0でないときは中身を確認する
    nearMissRaces: allNearMisses.length,
    columnsFromB: Object.keys(COLUMNS_FROM_B),
    columnsFromProfile: Object.keys(COLUMNS_FROM_PROFILE),
    columnsSetToNull: COLUMNS_TO_NULL,
    racersMissingInProfiles: [...allMissingProfiles],
    perDate,
  };
  console.log(JSON.stringify(summary, null, 2));

  if (JSON_OUT) {
    fs.writeFileSync(
      path.resolve(JSON_OUT),
      JSON.stringify(
        { summary, races: allRaces, nearMisses: allNearMisses, rows: allRows },
        null,
        2,
      ),
    );
    console.log(`計画をJSONで書き出しました: ${path.resolve(JSON_OUT)}`);
  }

  if (command === "plan") return 0;
  if (allRows.length === 0) {
    console.log("\n対象の行がありません。");
    return 1;
  }

  console.log(
    APPLY
      ? `\n書き込みます（${allRows.length}行）…`
      : `\nDRY-RUN（書き込みなし。${allRows.length}行が対象）…`,
  );
  const result = await upsertChangedRows(supabase, "race_entries", allRows, {
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    chunkColumn: "race_id",
    label: "race_entries（複製汚染の復元）",
    dryRun: !APPLY,
    stampUpdatedAt: true,
    optionalColumnGroups: PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceEntries,
  });
  console.log(
    JSON.stringify(
      { written: result.written, skipped: result.skipped, stats: result.stats },
      null,
      2,
    ),
  );
  if (result.error) {
    console.error(`書き込みに失敗しました: ${result.error.message}`);
    return 1;
  }
  if (!APPLY)
    console.log(
      "\n実際に書き込むには --apply を付けて再実行してください（要承認）。",
    );
  return 0;
}

process.exit(await main());
