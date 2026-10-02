#!/usr/bin/env node
/**
 * 月間スケジュール（節メタ: 節名・グレード・種別・開始日・終了日・総日数）の取得・解析・投入CLI
 *
 * 設計: docs/design/racer-period-stats/plan.md（全データ設計 N16、ユーザー承認Q3）
 * kb-backfill.js・fan-backfill.js と同じ構成（取得・解析・投入を別ステップに分離）:
 *   plan      download の見積り（リクエスト数・所要夜数）。ネットワーク・書き込みなし
 *   download  公式の月間スケジュール（race/monthlyschedule?ym=YYYYMM）のHTMLを、アーカイブへ保存する（1か月=1リクエスト）
 *   parse     保存したHTML → 全項目の中間JSON（monthly-schedule/v1）。ネットワーク・DB不要
 *   load      隣の月と突き合わせて節を確定し、race_series へ。既定は検証のみ。--apply が無ければ書き込まない
 *   status    取得・解析の状況
 *
 * 月の範囲の扱い: 表の端に接する節は、隣の月のページと突き合わせて開始日・終了日を確定する。そのため
 * load の範囲（--from〜--to）に対し、前後1か月の解析済みのページが必要（無ければ、理由を出して停止する）。
 * 例: 2019-04〜2026-09 を投入するなら、201903〜202610 を download・parse する（92リクエスト）。
 *
 * 使用例:
 *   node scripts/maintenance/monthly-schedule-backfill.js plan --from=201903 --to=202610
 *   node scripts/maintenance/monthly-schedule-backfill.js download --from=201903 --to=202610
 *   node scripts/maintenance/monthly-schedule-backfill.js parse --from=201903 --to=202610
 *   node --env-file=.env.local scripts/maintenance/monthly-schedule-backfill.js load --from=201904 --to=202609          # 検証のみ
 *   node --env-file=.env.local scripts/maintenance/monthly-schedule-backfill.js load --from=201904 --to=202609 --apply  # 書き込み（要承認）
 *   （当月・翌月の更新）download --from=当月 --to=翌月 --refresh
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止 / 4=サーキットブレーカー
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MS_USER_AGENT,
  MS_EARLIEST_YM,
  buildMonthlyScheduleUrl,
  listYms,
  parseYm,
  parseMonthlySchedule,
  summarizeMonthlySchedule,
} from "../lib/monthlyScheduleParser.js";
import {
  planRaceSeriesRows,
  shiftYm,
  ymOf,
  writeRaceSeriesRows,
} from "../lib/raceSeriesSync.js";
import {
  HARD_MIN_INTERVAL_MS,
  appendJsonl,
  readJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const jstMonth = (now = new Date()) =>
  ymOf(new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10));

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  const opts = {
    command,
    from: MS_EARLIEST_YM,
    to: shiftYm(jstMonth(now), 1),
    archiveDir: path.join(REPO_ROOT, "data/monthly-schedule-archive"),
    dailyLimit: 200,
    window: "22-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 10000,
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    refresh: false,
    plain: false,
    batchSize: 200,
    sleepMs: 500,
    expectedVenues: 24, // 月間スケジュールの会場数（全24会場）。これと異なれば構造の変更とみなす
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
      case "refresh":
        opts.refresh = true;
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
  parseYm(opts.from);
  parseYm(opts.to);
  if (opts.from > opts.to) throw new Error("--from は --to 以前にしてください");
  if (opts.from < MS_EARLIEST_YM)
    throw new Error(
      `--from は ${MS_EARLIEST_YM} 以降にしてください（公式の選択肢の最古）`,
    );
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
// アーカイブ
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
export const rawPath = (dir, ym) => path.join(dir, "raw", `${ym}.html.gz`);
export const parsedPath = (dir, ym, plain) =>
  path.join(dir, "parsed", `${ym}.json${plain ? "" : ".gz"}`);

function latestManifestByKey(dir) {
  const map = new Map();
  for (const e of readJsonl(manifestPath(dir))) map.set(e.key, e);
  return map;
}

export function readParsedMonth(dir, ym) {
  for (const plain of [false, true]) {
    const file = parsedPath(dir, ym, plain);
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

export async function cmdDownload(opts, deps = {}) {
  const items = listYms(opts.from, opts.to).map((ym) => ({
    key: ym,
    url: buildMonthlyScheduleUrl(ym),
  }));
  return runArchiveDownload({
    items,
    manifestFile: manifestPath(opts.archiveDir),
    runsFile: path.join(opts.archiveDir, "runs.jsonl"),
    userAgent: MS_USER_AGENT,
    opts,
    deps,
    validate: async (bytes, item) => {
      const html = new TextDecoder("utf-8").decode(bytes);
      const page = parseMonthlySchedule(html, item.key); // 構造の変更は例外
      if (page.venues.length !== opts.expectedVenues)
        throw new Error(
          `会場が${page.venues.length}件です（${opts.expectedVenues}件のはず。構造の変更の疑い）`,
        );
      if (page.anomalies.length > 0)
        throw new Error(
          `要確認 ${page.anomalies.length}件: ${page.anomalies[0].problem}`,
        );
      return { status: "ok" };
    },
    save: (item, bytes) => {
      const file = rawPath(opts.archiveDir, item.key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, zlib.gzipSync(bytes));
      return `raw/${item.key}.html.gz`;
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
  for (const ym of listYms(opts.from, opts.to)) {
    const m = manifest.get(ym);
    if (m?.status !== "ok") continue;
    targets++;
    const out = parsedPath(opts.archiveDir, ym, opts.plain);
    // refresh で取り直した月は、マニフェストの取得時刻が解析結果より新しい
    const stale =
      fs.existsSync(out) && fs.statSync(out).mtimeMs < Date.parse(m.fetchedAt);
    if (!opts.force && !stale && fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const gz = fs.readFileSync(rawPath(opts.archiveDir, ym));
    if (m.sha256 && sha256(new Uint8Array(zlib.gunzipSync(gz))) !== m.sha256)
      throw new Error(`${ym}: 生ファイルのsha256がマニフェストと一致しません`);
    const page = parseMonthlySchedule(zlib.gunzipSync(gz).toString("utf8"), ym);
    const s = summarizeMonthlySchedule(page);
    if (page.anomalies.length > 0)
      appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
        ym,
        anomalies: page.anomalies,
        at: new Date().toISOString(),
      });
    const json = JSON.stringify(page);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
    written++;
    log(
      `${ym} 会場${s.venues} 節の断片${s.segments} 窓${s.window.from}〜${s.window.to} ${s.anomalies ? `⚠ 要確認${s.anomalies}` : "ok"}`,
    );
  }
  log(
    `\nparse: 対象 ${targets}か月 / 出力 ${written} / 既存スキップ ${skipped}`,
  );
  if (targets === 0) {
    console.error(
      "解析対象の生ファイルがありません（先に download を実行してください）",
    );
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * load の範囲（--from〜--to の月に開始日がある節）の、節の行を作る。前後1か月の解析済みページが必要。
 * @returns {{rows: object[], unresolved: object[], anomalies: object[], missingMonths: string[]}}
 */
