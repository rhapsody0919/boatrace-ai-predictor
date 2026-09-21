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
 *   node --env-file=.env.local scripts/maintenance/motor-pretest-backfill.js load --from=2025-12-03 --to=2026-09-20 --apply  # 書き込み（要承認。マイグレーション088が前提）
 *
 * 終了コード: 0=完了 / 1=エラー・0件 / 2=安全に停止（窓外・日次上限・最大件数。再実行で続きから） / 4=サーキットブレーカー
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MOTOR_PRETEST_PARSER_VERSION,
  MOTOR_PRETEST_STATUSES,
  buildMotorPretestUrl,
  parseMotorPretestHtml,
} from "../lib/motorPretestParser.js";
import {
  MOTOR_PRETEST_TABLE,
  buildMotorPretestRows,
  writeMotorPretestRows,
} from "../lib/motorPretestRows.js";
import { addDays } from "../lib/monthlyScheduleParser.js";
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

/** races の最古の日（2025-12-03）。これより前は、races が無く、会場×日を決められない */
export const BACKFILL_DEFAULT_FROM = "2025-12-03";
export const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const jstToday = (now = new Date()) =>
  new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);

export function parseArgs(argv, now = new Date()) {
  const [command, ...rest] = argv;
  const opts = {
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
      case "scope":
        opts.scope = v;
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

// ---------------------------------------------------------------------------
// 対象の会場×日（純関数）
// ---------------------------------------------------------------------------

export const itemKey = (venueCode, date) =>
  `${String(venueCode).padStart(2, "0")}-${date.replaceAll("-", "")}`;

/**
 * 開催のある会場×日から、取得する項目を作る。
 *
 * @param {Array<{venue_code: number, race_date: string}>} venueDays 開催のある会場×日（from の前日から to まで。前日は初日の判定用）
 * @param {{from: string, to: string, scope: "first-days"|"all-days"}} range
 * @returns {Array<{key: string, url: string, venueCode: number, date: string, firstDay: boolean}>}
 */
export function buildItems(venueDays, { from, to, scope }) {
  const held = new Set(venueDays.map((d) => `${d.venue_code}|${d.race_date}`));
  return venueDays
    .filter((d) => d.race_date >= from && d.race_date <= to)
    .map((d) => ({
      venueCode: d.venue_code,
      date: d.race_date,
      // races の最初の日は、前日のデータが無いため、全会場を初日とみなす（節の途中でも、ページには節の前検タイムが載る）。
      // それ以外は、前日に同じ会場の開催が無い会場×日（from の前日も読んでいるため、from の日も正しく判定できる）
      firstDay:
        d.race_date === BACKFILL_DEFAULT_FROM ||
        !held.has(`${d.venue_code}|${addDays(d.race_date, -1)}`),
    }))
    .filter((d) => scope === "all-days" || d.firstDay)
    .sort((a, b) =>
      a.date === b.date ? a.venueCode - b.venueCode : a.date < b.date ? -1 : 1,
    )
    .map((d) => ({
      key: itemKey(d.venueCode, d.date),
      url: buildMotorPretestUrl(d.venueCode, d.date),
      ...d,
    }));
}

/** DBの races から、開催のある会場×日を読む（読み取りのみ。各会場×日の1レース目のみを見る） */
export async function loadVenueDays(client, from, to) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client
      .from("races")
      .select("venue_code, race_date")
      .eq("race_number", 1)
      .gte("race_date", addDays(from, -1))
      .lt("race_date", addDays(to, 1))
      .order("race_date")
      .order("venue_code")
      .range(offset, offset + 999);
    if (error) throw new Error(`racesの取得に失敗しました: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// アーカイブ
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
export const rawPath = (dir, key) =>
  path.join(dir, "raw", key.slice(3, 9), `${key}.html.gz`);
export const parsedPath = (dir, key, plain) =>
  path.join(dir, "parsed", key.slice(3, 9), `${key}.json${plain ? "" : ".gz"}`);

function latestManifestByKey(dir) {
  const map = new Map();
  for (const e of readJsonl(manifestPath(dir))) map.set(e.key, e);
  return map;
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

/** 取得したHTMLの検査。要求した会場・日付の表が読めなければ例外（3回連続で、サーキットブレーカーが止める） */
export function validateHtml(bytes, item) {
  const parsed = parseMotorPretestHtml(new TextDecoder("utf-8").decode(bytes));
  if (parsed.status === MOTOR_PRETEST_STATUSES.noData)
    throw new Error("データがありません（開催のある会場×日のはず）");
  if (parsed.status !== MOTOR_PRETEST_STATUSES.ok)
    throw new Error(
      `構造を認識できません: ${parsed.anomalies.slice(0, 3).join(" | ")}`,
    );
  if (
    (parsed.venueCode !== null && parsed.venueCode !== item.venueCode) ||
    (parsed.date !== null && parsed.date !== item.date)
  )
    throw new Error(
      `別のページです（会場${parsed.venueCode}・${parsed.date}。要求: 会場${item.venueCode}・${item.date}）`,
    );
  return { status: "ok" };
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

export async function cmdDownload(opts, deps = {}) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  if (!client) {
    console.error(
      "Supabaseに接続できません（--env-file=.env.local が要ります。対象の会場×日を races から決めるため）",
    );
    return 1;
  }
  const venueDays = await loadVenueDays(client, opts.from, opts.to);
  const items = buildItems(venueDays, opts);
  const all = buildItems(venueDays, { ...opts, scope: "all-days" });
  (deps.log ?? console.log)(
    `対象の会場×日: 全${all.length}件、うち節の初日 ${all.filter((i) => i.firstDay).length}件（--scope=${opts.scope} は ${items.length}件）`,
  );
  return runArchiveDownload({
    items,
    manifestFile: manifestPath(opts.archiveDir),
    runsFile: path.join(opts.archiveDir, "runs.jsonl"),
    userAgent: USER_AGENT,
    opts,
    deps,
    validate: async (bytes, item) => validateHtml(bytes, item),
    save: (item, bytes) => {
      const file = rawPath(opts.archiveDir, item.key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, zlib.gzipSync(bytes));
      return path.relative(opts.archiveDir, file);
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
  for (const [key, m] of manifest) {
    const venueCode = Number(key.slice(0, 2));
    const date = `${key.slice(3, 7)}-${key.slice(7, 9)}-${key.slice(9, 11)}`;
    if (m.status !== "ok" || date < opts.from || date > opts.to) continue;
    targets++;
    const out = parsedPath(opts.archiveDir, key, opts.plain);
    const stale =
      fs.existsSync(out) && fs.statSync(out).mtimeMs < Date.parse(m.fetchedAt);
    if (!opts.force && !stale && fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const raw = zlib.gunzipSync(fs.readFileSync(rawPath(opts.archiveDir, key)));
    if (m.sha256 && sha256(new Uint8Array(raw)) !== m.sha256)
      throw new Error(`${key}: 生ファイルのsha256がマニフェストと一致しません`);
    const parsed = parseMotorPretestHtml(raw.toString("utf8"));
    if (parsed.status !== MOTOR_PRETEST_STATUSES.ok) {
      appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
        key,
        status: parsed.status,
        anomalies: parsed.anomalies,
        at: new Date().toISOString(),
      });
      log(`${key} ⚠ ${parsed.status} ${parsed.anomalies.join(" | ")}`);
      continue;
    }
    const json = JSON.stringify({
      parserVersion: MOTOR_PRETEST_PARSER_VERSION,
      venueCode,
      date,
      seriesTitle: parsed.seriesTitle,
      rows: parsed.rows,
    });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
    written++;
  }
  log(`parse: 対象 ${targets} / 出力 ${written} / 既存スキップ ${skipped}`);
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

export async function cmdLoad(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const sleepFn = deps.sleep ?? sleepDefault;
  const plan = buildLoadPlan(opts);
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
  if (!opts.apply) {
    log(
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（マイグレーション088の適用と、ユーザーの実行承認が前提）",
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
  const probe = await client
    .from(MOTOR_PRETEST_TABLE.table)
    .select("race_date")
    .limit(1);
  if (probe.error) {
    console.error(
      `${MOTOR_PRETEST_TABLE.table} を読めません（マイグレーション088が未適用の可能性）: ${probe.error.message}`,
    );
    return 1;
  }
  // 日付ごとに書く（既存行の取得を、日付単位で行うため）。変更の無い行は書かない
  const byDate = new Map();
  for (const row of plan.rows) {
    if (!byDate.has(row.race_date)) byDate.set(row.race_date, []);
    byDate.get(row.race_date).push(row);
  }
  let written = 0;
  let failedDates = 0;
  const write = deps.write ?? writeMotorPretestRows;
  for (const [date, rows] of [...byDate.entries()].sort()) {
    try {
      written += await write(client, rows);
    } catch (error) {
      failedDates++;
      console.error(`${date}: 書き込みに失敗: ${error.message}`);
    }
    await sleepFn(opts.sleepMs);
  }
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
