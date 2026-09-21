#!/usr/bin/env node
/**
 * 公式「レーサー期別成績」ファイル（fan）の取得・解析・投入CLI
 *
 * 設計: docs/design/racer-period-stats/plan.md
 * 背景: 全データ設計 N13・N21・N22（ユーザー承認Q2、2026-09-20）。選手の期別成績・能力指数・コース別成績・
 *       プロフィールの取得元を、選手別スクレイピング（B6、1,627人×2ページ）から、公式の期別成績ファイル
 *       （fan{YYMM}.lzh、2001年10月〜、2026-09-21時点で50ファイル）へ置き換える。
 *
 * kb-backfill.js と同じ構成（取得・解析・投入を別ステップに分離。取り直しをしない設計）:
 *   plan          download の見積り（リクエスト数・所要夜数）。ネットワーク・書き込みなし（= download --dry-run）
 *   download      公式サイトから生のLZHをアーカイブへ保存する（ネットワークのみ。DBは触らない）
 *   parse         アーカイブの生LZH → 全項目の中間JSON（fan-period/v1）。ネットワーク・DB不要。何度でも再実行できる
 *   load          中間JSON → racer_period_stats。既定は検証のみで、--apply が無ければ書き込まない
 *   sync-profiles 最新期の値 → racer_profiles（既存の読み手向けの列。B6の置き換え）。既定は検証のみ
 *   status        取得・解析・投入の状況
 *
 * 使用例:
 *   node scripts/maintenance/fan-backfill.js plan --from=fan1904 --to=fan2604
 *   node scripts/maintenance/fan-backfill.js download --from=fan1904 --to=fan2604
 *   node scripts/maintenance/fan-backfill.js parse --from=fan1904 --to=fan2604
 *   node --env-file=.env.local scripts/maintenance/fan-backfill.js load --from=fan1904 --to=fan2604           # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/fan-backfill.js load --from=fan1904 --to=fan2604 --apply   # 書き込み（要承認）
 *   node --env-file=.env.local scripts/maintenance/fan-backfill.js sync-profiles --id=fan2604 --apply        # 要承認
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） /
 *             4=サーキットブレーカー（403/429/503等の連続。時間を置いてから再開する）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decodeLzhBytes } from "../lib/kbFileParser.js";
import {
  FAN_SCHEMA,
  FAN_EARLIEST_ID,
  FAN_USER_AGENT,
  buildFanUrl,
  fanArchiveRelPath,
  listFanIds,
  latestExpectedFanId,
  parseFanId,
  parseFanFile,
  summarizeFan,
} from "../lib/fanPeriodParser.js";
import {
  FAN_TABLES,
  NUMERIC_SCALES,
  buildStatsRows,
  buildProfileSyncRows,
} from "../lib/fanPeriodRows.js";
import { derivePeriodLabel } from "../lib/racerSeasonStats.js";
import { diffRows } from "../lib/unchangedRows.js";
import {
  HARD_MIN_INTERVAL_MS,
  appendJsonl,
  readJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  const opts = {
    command,
    from: FAN_EARLIEST_ID,
    to: latestExpectedFanId(now),
    id: null,
    archiveDir: path.join(REPO_ROOT, "data/fan-archive"),
    dailyLimit: 100,
    window: "22-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 10000, // この環境の実測（約8〜10秒）。ユーザー端末では未計測
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    plain: false,
    batchSize: 200,
    sleepMs: 500,
    minRecords: 500, // 実ファイルは1,500人以上。これ未満は形式の変更とみなす
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
      case "id":
        opts.id = v;
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
      case "plain":
        opts.plain = true;
        break;
      default:
        throw new Error(`不明なオプション: ${arg}`);
    }
  }
  return opts;
}

export function validateOptions(opts) {
  parseFanId(opts.from);
  parseFanId(opts.to);
  if (listFanIds(opts.from, opts.to).length === 0)
    throw new Error("--from は --to 以前にしてください");
  if (opts.id) parseFanId(opts.id);
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
// download
// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {object} [deps] テスト用の差し替え（sleep・fetchOnce・now・backoffBaseMs・log）
 */
