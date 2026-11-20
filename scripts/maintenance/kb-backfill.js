#!/usr/bin/env node
/**
 * K/Bファイル（公式ダウンロードデータ）の長期バックフィルCLI
 *
 * 設計: docs/design/kb-longterm-backfill/plan.md
 * 背景: BOA-271（アナロジー・ファインダー）の母数拡大のため、2019-04頃〜（取得できる最古は2005-01）の
 *       K/Bファイルを取得する。公式サイトへの負荷（ADR-0067、禁止事項5）とIP制限を避けるため、
 *       逐次・3秒以上のジッター付き間隔・夜間窓・日次上限・サーキットブレーカーで慎重に取得する。
 *
 * 「取得」「解析」「投入」を別ステップに分離している（取り直しをしない設計）:
 *   download  公式サイトから生のLZHをアーカイブへ保存する（ネットワークのみ。DBは触らない）
 *   parse     アーカイブの生LZH → 全項目の中間JSON（kb-day/v1）。ネットワーク・DB不要。何度でも再実行できる
 *             （パーサーが拾う項目を増やしても、再リクエスト無しで再解析できる）
 *   load      中間JSON → アーカイブ表（kb_archive_*）。既定は検証のみで、--apply が無ければ書き込まない
 *   plan      download の見積り（リクエスト数・所要夜数）。ネットワーク・書き込みなし（= download --dry-run）
 *   status    期間内の取得・解析・投入の状況
 *
 * 使用例:
 *   node scripts/maintenance/kb-backfill.js plan --from=2019-04-01 --to=2025-12-02
 *   node scripts/maintenance/kb-backfill.js download --from=2019-04-01 --to=2025-12-02
 *   node scripts/maintenance/kb-backfill.js parse --from=2019-04-01 --to=2025-12-02
 *   node --env-file=.env.local scripts/maintenance/kb-backfill.js load --from=2019-04-01 --to=2025-12-02          # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/kb-backfill.js load --from=2019-04-01 --to=2025-12-02 --apply  # 書き込み（要承認）
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） /
 *             4=サーキットブレーカー（403/429/503等の連続。時間を置いてから再開する）
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  HARD_MIN_INTERVAL_MS,
  jstToday,
  rawPath,
  parsedPath,
} from "./kb-backfill-parts.js";
import { cmdDownload } from "./kb-backfill-download.js";
import {
  cmdParse,
  cmdLoad,
  cmdStatus,
  readParsedDay,
} from "./kb-backfill-load.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

// 本体テーブル（races等）が持つ最古の日。これ以降のK/Bはアーカイブへ投入しない（重複）。
// 値は scripts/lib/kbArchiveBoundary.js が正本（選手の集計の表 190 の書き手と共有する）
import { MAIN_TABLES_START } from "../lib/kbArchiveBoundary.js";
export { MAIN_TABLES_START };
const EARLIEST_AVAILABLE = "2005-01-01";

// 部品・download・parse/load/status は kb-backfill-parts.js・kb-backfill-download.js・kb-backfill-load.js（大きさの線のため分けた）
export {
  dateRange,
  jstToday,
  parseWindow,
  inWindow,
  windowDayKey,
  classifyResponse,
  latestManifest,
  planDownload,
  estimatePlan,
} from "./kb-backfill-parts.js";
export { cmdDownload } from "./kb-backfill-download.js";

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

/** 値を取る文字列のオプション（--名=値 → opts のキー） */
const STRING_OPTIONS = new Map([
  ["from", "from"],
  ["to", "to"],
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
  ["allow-overlap", "allowOverlap"],
]);

function defaultOptions(command) {
  return {
    command,
    from: null,
    to: null,
    archiveDir: path.join(REPO_ROOT, "data/kb-archive"),
    kinds: ["K", "B"],
    dailyLimit: 2000,
    window: "22-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 1000,
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    plain: false,
    allowOverlap: false,
    batchSize: 200,
    sleepMs: 1000,
  };
}

/** 1つの引数（キー k・値 v）を opts へ反映する。不明なキーは例外 */
function applyOption(opts, k, v, arg) {
  if (STRING_OPTIONS.has(k)) opts[STRING_OPTIONS.get(k)] = v;
  else if (NUMBER_OPTIONS.has(k)) opts[NUMBER_OPTIONS.get(k)] = Number(v);
  else if (FLAG_OPTIONS.has(k)) opts[FLAG_OPTIONS.get(k)] = true;
  else if (k === "archive-dir") opts.archiveDir = path.resolve(v);
  else if (k === "kinds")
    opts.kinds = v.split(",").map((s) => s.trim().toUpperCase());
  else throw new Error(`不明なオプション: ${arg}`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = defaultOptions(command);
  for (const arg of rest) {
    const [k, v] = arg.startsWith("--")
      ? arg.slice(2).split("=")
      : [arg, undefined];
    applyOption(opts, k, v, arg);
  }
  return opts;
}

function validateOptions(opts) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  if (!isDate(opts.from)) throw new Error("--from=YYYY-MM-DD は必須です");
  const yesterday = jstToday(new Date(Date.now() - 24 * 60 * 60 * 1000));
  opts.to = opts.to ?? yesterday;
  if (!isDate(opts.to)) throw new Error("--to の形式が不正です（YYYY-MM-DD）");
  if (opts.from > opts.to) throw new Error("--from は --to 以前にしてください");
  if (opts.from < EARLIEST_AVAILABLE)
    throw new Error(
      `--from は ${EARLIEST_AVAILABLE} 以降にしてください（公式の最古）`,
    );
  if (opts.command === "download" || opts.command === "plan") {
    // 当日分は全レース終了前だとプレースホルダが返る。確定していない日は取得しない
    if (opts.to > yesterday) {
      console.warn(
        `--to=${opts.to} は未確定の日を含むため ${yesterday}（JST昨日）に切り詰めます`,
      );
      opts.to = yesterday;
      if (opts.from > opts.to)
        throw new Error("取得できる日がありません（--from が未確定の日です）");
    }
    for (const kind of opts.kinds)
      if (!["K", "B"].includes(kind))
        throw new Error(`--kinds は K,B のみ: ${kind}`);
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

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (
      !["plan", "download", "parse", "load", "status"].includes(opts.command)
    ) {
      console.error(
        "使い方: node scripts/maintenance/kb-backfill.js <plan|download|parse|load|status> --from=YYYY-MM-DD [--to=YYYY-MM-DD] [オプション]\n詳細はファイル冒頭のコメントを参照",
      );
      return 1;
    }
    validateOptions(opts);
    if (opts.command === "plan") opts.dryRun = true;
    if (opts.command === "plan" || opts.command === "download")
      return await cmdDownload(opts);
    if (opts.command === "parse") return await cmdParse(opts);
    if (opts.command === "load") return await cmdLoad(opts);
    return cmdStatus(opts);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    return 1;
  }
}

export const _internal = {
  parseArgs,
  validateOptions,
  parsedPath,
  rawPath,
  readParsedDay,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
