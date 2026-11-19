#!/usr/bin/env node
/**
 * 前検タイム・節時点のモーター/ボート2連対率（N23、motor_pretest_stats）の過去分の取得・解析・投入CLI
 *
 * 設計: docs/design/scraping-vercel-consolidation/（plan.md §15、tasks.md T4b-20、optimal-scraping-design.md §4.2 順序5）
 * fan-backfill.js・monthly-schedule-backfill.js と同じ構成（取得・解析・投入を別ステップに分離。取り直しをしない設計）:
 *   plan      download の見積り（リクエスト数・所要夜数）。ネットワーク・書き込みなし（= download --dry-run）。
 *             対象の会場×日は、DBの races（読み取りのみ）から作る（--env-file=.env.local が要る）
 *   download  公式の race/rankingmotor?jcd&hd のHTMLを、アーカイブへ保存する（1会場×1日=1リクエスト）
 *   parse     保存したHTML → 中間JSON。ネットワーク・DB不要。何度でも再実行できる
 *   load      中間JSON → motor_pretest_stats。既定は検証のみ。--apply が無ければ書き込まない
 *   status    取得・解析の状況
 *
 * 取得ロジックは日次ジョブ（scripts/lib/motorPretestJob.js）と共有する: URL・パーサー・行の組み立て・書き込み
 * （scripts/lib/motorPretestParser.js・motorPretestRows.js）。取得ループ（間隔・窓・日次上限・サーキットブレーカー・
 * マニフェスト）は、fan・月間スケジュールと共通の scripts/lib/archiveDownloader.js。二重実装しない。
 *
 * 対象範囲（--scope）:
 *   first-days  節の初日のみ（既定）。前検タイムは節の間は変わらないため、初日のページ1枚で足りる。初日は、DBの races で、
 *               前日に同じ会場の開催が無い会場×日（races の最初の日 2025-12-03 は、全会場を初日とみなす。節の途中でも、
 *               ページには節の前検タイムが載る）。行の日付は、その節の初日になる（as-of 結合は、選手・会場ごとの直近の行を引く）
 *   all-days    開催のある会場×日の全て。2連対率の日次の履歴も揃う（リクエストは約5倍）
 *
 * 取得先への負荷（ADR-0067）: 逐次（同時接続1）・3秒以上のジッター付き間隔・夜間窓（既定 JST 00-06。オッズの運用窓
 * 07:00〜23:59 の外）・日次上限（既定1,500）・サーキットブレーカー（403は2回、429・503・5xx・接続失敗は3回連続で停止）。
 * User-Agent は BoatraceAIBot/1.0。
 *
 * 使用例:
 *   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js plan --from=2025-12-03 --to=2026-09-20
 *   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js download --from=2025-12-03 --to=2026-09-20   # 要承認（夜間に実行）
 *   node scripts/maintenance/motor-pretest-backfill.js parse --from=2025-12-03 --to=2026-09-20
 *   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js load --from=2025-12-03 --to=2026-09-20          # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js load --from=2025-12-03 --to=2026-09-20 --apply  # 書き込み（要承認。マイグレーション090が前提）
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） / 4=サーキットブレーカー
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MOTOR_PRETEST_PARSER_VERSION } from "../lib/motorPretestParser.js";
import {
  MOTOR_PRETEST_TABLE,
  buildMotorPretestRows,
  writeMotorPretestRows,
} from "../lib/motorPretestRows.js";
import { addDays } from "../lib/monthlyScheduleParser.js";
import { HARD_MIN_INTERVAL_MS } from "../lib/archiveDownloader.js";
import {
  BACKFILL_DEFAULT_FROM,
  cmdDownload,
  cmdParse,
  latestManifestByKey,
  parsedPath,
} from "./motor-pretest-backfill-fetch.js";

// 対象の会場×日・アーカイブのパス・download・parse は motor-pretest-backfill-fetch.js（大きさの線のため分けた）
export {
  BACKFILL_DEFAULT_FROM,
  USER_AGENT,
  buildItems,
  cmdDownload,
  cmdParse,
  itemKey,
  loadVenueDays,
  parsedPath,
  rawPath,
  validateHtml,
} from "./motor-pretest-backfill-fetch.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const jstToday = (now = new Date()) =>
  new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

/** 値を取る文字列のオプション（--名前=値 → opts のキー） */
const STRING_OPTIONS = new Map([
  ["from", "from"],
  ["to", "to"],
  ["scope", "scope"],
  ["window", "window"],
]);
/** 値を Number に変えて取るオプション */
const NUMBER_OPTIONS = new Map([
  ["daily-limit", "dailyLimit"],
  ["interval-min-ms", "intervalMinMs"],
  ["interval-max-ms", "intervalMaxMs"],
  ["assumed-latency-ms", "latencyMs"],
  ["max-requests", "maxRequests"],
  ["sleep-ms", "sleepMs"],
]);
/** 値を取らない旗のオプション（付ければ true） */
const FLAG_OPTIONS = new Map([
  ["dry-run", "dryRun"],
  ["apply", "apply"],
  ["force", "force"],
  ["refresh", "refresh"],
  ["plain", "plain"],
]);

