/**
 * racelist-backfill.js のアーカイブ（ファイルシステム）の道具と load（中間JSON + 本番DBの現在値 → race_entries の
 * 既存値がNULLの列だけを埋める）。本文は racelist-backfill.js から移しただけ
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  RACELIST_BACKFILL_COLUMNS,
  buildFillRowsForRace,
  racelistArchiveRelPath,
} from "../lib/racelistBackfillRows.js";
import { fetchExistingRows, upsertChangedRows } from "../lib/unchangedRows.js";
import { PRE_RACE_OPTIONAL_COLUMN_GROUPS } from "../lib/preRaceSchema.js";
import { appendJsonl, readJsonl } from "../lib/archiveDownloader.js";

export const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
export const loadedPath = (dir) => path.join(dir, "loaded.jsonl");
export const rawPath = (dir, raceId) =>
  path.join(dir, "raw", racelistArchiveRelPath(raceId, "html.gz"));
export const parsedPath = (dir, raceId) =>
  path.join(dir, "parsed", racelistArchiveRelPath(raceId, "json.gz"));

export function latestManifestByKey(dir) {
  const map = new Map();
  for (const e of readJsonl(manifestPath(dir))) map.set(e.key, e);
  return map;
}

export function readParsedRace(dir, raceId) {
  const file = parsedPath(dir, raceId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

export const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );

export const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * load 1バッチ分（対象レースID最大 raceChunkSize 件）の処理。既存行を1回のIN句で読み、
 * 既存値がNULLの列だけを埋める行を組み立てて upsertChangedRows に渡す（DRY-RUNでも読み取りは行う。
 * 「どの列が埋まるか」はDBの現在値に依存するため、書き込み計画自体にDB読み取りが要る）。
 *
 * @returns {Promise<{races: number, noFill: number, unmatchedRaces: number, written: number, error: boolean}>}
 */
export async function loadBatch(client, raceIds, opts) {
  const { rows: existingRows, error } = await fetchExistingRows(
    client,
    "race_entries",
    {
      columns: ["race_id", "boat_number", ...RACELIST_BACKFILL_COLUMNS],
      chunkColumn: "race_id",
      ids: raceIds,
      chunkSize: 100,
    },
  );
  if (error) {
    console.error(`❌ ${error.message}`);
    return { races: 0, noFill: 0, unmatchedRaces: 0, written: 0, error: true };
  }
  const existingByRace = new Map();
  for (const row of existingRows) {
    const list = existingByRace.get(row.race_id) ?? [];
    list.push(row);
    existingByRace.set(row.race_id, list);
  }
  const fillRows = [];
  let noFill = 0;
  let unmatchedRaces = 0;
  let races = 0;
  for (const raceId of raceIds) {
    const parsed = readParsedRace(opts.archiveDir, raceId);
    if (!parsed) continue;
    races++;
    const existingForRace = existingByRace.get(raceId) ?? [];
    const { rows, unmatchedBoats } = buildFillRowsForRace(
      existingForRace,
      parsed.entries,
    );
    if (unmatchedBoats.length > 0) {
      unmatchedRaces++;
      console.warn(
        `  ⚠ ${raceId}: 艇番 ${unmatchedBoats.join(",")} に対応する既存行がありません（race_entries未登録？）`,
      );
    }
    if (rows.length === 0) noFill++;
    fillRows.push(...rows);
  }
  let written = 0;
  let writeError = false;
  if (fillRows.length > 0) {
    const r = await upsertChangedRows(client, "race_entries", fillRows, {
      onConflict: "race_id,boat_number",
      keyColumns: ["race_id", "boat_number"],
      chunkColumn: "race_id",
      label: "race_entries（3連率等の穴埋め）",
      dryRun: !opts.apply,
      stampUpdatedAt: true,
      optionalColumnGroups: PRE_RACE_OPTIONAL_COLUMN_GROUPS.raceEntries,
      batchSize: opts.batchSize,
    });
    written = r.written;
    writeError = !!r.error;
  }
  return { races, noFill, unmatchedRaces, written, error: writeError };
}

// 投入の候補（解析済み・未投入。--force なら投入済みも）。候補が無ければ終了コードを返す
function selectLoadCandidates(opts, manifest, loadedSet, log) {
  const downloadedIds = [...manifest.values()]
    .filter((e) => e.status === "ok")
    .map((e) => e.key);
  if (downloadedIds.length === 0) {
    console.error("投入対象がありません（先に download を実行してください）");
    return { code: 1 };
  }
  const parsedIds = downloadedIds.filter(
    (raceId) => readParsedRace(opts.archiveDir, raceId) !== null,
  );
  if (parsedIds.length === 0) {
    console.error(
      "解析済みの中間JSONがありません（先に parse を実行してください）",
    );
    return { code: 1 };
  }
  const candidates = parsedIds
    .filter((raceId) => opts.force || !loadedSet.has(raceId))
    .sort();
  if (candidates.length === 0) {
    log("対象は全て投入済みです（再投入は --force）");
    return { code: 0 };
  }
  return { candidates };
}

// 候補を raceChunkSize ずつ loadBatch に渡し、合計を返す（--apply なら成功したバッチを loaded に記録）
async function runLoadBatches(client, candidates, opts, loadedFile, sleepFn) {
  const totals = {
    races: 0,
    noFill: 0,
    unmatchedRaces: 0,
    written: 0,
    failedBatches: 0,
  };
  for (const raceIds of chunk(candidates, opts.raceChunkSize)) {
    const r = await loadBatch(client, raceIds, opts);
    totals.races += r.races;
    totals.noFill += r.noFill;
    totals.unmatchedRaces += r.unmatchedRaces;
    totals.written += r.written;
    if (r.error) {
      totals.failedBatches++;
      continue; // このバッチは loaded に記録しない（再実行で再試行される）
    }
    if (opts.apply) {
      for (const raceId of raceIds)
        appendJsonl(loadedFile, {
          race_id: raceId,
          at: new Date().toISOString(),
        });
      await sleepFn(opts.sleepMs);
    }
  }
  return totals;
}

function loadExitCode(totals, opts) {
  if (totals.failedBatches > 0) return 1;
  if (totals.written === 0 && totals.noFill < totals.races) {
    // 埋められる列があったはずなのに1件も書けていない（DRY-RUNでは常に0。判定には使わない）
    if (opts.apply) {
      console.error("書き込みが0件でした。異常として扱います");
      return 1;
    }
  }
  return 0;
}

export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const manifest = latestManifestByKey(opts.archiveDir);
  const loadedFile = loadedPath(opts.archiveDir);
  const loadedSet = new Set(readJsonl(loadedFile).map((e) => e.race_id));
  const { code, candidates } = selectLoadCandidates(
    opts,
    manifest,
    loadedSet,
    log,
  );
  if (!candidates) return code;
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const probe = await client.from("race_entries").select("race_id").limit(1);
  if (probe.error) {
    console.error(`race_entries を読めません: ${probe.error.message}`);
    return 1;
  }

  const totals = await runLoadBatches(
    client,
    candidates,
    opts,
    loadedFile,
    sleepFn,
  );
  log(
    `\nload: 対象${candidates.length}レース / 処理${totals.races} / 埋める列なし${totals.noFill} / ` +
      `艇の対応なし${totals.unmatchedRaces}レース / 書き込み${totals.written}列 / 失敗バッチ${totals.failedBatches}` +
      (opts.apply ? "" : "（DRY-RUN。書き込むには --apply）"),
  );
  return loadExitCode(totals, opts);
}
