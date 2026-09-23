#!/usr/bin/env node
/**
 * 出走表（公式 racelist ページ）過去分バックフィルCLI（N19: 3連率の欠落対応）
 *
 * 設計: docs/design/pre-race-full-fields/plan.md §6。背景: 2025-12-03〜2026-02-14の一部レース
 * （約8,900レース、race_entries 約52,000行）で、global_3rate（3連率）等がNULL。当初検討していた
 * 「Kファイルの累積から導出」は、独立レビューで検証した結果、導出値と公式値の完全一致率が約5%
 * （30/582）にとどまり不採用（docs/design/kb-longterm-backfill/plan.md 50行）。モーター・ボートの
 * 3連率はモーター使用開始日（N26）と全履歴に依存するため、Kファイルの部分的な蓄積では再現できない。
 * 公式の出走表（racelist）ページを再取得すれば、3連率に加えF数・L数・体重・支部も同時に埋まる
 * （scripts/lib/raceListParser.jsが既に全項目を解析できる。PR#756で実装済み）。
 *
 * 【上書き方針・最重要】実ページで確認した通り（2025-12-03-01-07他）、過去日のracelistページを今
 * 再取得すると、win_rate・motor_number・boat_number_id等は、当時のスナップショット（発走60分前）と
 * 異なる値になる（節の途中のモーター・ボート交換、勝率のその後の更新が理由と推定）。そのため、この
 * CLIが書く列は「既存値がNULLの列だけ」に限定する（scripts/lib/racelistBackfillRows.js の
 * RACELIST_BACKFILL_COLUMNS）。既に値のある列には、再取得した値と異なっていても一切触れない。
 *
 * kb-backfill.js・fan-backfill.js・monthly-schedule-backfill.js と同じ構成（取得・解析・投入を別
 * ステップに分離。取り直しをしない設計）。ただし対象日の一覧を持たず、**対象レースの一覧を本番DBの
 * 読み取りで決める**（global_3rate が NULL の行を持つレース）点が異なる:
 *   plan      対象レースの件数・download の見積り（リクエスト数・所要夜数）。DBは読み取りのみ。書き込み・
 *             公式サイトへのリクエストなし（= download --dry-run）
 *   download  公式サイトから出走表ページを取得し、生のHTML（gzip）をアーカイブへ保存する。DBは対象の
 *             読み取りのみ。書き込みなし
 *   parse     アーカイブの生HTML → 全項目の中間JSON（racelist-backfill/v1）。ネットワーク・DB不要。
 *             何度でも再実行できる
 *   load      中間JSON + 本番DBの現在値 → race_entries の該当行。既存値がNULLの列だけを埋める
 *             （上書きしない）。既定は検証のみ（DBは読み取りのみ）で、--apply が無ければ書き込まない
 *   status    対象・取得・解析・投入の状況（対象件数は本番DBの読み取りで確認する）
 *
 * 使用例:
 *   node --env-file=.env.local scripts/maintenance/racelist-backfill.js plan
 *   node --env-file=.env.local scripts/maintenance/racelist-backfill.js download
 *   node scripts/maintenance/racelist-backfill.js parse
 *   node --env-file=.env.local scripts/maintenance/racelist-backfill.js load          # 検証のみ（DB読み取りのみ）
 *   node --env-file=.env.local scripts/maintenance/racelist-backfill.js load --apply  # 書き込み（要承認）
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） /
 *             4=サーキットブレーカー（403/429/503等の連続。時間を置いてから再開する）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRaceListPage } from "../lib/raceListParser.js";
import {
  RACELIST_BACKFILL_COLUMNS,
  buildFillRowsForRace,
  buildRacelistUrl,
  loadTargetRaceIds,
  racelistArchiveRelPath,
} from "../lib/racelistBackfillRows.js";
import { fetchExistingRows, upsertChangedRows } from "../lib/unchangedRows.js";
import { PRE_RACE_OPTIONAL_COLUMN_GROUPS } from "../lib/preRaceSchema.js";
import {
  HARD_MIN_INTERVAL_MS,
  appendJsonl,
  readJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const RACELIST_SCHEMA = "racelist-backfill/v1";

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {
    command,
    from: null, // race_id の下限（YYYY-MM-DD）。未指定なら対象の全期間
    to: null, // race_id の上限（YYYY-MM-DD）
    archiveDir: path.join(REPO_ROOT, "data/racelist-backfill-archive"),
    dailyLimit: 2000,
    window: "22-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 1000,
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    raceChunkSize: 300, // load: 既存行を読む1回あたりの対象レース数（内部でさらに100件ずつに分割される）
    batchSize: 500, // load: upsertの1文あたりの行数
    sleepMs: 500, // load: バッチ間隔（Disk IO Budgetへの配慮）
  };
  for (const arg of rest) {
    const [k, v] = arg.startsWith("--")
      ? arg.slice(2).split("=")
      : [arg, undefined];
    switch (k) {
      case "from":
        opts.from = v;
        break;
      case "to":
        opts.to = v;
        break;
      case "archive-dir":
        opts.archiveDir = path.resolve(v);
        break;
      case "daily-limit":
        opts.dailyLimit = Number(v);
        break;
      case "window":
        opts.window = v;
        break;
      case "interval-min-ms":
        opts.intervalMinMs = Number(v);
        break;
      case "interval-max-ms":
        opts.intervalMaxMs = Number(v);
        break;
      case "assumed-latency-ms":
        opts.latencyMs = Number(v);
        break;
      case "max-requests":
        opts.maxRequests = Number(v);
        break;
      case "race-chunk-size":
        opts.raceChunkSize = Number(v);
        break;
      case "batch-size":
        opts.batchSize = Number(v);
        break;
      case "sleep-ms":
        opts.sleepMs = Number(v);
        break;
      case "dry-run":
        opts.dryRun = true;
        break;
      case "apply":
        opts.apply = true;
        break;
      case "force":
        opts.force = true;
        break;
      default:
        throw new Error(`不明なオプション: ${arg}`);
    }
  }
  return opts;
}

function validateOptions(opts) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  if (opts.from !== null && !isDate(opts.from))
    throw new Error("--from の形式が不正です（YYYY-MM-DD）");
  if (opts.to !== null && !isDate(opts.to))
    throw new Error("--to の形式が不正です（YYYY-MM-DD）");
  if (opts.from !== null && opts.to !== null && opts.from > opts.to)
    throw new Error("--from は --to 以前にしてください");
  if (opts.command === "download" || opts.command === "plan") {
    if (opts.intervalMinMs < HARD_MIN_INTERVAL_MS) {
      console.warn(
        `--interval-min-ms は ${HARD_MIN_INTERVAL_MS}ms 未満にできません。切り上げます`,
      );
      opts.intervalMinMs = HARD_MIN_INTERVAL_MS;
    }
    if (opts.intervalMaxMs < opts.intervalMinMs)
      opts.intervalMaxMs = opts.intervalMinMs;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// アーカイブ（ファイルシステム）
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
const loadedPath = (dir) => path.join(dir, "loaded.jsonl");
const rawPath = (dir, raceId) =>
  path.join(dir, "raw", racelistArchiveRelPath(raceId, "html.gz"));
const parsedPath = (dir, raceId) =>
  path.join(dir, "parsed", racelistArchiveRelPath(raceId, "json.gz"));

function latestManifestByKey(dir) {
  const map = new Map();
  for (const e of readJsonl(manifestPath(dir))) map.set(e.key, e);
  return map;
}

function readParsedRace(dir, raceId) {
  const file = parsedPath(dir, raceId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );

// ---------------------------------------------------------------------------
// plan / download（対象は本番DBの読み取りで決める。取得ループ自体は archiveDownloader.js を再利用）
// ---------------------------------------------------------------------------

async function loadTargets(opts, deps) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  return loadTargetRaceIds(client, { from: opts.from, to: opts.to });
}

/**
 * @param {object} opts
 * @param {{client?: object, sleep?: Function, fetchOnce?: Function, now?: () => Date, log?: Function}} [deps]
 */