function defaultOptions(command, now) {
  return {
    command,
    from: BACKFILL_DEFAULT_FROM,
    to: addDays(jstToday(now), -1),
    scope: "first-days",
    archiveDir: path.join(REPO_ROOT, "data/motor-pretest-archive"),
    dailyLimit: 1500,
    window: "00-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 10000,
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    refresh: false,
    plain: false,
    sleepMs: 500,
  };
}

function applyOption(opts, arg, k, v) {
  if (STRING_OPTIONS.has(k)) opts[STRING_OPTIONS.get(k)] = v;
  else if (k === "archive-dir") opts.archiveDir = path.resolve(v);
  else if (NUMBER_OPTIONS.has(k)) opts[NUMBER_OPTIONS.get(k)] = Number(v);
  else if (FLAG_OPTIONS.has(k)) opts[FLAG_OPTIONS.get(k)] = true;
  else throw new Error(`不明なオプション: ${arg}`);
}

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  const opts = defaultOptions(command, now);
  for (const arg of rest) {
    const [k, v] = arg.startsWith("--")
      ? arg.slice(2).split("=")
      : [arg, undefined];
    applyOption(opts, arg, k, v);
  }
  return opts;
}

export function validateOptions(opts) {
  for (const key of ["from", "to"]) {
    if (!DATE_RE.test(String(opts[key]))) {
      throw new Error(
        `--${key} は YYYY-MM-DD で指定してください: ${opts[key]}`,
      );
    }
  }
  if (opts.from > opts.to) throw new Error("--from は --to 以前にしてください");
  if (opts.from < BACKFILL_DEFAULT_FROM) {
    throw new Error(
      `--from は ${BACKFILL_DEFAULT_FROM} 以降にしてください（races の最古。それより前は会場×日を決められません）`,
    );
  }
  if (!["first-days", "all-days"].includes(opts.scope)) {
    throw new Error(
      `--scope は first-days か all-days です: ${String(opts.scope)}`,
    );
  }
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

export function readParsed(dir, key) {
  for (const plain of [false, true]) {
    const file = parsedPath(dir, key, plain);
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
// load
// ---------------------------------------------------------------------------

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析済みの中間JSONから、範囲内の投入行を作る（純粋な読み込み。DB・ネットワークなし） */
export function buildLoadPlan(opts) {
  const manifest = latestManifestByKey(opts.archiveDir);
  const rows = [];
  const missingParsed = [];
  let pages = 0;
  for (const [key, m] of manifest) {
    const date = `${key.slice(3, 7)}-${key.slice(7, 9)}-${key.slice(9, 11)}`;
    if (m.status !== "ok" || date < opts.from || date > opts.to) continue;
    const parsed = readParsed(opts.archiveDir, key);
    if (!parsed) {
      missingParsed.push(key);
      continue;
    }
    if (parsed.parserVersion !== MOTOR_PRETEST_PARSER_VERSION)
      throw new Error(`${key}: 未対応のパーサー版 ${parsed.parserVersion}`);
    pages++;
    rows.push(
      ...buildMotorPretestRows({
        venueCode: parsed.venueCode,
        date: parsed.date,
        parsed,
      }),
    );
  }
  return { rows, pages, missingParsed };
}

/**
 * 投入計画の検査とログ。続行できないとき（未解析・0行）は終了コード 1、続行するなら null
 */
function checkLoadPlan(plan, log) {
  if (plan.missingParsed.length > 0) {
    console.error(
      `解析済みでないページがあります（${plan.missingParsed.length}件。先に parse を実行してください）: ${plan.missingParsed.slice(0, 3).join(", ")}…`,
    );
    return 1;
  }
  const filled = plan.rows.filter((r) => r.pretest_time !== null).length;
  log(
    `投入対象: ${plan.pages}ページ・${plan.rows.length}行（前検タイムあり ${filled}行）`,
  );
  if (plan.rows.length === 0) {
    console.error("投入対象の行が0件です");
    return 1;
  }
  return null;
}

/** 書き込み先のテーブルを読めるか確かめる。読めなければ終了コード 1、読めれば null */
async function probeLoadTable(client) {
  const probe = await client
    .from(MOTOR_PRETEST_TABLE.table)
    .select("race_date")
    .limit(1);
  if (!probe.error) return null;
  console.error(
    `${MOTOR_PRETEST_TABLE.table} を読めません（マイグレーション090が未適用の可能性）: ${probe.error.message}`,
  );
  return 1;
}

/** 日付ごとに書く（既存行の取得を、日付単位で行うため）。変更の無い行は書かない */
function groupRowsByDate(rows) {
  const byDate = new Map();
  for (const row of rows) {
    if (!byDate.has(row.race_date)) byDate.set(row.race_date, []);
    byDate.get(row.race_date).push(row);
  }
  return byDate;
}

/** 日付ごとに書き、書いた行数と失敗した日数を返す（1日の失敗は止めない） */
async function writeByDate(client, byDate, write, sleepFn, sleepMs) {
  let written = 0;
  let failedDates = 0;
  for (const [date, rows] of [...byDate.entries()].sort()) {
    try {
      written += await write(client, rows);
    } catch (error) {
      failedDates++;
      console.error(`${date}: 書き込みに失敗: ${error.message}`);
    }
    await sleepFn(sleepMs);
  }
  return { written, failedDates };
}

export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const plan = buildLoadPlan(opts);
  const planCode = checkLoadPlan(plan, log);
  if (planCode !== null) return planCode;
  if (!opts.apply) {
    log(
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（マイグレーション090の適用と、ユーザーの実行承認が前提）",
    );
    return 0;
  }
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  if (!client) {
    console.error(
      "Supabaseに接続できません（--env-file=.env.local が要ります）",
    );
    return 1;
  }
  const probeCode = await probeLoadTable(client);
  if (probeCode !== null) return probeCode;
  const byDate = groupRowsByDate(plan.rows);
  const write = deps.write ?? writeMotorPretestRows;
  const { written, failedDates } = await writeByDate(
    client,
    byDate,
    write,
    sleepFn,
    opts.sleepMs,
  );
  log(
    `\nload: ${JSON.stringify({ dates: byDate.size, written, failedDates })}`,
  );
  return failedDates > 0 ? 1 : 0;
}

export function cmdStatus(opts) {
  const manifest = latestManifestByKey(opts.archiveDir);
  const c = { pages: 0, download: {}, parsed: 0 };
  for (const [key, m] of manifest) {
    const date = `${key.slice(3, 7)}-${key.slice(7, 9)}-${key.slice(9, 11)}`;
    if (date < opts.from || date > opts.to) continue;
    c.pages++;
    c.download[m.status] = (c.download[m.status] ?? 0) + 1;
    if (readParsed(opts.archiveDir, key)) c.parsed++;
  }
  console.log(JSON.stringify(c, null, 2));
  return 0;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (
      !["plan", "download", "parse", "load", "status"].includes(opts.command)
    ) {
      console.error(
        "使い方: node scripts/maintenance/motor-pretest-backfill.js <plan|download|parse|load|status> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--scope=first-days|all-days] [オプション]\n詳細はファイル冒頭のコメントを参照",
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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
