/**
 * motor-pretest-backfill.js の、対象の会場×日（races の読み）・アーカイブのパス・download（公式のHTML → アーカイブ）・
 * parse（保存したHTML → 中間JSON）。CLI と使い方は motor-pretest-backfill.js の冒頭のコメント。
 * 大きさの線（400行）のため分けた（中身は変えない）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  MOTOR_PRETEST_PARSER_VERSION,
  MOTOR_PRETEST_STATUSES,
  buildMotorPretestUrl,
  parseMotorPretestHtml,
} from "../lib/motorPretestParser.js";
import { addDays } from "../lib/monthlyScheduleParser.js";
import {
  appendJsonl,
  readJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";

/** races の最古の日（2025-12-03）。これより前は、races が無く、会場×日を決められない */
export const BACKFILL_DEFAULT_FROM = "2025-12-03";
export const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

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

/** 保存した生ファイルを読む（マニフェストの sha256 と合わなければ例外） */
function readVerifiedRaw(opts, key, m) {
  const raw = zlib.gunzipSync(fs.readFileSync(rawPath(opts.archiveDir, key)));
  if (m.sha256 && sha256(new Uint8Array(raw)) !== m.sha256)
    throw new Error(`${key}: 生ファイルのsha256がマニフェストと一致しません`);
  return raw;
}

/** 解析できなかったページを anomalies.jsonl とログへ残す */
function recordAnomaly(opts, key, parsed, log) {
  appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
    key,
    status: parsed.status,
    anomalies: parsed.anomalies,
    at: new Date().toISOString(),
  });
  log(`${key} ⚠ ${parsed.status} ${parsed.anomalies.join(" | ")}`);
}

/** 解析結果を中間JSONとして書く */
function writeParsed(opts, out, key, date, parsed) {
  const venueCode = Number(key.slice(0, 2));
  const json = JSON.stringify({
    parserVersion: MOTOR_PRETEST_PARSER_VERSION,
    venueCode,
    date,
    seriesTitle: parsed.seriesTitle,
    rows: parsed.rows,
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
}

/** 1ページを解析する。戻り値は "skipped"（既存）・"anomaly"（解析不能）・"written" */
function parseOneTarget(opts, key, m, date, log) {
  const out = parsedPath(opts.archiveDir, key, opts.plain);
  const stale =
    fs.existsSync(out) && fs.statSync(out).mtimeMs < Date.parse(m.fetchedAt);
  if (!opts.force && !stale && fs.existsSync(out)) return "skipped";
  const raw = readVerifiedRaw(opts, key, m);
  const parsed = parseMotorPretestHtml(raw.toString("utf8"));
  if (parsed.status !== MOTOR_PRETEST_STATUSES.ok) {
    recordAnomaly(opts, key, parsed, log);
    return "anomaly";
  }
  writeParsed(opts, out, key, date, parsed);
  return "written";
}

export async function cmdParse(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const manifest = latestManifestByKey(opts.archiveDir);
  let targets = 0;
  let written = 0;
  let skipped = 0;
  for (const [key, m] of manifest) {
    const date = `${key.slice(3, 7)}-${key.slice(7, 9)}-${key.slice(9, 11)}`;
    if (m.status !== "ok" || date < opts.from || date > opts.to) continue;
    targets++;
    const result = parseOneTarget(opts, key, m, date, log);
    if (result === "written") written++;
    if (result === "skipped") skipped++;
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

export { manifestPath, latestManifestByKey };