export function buildLoadPlan(opts) {
  const need = listYms(shiftYm(opts.from, -1), shiftYm(opts.to, 1));
  const pages = [];
  const missingMonths = [];
  for (const ym of need) {
    const p = readParsedMonth(opts.archiveDir, ym);
    if (p) pages.push(p);
    else missingMonths.push(ym);
  }
  if (missingMonths.length > 0)
    return { rows: [], unresolved: [], anomalies: [], missingMonths };
  return { ...planRaceSeriesRows(pages, opts.from, opts.to), missingMonths };
}

export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const plan = buildLoadPlan(opts);
  if (plan.missingMonths.length > 0) {
    console.error(
      `節を確定するには前後1か月のページが必要です。解析済みでない月: ${plan.missingMonths.join(", ")}（download → parse を先に実行してください）`,
    );
    return 1;
  }
  for (const a of plan.anomalies)
    console.warn(`  ⚠ 会場${a.venue_code}: ${a.problem}`);
  for (const u of plan.unresolved)
    console.warn(
      `  ⚠ 確定できない節: 会場${u.venue_code} ${u.seen_from}〜${u.seen_to}（${u.reason}）`,
    );
  log(
    `投入対象: ${plan.rows.length}節 / 確定できない節 ${plan.unresolved.length} / 要確認 ${plan.anomalies.length}`,
  );
  if (plan.rows.length === 0) {
    console.error("投入対象の節が0件です");
    return 1;
  }
  if (plan.anomalies.length > 0 || plan.unresolved.length > 0) {
    console.error(
      "要確認・確定できない節があるため、投入しません（原因を確認してください）",
    );
    return 1;
  }
  if (!opts.apply) {
    log(
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（DDL 084 の適用と、ユーザーの実行承認が前提）",
    );
    return 0;
  }
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  let summary;
  try {
    summary = await writeRaceSeriesRows(client, plan.rows, {
      batchSize: opts.batchSize,
      sleepMs: opts.sleepMs,
      sleep: sleepFn,
    });
  } catch (e) {
    console.error(e.message);
    return 1;
  }
  for (const e of summary.errors) console.error(e);
  log(`\nload: ${JSON.stringify(summary)}`);
  if (summary.failedMonths > 0) return 1;
  if (summary.written + summary.unchanged === 0) {
    console.error("書き込みも変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
}

export function cmdStatus(opts) {
  const manifest = latestManifestByKey(opts.archiveDir);
  const c = { months: 0, download: {}, parsed: 0 };
  for (const ym of listYms(opts.from, opts.to)) {
    c.months++;
    const s = manifest.get(ym)?.status ?? "none";
    c.download[s] = (c.download[s] ?? 0) + 1;
    if (readParsedMonth(opts.archiveDir, ym)) c.parsed++;
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
        "使い方: node scripts/maintenance/monthly-schedule-backfill.js <plan|download|parse|load|status> [--from=YYYYMM] [--to=YYYYMM] [オプション]\n詳細はファイル冒頭のコメントを参照",
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

export const _internal = { shiftYm, jstMonth };

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