export async function cmdDownload(opts, deps = {}) {
  const now = deps.now ?? (() => new Date());
  const expectedLatest = latestExpectedFanId(now());
  const items = listFanIds(opts.from, opts.to).map((id) => ({
    key: id,
    url: buildFanUrl(id),
  }));
  return runArchiveDownload({
    items,
    manifestFile: manifestPath(opts.archiveDir),
    runsFile: path.join(opts.archiveDir, "runs.jsonl"),
    userAgent: FAN_USER_AGENT,
    opts,
    deps,
    // 暦の上で最新の期のファイルは、まだ公開されていないことがある（Last-Modifiedの実測: 4月分が6月末、10月分が11月中旬）
    isAbsentExpected: (item) => item.key === expectedLatest,
    validate: async (bytes, item) => {
      const data = await decodeLzhBytes(bytes);
      const fan = parseFanFile(data, { id: item.key });
      if (fan.record_count < opts.minRecords)
        throw new Error(
          `選手のレコードが${fan.record_count}件しかありません（形式の変更の疑い）`,
        );
      return { status: "ok" };
    },
    save: (item, bytes) => {
      const file = rawPath(opts.archiveDir, item.key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      return fanArchiveRelPath(item.key);
    },
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
  let withAnomalies = 0;
  for (const id of listFanIds(opts.from, opts.to)) {
    const m = manifest.get(id);
    if (m?.status !== "ok") continue;
    targets++;
    const out = parsedPath(opts.archiveDir, id, opts.plain);
    if (!opts.force && fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const raw = new Uint8Array(fs.readFileSync(rawPath(opts.archiveDir, id)));
    // 生ファイルの破損・差し替えを、マニフェストのsha256で検知する
    if (m.sha256 && sha256(raw) !== m.sha256)
      throw new Error(`${id}: 生ファイルのsha256がマニフェストと一致しません`);
    const fan = parseFanFile(await decodeLzhBytes(raw), {
      id,
      source: {
        file: m.file,
        sha256: m.sha256,
        bytes: m.bytes,
        fetchedAt: m.fetchedAt,
        lastModified: m.lastModified ?? null,
      },
    });
    const s = summarizeFan(fan);
    if (fan.anomalies.length > 0) {
      withAnomalies++;
      appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
        id,
        anomalies: fan.anomalies.slice(0, 50),
        total: fan.anomalies.length,
        at: new Date().toISOString(),
      });
    }
    const json = JSON.stringify(fan);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
    written++;
    log(
      `${id} ${s.records}人 ${s.period ? `${s.period.year}年${s.period.no}期 ${s.period.calc_from}〜${s.period.calc_to}` : "期不明"} レコード長${s.layout_bytes.join("/")} ${s.anomalies ? `⚠ 要確認${s.anomalies}` : "ok"}`,
    );
  }
  log(
    `\nparse: 対象 ${targets}ファイル / 出力 ${written} / 既存スキップ ${skipped} / 要確認あり ${withAnomalies}`,
  );
  if (targets === 0) {
    console.error(
      "解析対象の生ファイルがありません（先に download を実行してください）",
    );
    return 1;
  }
  if (written + skipped === 0) return 1;
  return 0;
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

/**
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{client?: object, sleep?: Function, log?: Function}} [deps]
 */
export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const loadedFile = path.join(opts.archiveDir, "loaded.jsonl");
  const loaded = new Set(readJsonl(loadedFile).map((e) => e.id));
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
  for (const { id, rows, period } of plan) {
    if (loaded.has(id) && !opts.force) continue;
    processed++;
    // 変更の無い行は書かない（WAL・Disk IO対策）。期ごとに既存行を全件読み、差分のある行だけを書く
    const existing = await fetchAll(client, spec.table, Object.keys(rows[0]), [
      ["period_year", period.year],
      ["period_no", period.no],
    ]);
    const { toWrite, stats } = diffRows(existing, rows, {
      keyColumns: spec.keyColumns,
      scales: NUMERIC_SCALES[spec.table],
    });
    let failed = false;
    for (const part of chunk(toWrite, opts.batchSize)) {
      const { error } = await client
        .from(spec.table)
        .upsert(part, { onConflict: spec.onConflict });
      if (error) {
        failed = true;
        console.error(`${id}: 書き込みに失敗: ${error.message}`);
        break;
      }
      summary.written += part.length;
      await sleepFn(opts.sleepMs); // 文の間隔（Disk IO Budgetへの配慮）
    }
    summary.unchanged += stats.unchanged;
    if (failed) {
      summary.failedFiles++;
      continue; // loaded に記録しない（再実行で再試行される）
    }
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
  }
  log(
    `\nload: ${JSON.stringify(summary)}（処理 ${processed} / 投入済みスキップ ${plan.length - processed}）`,
  );
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

const SEASON_COLUMNS = [
  "ability_index",
  "flying_count_period",
  "false_start_count_period",
  "period_label",
  "official_win_rate_period",
];
const PROFILE_BASE_COLUMNS = ["height_cm", "weight_kg", "branch"];
const PROFILE_NEW_COLUMNS = ["sex", "training_term"];

/**
 * 最新期の値を racer_profiles へ反映する（B6の期別成績・プロフィール項目の置き換え）。
 * 既存の行の更新のみ（新規作成しない）。より新しい期の値が入っている行は、書き戻さない。
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {{client?: object, sleep?: Function, log?: Function}} [deps]
 */
export async function cmdSyncProfiles(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const id =
    opts.id ??
    listFanIds(opts.from, opts.to)
      .reverse()
      .find((x) => readParsedFan(opts.archiveDir, x));
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
  // 083（sex・training_term）が未適用でも壊れないよう、列の有無を先に確認する
  const probe = await client
    .from("racer_profiles")
    .select("racer_id,sex,training_term")
    .limit(1);
  const hasNewColumns = !probe.error;
  if (!hasNewColumns)
    console.warn(
      `  ⚠ racer_profiles.sex・training_term を読めません（DDL 083 が未適用）。この2列を除いて更新します`,
    );
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
  let written = 0;
  let failed = 0;
  for (const row of toWrite) {
    const e = existingById.get(row.racer_id);
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
      failed++;
      console.error(
        `racer_id=${racer_id}: 更新に失敗（${error?.message ?? "対象行なし"}）`,
      );
      continue;
    }
    written++;
    await sleepFn(opts.sleepMs);
  }
  log(`sync-profiles: 更新 ${written} / 失敗 ${failed}`);
  if (failed > 0) return 1;
  if (toWrite.length === 0 && stats.unchanged === 0) {
    console.error("更新対象も変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
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

// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (
      ![
        "plan",
        "download",
        "parse",
        "load",
        "sync-profiles",
        "status",
      ].includes(opts.command)
    ) {
      console.error(
        "使い方: node scripts/maintenance/fan-backfill.js <plan|download|parse|load|sync-profiles|status> [--from=fanYYMM] [--to=fanYYMM] [オプション]\n詳細はファイル冒頭のコメントを参照",
      );
      return 1;
    }
    validateOptions(opts);
    if (opts.command === "plan") opts.dryRun = true;
    if (opts.command === "plan" || opts.command === "download")
      return await cmdDownload(opts);
    if (opts.command === "parse") return await cmdParse(opts);
    if (opts.command === "load") return await cmdLoad(opts);
    if (opts.command === "sync-profiles") return await cmdSyncProfiles(opts);
    return cmdStatus(opts);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    return 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
