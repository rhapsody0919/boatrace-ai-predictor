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
  HARD_MIN_INTERVAL_MS,
  appendJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";
import {
  cmdLoad,
  cmdStatus,
  cmdSyncProfiles,
  latestManifestByKey,
  manifestPath,
  parsedPath,
  rawPath,
} from "./fan-backfill-load.js";

// アーカイブの読み（パス・マニフェスト・中間JSON）と load・sync-profiles・status は fan-backfill-load.js（大きさの線のため分けた）
export {
  cmdLoad,
  cmdStatus,
  cmdSyncProfiles,
  parsedPath,
  rawPath,
  readParsedFan,
} from "./fan-backfill-load.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

/** 値を取る文字列のオプション（--名=値 → opts のキー） */
const STRING_OPTIONS = new Map([
  ["from", "from"],
  ["to", "to"],
  ["id", "id"],
  ["window", "window"],
]);
/** 値を Number() にかける数値のオプション */
const NUMBER_OPTIONS = new Map([
  ["daily-limit", "dailyLimit"],
  ["interval-min-ms", "intervalMinMs"],
  ["interval-max-ms", "intervalMaxMs"],
  ["assumed-latency-ms", "latencyMs"],
  ["max-requests", "maxRequests"],
  ["batch-size", "batchSize"],
  ["sleep-ms", "sleepMs"],
]);
/** 値を取らない旗のオプション（付けると true） */
const FLAG_OPTIONS = new Map([
  ["dry-run", "dryRun"],
  ["apply", "apply"],
  ["force", "force"],
  ["plain", "plain"],
]);

function defaultOptions(command, now) {
  return {
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
}

function applyOption(opts, arg) {
  const [k, v] = arg.startsWith("--")
    ? arg.slice(2).split("=")
    : [arg, undefined];
  if (STRING_OPTIONS.has(k)) opts[STRING_OPTIONS.get(k)] = v;
  else if (NUMBER_OPTIONS.has(k)) opts[NUMBER_OPTIONS.get(k)] = Number(v);
  else if (FLAG_OPTIONS.has(k)) opts[FLAG_OPTIONS.get(k)] = true;
  else if (k === "archive-dir") opts.archiveDir = path.resolve(v);
  else throw new Error(`不明なオプション: ${arg}`);
}

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  const opts = defaultOptions(command, now);
  for (const arg of rest) applyOption(opts, arg);
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

/** 1ファイルを解析して parsed/ へ書き、解析の要約を返す（異常は anomalies.jsonl へ追記する） */
async function parseOneFan(opts, id, m, out) {
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
  return { s, anomalous: fan.anomalies.length > 0 };
}

function parseLogLine(id, s) {
  return `${id} ${s.records}人 ${s.period ? `${s.period.year}年${s.period.no}期 ${s.period.calc_from}〜${s.period.calc_to}` : "期不明"} レコード長${s.layout_bytes.join("/")} ${s.anomalies ? `⚠ 要確認${s.anomalies}` : "ok"}`;
}

function parseExitCode(targets, written, skipped) {
  if (targets === 0) {
    console.error(
      "解析対象の生ファイルがありません（先に download を実行してください）",
    );
    return 1;
  }
  if (written + skipped === 0) return 1;
  return 0;
}

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
    const { s, anomalous } = await parseOneFan(opts, id, m, out);
    if (anomalous) withAnomalies++;
    written++;
    log(parseLogLine(id, s));
  }
  log(
    `\nparse: 対象 ${targets}ファイル / 出力 ${written} / 既存スキップ ${skipped} / 要確認あり ${withAnomalies}`,
  );
  return parseExitCode(targets, written, skipped);
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
