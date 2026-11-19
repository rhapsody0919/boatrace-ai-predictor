/**
 * fan-backfill.js の、アーカイブの読み（パス・マニフェスト・中間JSON）と load（中間JSON → racer_period_stats）・
 * sync-profiles（最新期の値 → racer_profiles）・status。CLI と使い方は fan-backfill.js の冒頭のコメント。
 * 大きさの線（400行）のため分けた（中身は変えない）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  FAN_SCHEMA,
  fanArchiveRelPath,
  listFanIds,
} from "../lib/fanPeriodParser.js";
import {
  FAN_TABLES,
  NUMERIC_SCALES,
  buildStatsRows,
  buildProfileSyncRows,
} from "../lib/fanPeriodRows.js";
import { derivePeriodLabel } from "../lib/racerSeasonStats.js";
import { diffRows } from "../lib/unchangedRows.js";
import { appendJsonl, readJsonl } from "../lib/archiveDownloader.js";

// ---------------------------------------------------------------------------
// アーカイブ（ファイルシステム）
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
export const rawPath = (dir, id) =>
  path.join(dir, "raw", fanArchiveRelPath(id));
export const parsedPath = (dir, id, plain) =>
  path.join(dir, "parsed", `${id}.json${plain ? "" : ".gz"}`);

function latestManifestByKey(dir) {
  const map = new Map();
  for (const e of readJsonl(manifestPath(dir))) map.set(e.key, e);
  return map;
}

export function readParsedFan(dir, id) {
  for (const plain of [false, true]) {
    const file = parsedPath(dir, id, plain);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      return JSON.parse(
        plain ? buf.toString("utf8") : zlib.gunzipSync(buf).toString("utf8"),
      );
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// load / sync-profiles（DBへ。既定は検証のみ）
// ---------------------------------------------------------------------------

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));
const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );

/** テーブルの行を、主キー順にページ巡回して全件取得する（PostgRESTの上限1000行を超える） */
async function fetchAll(client, table, columns, filters = []) {
  const rows = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    let q = client.from(table).select(columns.join(","));
    for (const [col, val] of filters) q = q.eq(col, val);
    const { data, error } = await q
      .order("racer_id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`${table} の取得に失敗: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return rows;
}

/** 中間JSONを読み、検証して投入計画（ファイルごとの行）を作る。DBには触れない */
function buildLoadPlan(opts) {
  const plan = [];
  const totals = { files: 0, rows: 0, warnings: 0 };
  for (const id of listFanIds(opts.from, opts.to)) {
    const fan = readParsedFan(opts.archiveDir, id);
    if (!fan) continue;
    if (fan.schema !== FAN_SCHEMA)
      throw new Error(`${id}: 未対応のスキーマ ${fan.schema}`);
    const { rows, warnings } = buildStatsRows(fan);
    // 同じ主キーの重複を書き込み前に検出する（ON CONFLICT が同一文内の重複で失敗するのを防ぐ）
    const keys = new Set(rows.map((r) => r.racer_id));
    if (keys.size !== rows.length)
      throw new Error(
        `${id}: 登番が重複しています（${rows.length - keys.size}件）`,
      );
    totals.files++;
    totals.rows += rows.length;
    totals.warnings += warnings.length;
    for (const w of warnings) console.warn(`  ⚠ ${w}`);
    plan.push({ id, rows, period: fan.period });
  }
  return { plan, totals };
}

/** 差分の行をバッチで upsert する。失敗したら true を返して止める */
async function upsertBatches(client, spec, toWrite, ctx) {
  const { opts, id, sleepFn, summary } = ctx;
  for (const part of chunk(toWrite, opts.batchSize)) {
    const { error } = await client
      .from(spec.table)
      .upsert(part, { onConflict: spec.onConflict });
    if (error) {
      console.error(`${id}: 書き込みに失敗: ${error.message}`);
      return true;
    }
    summary.written += part.length;
    await sleepFn(opts.sleepMs); // 文の間隔（Disk IO Budgetへの配慮）
  }
  return false;
}

/** 1ファイル分を投入する。書き込みに失敗したら true を返す（loaded に記録しない） */
async function loadOneFile(client, spec, entry, ctx) {
  const { loadedFile, log, summary } = ctx;
  const { id, rows, period } = entry;
  // 変更の無い行は書かない（WAL・Disk IO対策）。期ごとに既存行を全件読み、差分のある行だけを書く
  const existing = await fetchAll(client, spec.table, Object.keys(rows[0]), [
    ["period_year", period.year],
    ["period_no", period.no],
  ]);
  const { toWrite, stats } = diffRows(existing, rows, {
    keyColumns: spec.keyColumns,
    scales: NUMERIC_SCALES[spec.table],
  });
  const failed = await upsertBatches(client, spec, toWrite, ctx);
  summary.unchanged += stats.unchanged;
  if (failed) return true;
  appendJsonl(loadedFile, {
    id,
    at: new Date().toISOString(),
    rows: rows.length,
    written: toWrite.length,
    unchanged: stats.unchanged,
  });
  log(
    `${id}: ${rows.length}行（書き込み ${toWrite.length} / 変更なし ${stats.unchanged}）`,
  );
  return false;
}

function loadExitCode(summary, processed, log) {
  if (summary.failedFiles > 0) return 1;
  if (processed === 0) {
    log("対象は全て投入済みです（再投入は --force）");
    return 0;
  }
  // 0件書き込みを成功扱いにしない（全て変更なしの再実行は unchanged>0 で成功）
  if (summary.written + summary.unchanged === 0) {
    console.error("書き込みも変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
}

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{client?: object, sleep?: Function, log?: Function}} [deps]
 */
export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const loadedFile = path.join(opts.archiveDir, "loaded.jsonl");
  const loaded = new Set(readJsonl(loadedFile).map((e) => e.id));
  const { plan, totals } = buildLoadPlan(opts);
  log(
    `投入対象: ${totals.files}ファイル / ${totals.rows}行 / 警告 ${totals.warnings}`,
  );
  if (totals.files === 0) {
    console.error(
      "投入対象の中間JSONがありません（先に download → parse を実行してください）",
    );
    return 1;
  }
  if (!opts.apply) {
    log(
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（DDL 083 の適用と、ユーザーの実行承認が前提）",
    );
    return 0;
  }

  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const spec = FAN_TABLES.stats;
  const probe = await client.from(spec.table).select("racer_id").limit(1);
  if (probe.error) {
    console.error(
      `${spec.table} を読めません（DDL 083 が未適用の可能性）: ${probe.error.message}`,
    );
    return 1;
  }
  const summary = { written: 0, unchanged: 0, failedFiles: 0 };
  let processed = 0;
  for (const entry of plan) {
    if (loaded.has(entry.id) && !opts.force) continue;
    processed++;
    const ctx = { opts, id: entry.id, loadedFile, log, sleepFn, summary };
    if (await loadOneFile(client, spec, entry, ctx)) summary.failedFiles++;
  }
  log(
    `\nload: ${JSON.stringify(summary)}（処理 ${processed} / 投入済みスキップ ${plan.length - processed}）`,
  );
  return loadExitCode(summary, processed, log);
}

const SEASON_COLUMNS = [
  "ability_index",
  "flying_count_period",
  "false_start_count_period",
  "period_label",
  "official_win_rate_period",
];
const PROFILE_BASE_COLUMNS = ["height_cm", "weight_kg", "branch"];
const PROFILE_NEW_COLUMNS = ["sex", "training_term"];

/** --id が無ければ、解析済みの最新の期の id を探す */
function resolveSyncId(opts) {
  return (
    opts.id ??
    listFanIds(opts.from, opts.to)
      .reverse()
      .find((x) => readParsedFan(opts.archiveDir, x))
  );
}

/** 083（sex・training_term）が未適用でも壊れないよう、列の有無を先に確認する */
async function probeNewColumns(client) {
  const probe = await client
    .from("racer_profiles")
    .select("racer_id,sex,training_term")
    .limit(1);
  const hasNewColumns = !probe.error;
  if (!hasNewColumns)
    console.warn(
      `  ⚠ racer_profiles.sex・training_term を読めません（DDL 083 が未適用）。この2列を除いて更新します`,
    );
  return hasNewColumns;
}

/** 1行を update で書く。失敗したら（ログを出して）false */
async function updateProfileRow(client, row, e, stamp) {
  const seasonChanged = SEASON_COLUMNS.some(
    (c) => e[c] === undefined || String(e[c] ?? "") !== String(row[c] ?? ""),
  );
  const { racer_id, ...values } = row;
  if (seasonChanged) values.official_updated_at = stamp;
  // upsert は INSERT 側の NOT NULL 検査（name・birth_date）が先に走り既存行でも失敗するため、update で書く
  const { data, error } = await client
    .from("racer_profiles")
    .update(values)
    .eq("racer_id", racer_id)
    .select("racer_id");
  if (error || !data || data.length === 0) {
    console.error(
      `racer_id=${racer_id}: 更新に失敗（${error?.message ?? "対象行なし"}）`,
    );
    return false;
  }
  return true;
}

async function updateProfileRows(client, toWrite, existingById, ctx) {
  const { stamp, sleepFn, sleepMs } = ctx;
  let written = 0;
  let failed = 0;
  for (const row of toWrite) {
    const e = existingById.get(row.racer_id);
    if (!(await updateProfileRow(client, row, e, stamp))) {
      failed++;
      continue;
    }
    written++;
    await sleepFn(sleepMs);
  }
  return { written, failed };
}

function syncExitCode(failed, toWrite, stats) {
  if (failed > 0) return 1;
  if (toWrite.length === 0 && stats.unchanged === 0) {
    console.error("更新対象も変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
}

/**
 * 最新期の値を racer_profiles へ反映する（B6の期別成績・プロフィール項目の置き換え）。
 * 既存の行の更新のみ（新規作成しない）。より新しい期の値が入っている行は、書き戻さない。
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{client?: object, sleep?: Function, log?: Function}} [deps]
 */
export async function cmdSyncProfiles(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const id = resolveSyncId(opts);
  if (!id) {
    console.error("解析済みの中間JSONがありません（先に download → parse）");
    return 1;
  }
  const fan = readParsedFan(opts.archiveDir, id);
  if (!fan) {
    console.error(`${id} の中間JSONがありません`);
    return 1;
  }
  const label = derivePeriodLabel(fan.period.calc_to);
  const client =
    deps.client ??
    (opts.apply ? (await import("../lib/supabaseClient.js")).supabase : null);
  if (!client) {
    const { rows } = buildProfileSyncRows(fan);
    log(
      `[DRY-RUN] ${id}（${label}）: ${rows.length}人分の更新行を作れます。DBには接続しません。--apply で、既存の racer_profiles との差分を計算して更新します（DDL 083 と承認が前提）`,
    );
    return 0;
  }
  const hasNewColumns = await probeNewColumns(client);
  const { rows, warnings } = buildProfileSyncRows(fan, {
    includeNewColumns: hasNewColumns,
  });
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
  const columns = [
    "racer_id",
    ...SEASON_COLUMNS,
    ...PROFILE_BASE_COLUMNS,
    ...(hasNewColumns ? PROFILE_NEW_COLUMNS : []),
  ];
  const existing = await fetchAll(client, "racer_profiles", columns);
  const existingById = new Map(existing.map((r) => [r.racer_id, r]));
  // より新しい期の値が入っている行は書き戻さない（period_label は 'YYYY-first'/'YYYY-second' で辞書順=時系列）
  const eligible = rows.filter((r) => {
    const e = existingById.get(r.racer_id);
    return !(e?.period_label && label && e.period_label > label);
  });
  const { toWrite, stats } = diffRows(existing, eligible, {
    keyColumns: ["racer_id"],
    scales: NUMERIC_SCALES.racer_profiles,
    writeMissing: false, // 既存の行の更新のみ。racer_profiles に無い選手は作らない
  });
  const notRegistered = eligible.filter((r) => !existingById.has(r.racer_id));
  log(
    `${id}（${label}）: 対象 ${rows.length}人 / 変更あり ${toWrite.length} / 変更なし ${stats.unchanged} / racer_profiles 未登録 ${notRegistered.length}人（B6の新人登録で補完）`,
  );
  if (!opts.apply) {
    log("[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます");
    return 0;
  }
  const stamp = (deps.now ?? (() => new Date()))().toISOString();
  const ctx = { stamp, sleepFn, sleepMs: opts.sleepMs };
  const { written, failed } = await updateProfileRows(
    client,
    toWrite,
    existingById,
    ctx,
  );
  log(`sync-profiles: 更新 ${written} / 失敗 ${failed}`);
  return syncExitCode(failed, toWrite, stats);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

export function cmdStatus(opts) {
  const manifest = latestManifestByKey(opts.archiveDir);
  const loaded = new Set(
    readJsonl(path.join(opts.archiveDir, "loaded.jsonl")).map((e) => e.id),
  );
  const c = { files: 0, download: {}, parsed: 0, loaded: 0 };
  for (const id of listFanIds(opts.from, opts.to)) {
    c.files++;
    const s = manifest.get(id)?.status ?? "none";
    c.download[s] = (c.download[s] ?? 0) + 1;
    if (readParsedFan(opts.archiveDir, id)) c.parsed++;
    if (loaded.has(id)) c.loaded++;
  }
  console.log(JSON.stringify(c, null, 2));
  return 0;
}

export { manifestPath, latestManifestByKey };