export async function cmdDownload(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const targetIds = deps.targetIds ?? (await loadTargets(opts, deps));
  log(
    `対象レース（global_3rateがNULL、${opts.from ?? "全期間"}〜${opts.to ?? "全期間"}）: ${targetIds.length}件`,
  );
  const items = targetIds.map((raceId) => ({
    key: raceId,
    url: buildRacelistUrl(raceId),
  }));
  return runArchiveDownload({
    items,
    manifestFile: manifestPath(opts.archiveDir),
    runsFile: path.join(opts.archiveDir, "runs.jsonl"),
    userAgent: USER_AGENT,
    opts,
    deps,
    // 対象は「既に確定した過去のレース」のみのため、選手0人・想定外の艇数は異常（構造変更・ブロックの疑い）
    validate: async (bytes) => {
      const html = new TextDecoder("utf-8").decode(bytes);
      const page = parseRaceListPage(html);
      if (page.entries.length === 0) {
        throw new Error(
          "出走表に選手情報がありません（過去の確定レースのはずが未取得扱い。想定外）",
        );
      }
      // motor_boat_marker（モーター・ボート変更の赤表示。N18、本バックフィルの対象列
      // RACELIST_BACKFILL_COLUMNSには含まれない別項目）は、raceListParser.js自身のコメント
      // どおり「発見のための記録」であり、致命的な構造変化ではない。2026-09-23の本番実行で
      // 実際に3件連続して現れ（is-fColor1、初めて実データで確認できたクラス名）、サーキット
      // ブレーカーが誤って作動した。entries_count・deadlines_count等の他の異常は、対象列の
      // 正確性に関わるため引き続き致命的として扱う
      const criticalAnomalies = page.anomalies.filter(
        (a) => !a.startsWith("motor_boat_marker:"),
      );
      if (criticalAnomalies.length > 0) {
        throw new Error(`要確認: ${criticalAnomalies.join(", ")}`);
      }
      return { status: "ok" };
    },
    save: (item, bytes) => {
      const file = rawPath(opts.archiveDir, item.key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, zlib.gzipSync(bytes));
      return `raw/${racelistArchiveRelPath(item.key, "html.gz")}`;
    },
    // 404は、対象が全て既に確定した過去レースのため常に想定外（isAbsentExpected既定=false のまま）
  });
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

export async function cmdParse(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const manifest = latestManifestByKey(opts.archiveDir);
  let targets = 0;
  let written = 0;
  let skipped = 0;
  const anomalies = [];
  for (const [raceId, entry] of manifest) {
    if (entry.status !== "ok") continue;
    targets++;
    const out = parsedPath(opts.archiveDir, raceId);
    if (!opts.force && fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const gz = fs.readFileSync(rawPath(opts.archiveDir, raceId));
    const bytes = new Uint8Array(zlib.gunzipSync(gz));
    if (entry.sha256 && sha256(bytes) !== entry.sha256) {
      throw new Error(
        `${raceId}: 生ファイルのsha256がマニフェストと一致しません`,
      );
    }
    const html = new TextDecoder("utf-8").decode(bytes);
    const page = parseRaceListPage(html);
    if (page.anomalies.length > 0) {
      anomalies.push({ raceId, anomalies: page.anomalies });
      appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
        raceId,
        anomalies: page.anomalies,
        at: new Date().toISOString(),
      });
    }
    const day = {
      schema: RACELIST_SCHEMA,
      race_id: raceId,
      parsed_at: new Date().toISOString(),
      parser_version: page.parser_version,
      meta: page.meta,
      deadlines: page.deadlines,
      entries: page.entries,
      anomalies: page.anomalies,
      source: {
        file: entry.file,
        sha256: entry.sha256,
        bytes: entry.bytes,
        fetchedAt: entry.fetchedAt,
      },
    };
    const outFile = parsedPath(opts.archiveDir, raceId);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, zlib.gzipSync(JSON.stringify(day)));
    written++;
    log(
      `${raceId} 選手${page.entries.length}人 ${page.anomalies.length ? `⚠ ${page.anomalies.join(" / ")}` : "ok"}`,
    );
  }
  log(
    `\nparse: 対象 ${targets}件 / 出力 ${written} / 既存スキップ ${skipped} / 要確認 ${anomalies.length}`,
  );
  if (targets === 0) {
    console.error(
      "解析対象の生ファイルがありません（先に download を実行してください）",
    );
    return 1;
  }
  if (targets > 0 && written + skipped === 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * load 1バッチ分（対象レースID最大 raceChunkSize 件）の処理。既存行を1回のIN句で読み、
 * 既存値がNULLの列だけを埋める行を組み立てて upsertChangedRows に渡す（DRY-RUNでも読み取りは行う。
 * 「どの列が埋まるか」はDBの現在値に依存するため、書き込み計画自体にDB読み取りが要る）。
 *
 * @returns {Promise<{races: number, noFill: number, unmatchedRaces: number, written: number, error: boolean}>}
 */
async function loadBatch(client, raceIds, opts) {
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

export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const manifest = latestManifestByKey(opts.archiveDir);
  const loadedFile = loadedPath(opts.archiveDir);
  const loadedSet = new Set(readJsonl(loadedFile).map((e) => e.race_id));
  const downloadedIds = [...manifest.values()]
    .filter((e) => e.status === "ok")
    .map((e) => e.key);
  if (downloadedIds.length === 0) {
    console.error("投入対象がありません（先に download を実行してください）");
    return 1;
  }
  const parsedIds = downloadedIds.filter(
    (raceId) => readParsedRace(opts.archiveDir, raceId) !== null,
  );
  if (parsedIds.length === 0) {
    console.error(
      "解析済みの中間JSONがありません（先に parse を実行してください）",
    );
    return 1;
  }
  const candidates = parsedIds
    .filter((raceId) => opts.force || !loadedSet.has(raceId))
    .sort();
  if (candidates.length === 0) {
    log("対象は全て投入済みです（再投入は --force）");
    return 0;
  }
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const probe = await client.from("race_entries").select("race_id").limit(1);
  if (probe.error) {
    console.error(`race_entries を読めません: ${probe.error.message}`);
    return 1;
  }

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
  log(
    `\nload: 対象${candidates.length}レース / 処理${totals.races} / 埋める列なし${totals.noFill} / ` +
      `艇の対応なし${totals.unmatchedRaces}レース / 書き込み${totals.written}列 / 失敗バッチ${totals.failedBatches}` +
      (opts.apply ? "" : "（DRY-RUN。書き込むには --apply）"),
  );
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

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

async function cmdStatus(opts, deps = {}) {
  const manifest = latestManifestByKey(opts.archiveDir);
  const loaded = new Set(
    readJsonl(loadedPath(opts.archiveDir)).map((e) => e.race_id),
  );
  const targetIds = deps.targetIds ?? (await loadTargets(opts, deps));
  const c = { targets: targetIds.length, download: {}, parsed: 0, loaded: 0 };
  for (const raceId of targetIds) {
    const s = manifest.get(raceId)?.status ?? "none";
    c.download[s] = (c.download[s] ?? 0) + 1;
    if (readParsedRace(opts.archiveDir, raceId)) c.parsed++;
    if (loaded.has(raceId)) c.loaded++;
  }
  console.log(JSON.stringify(c, null, 2));
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (
      !["plan", "download", "parse", "load", "status"].includes(opts.command)
    ) {
      console.error(
        "使い方: node scripts/maintenance/racelist-backfill.js <plan|download|parse|load|status> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [オプション]\n詳細はファイル冒頭のコメントを参照",
      );
      return 1;
    }
    validateOptions(opts);
    if (opts.command === "plan") opts.dryRun = true;
    if (opts.command === "plan" || opts.command === "download")
      return await cmdDownload(opts);
    if (opts.command === "parse") return await cmdParse(opts);
    if (opts.command === "load") return await cmdLoad(opts);
    return await cmdStatus(opts);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    return 1;
  }
}

export const _internal = {
  parseArgs,
  validateOptions,
  manifestPath,
  loadedPath,
  rawPath,
  parsedPath,
  readParsedRace,
  loadBatch,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
