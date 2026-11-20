/**
 * kb-backfill.js の parse（生LZH → 中間JSON）・load（中間JSON → kb_archive_*）・status と、jsonl の追記・待ち・sha256・download の終わりの記録。
 * CLI と使い方は kb-backfill.js の冒頭のコメント。大きさの線（400行）のため分けた（中身は変えない）
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import {
  KB_SCHEMA,
  decodeLzhText,
  buildKbDay,
  summarizeKbDay,
} from "../lib/kbFileParser.js";
import { buildArchiveRows, KB_ARCHIVE_TABLES } from "../lib/kbArchiveRows.js";
import { MAIN_TABLES_START } from "../lib/kbArchiveBoundary.js";
import {
  dateRange,
  latestManifest,
  manifestPath,
  rawPath,
  parsedPath,
  readJsonl,
} from "./kb-backfill-parts.js";

const appendJsonl = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** 全件の処理後: 完了を記録して終了コードを返す */
function finishDownload(c) {
  const { stats } = c;
  console.log(`\n完了: ${JSON.stringify(stats)}`);
  appendJsonl(path.join(c.opts.archiveDir, "runs.jsonl"), {
    runId: c.runId,
    completed: true,
    stats,
  });
  // 0件取得のまま「成功」にしない: 未取得があったのに1件も保存できていなければ異常
  if (stats.requests > 0 && stats.ok + stats.absent + stats.skipped === 0)
    return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/** 生ファイル1つ（K か B）を読んで展開する。マニフェストが ok でなければ null */
async function readRawSource(opts, date, kind, m) {
  if (m?.status !== "ok") return null;
  const bytes = new Uint8Array(
    fs.readFileSync(rawPath(opts.archiveDir, kind, date)),
  );
  // 生ファイルの破損・差し替えを、マニフェストのsha256で検知する
  if (m.sha256 && sha256(bytes) !== m.sha256)
    throw new Error(
      `${date} ${kind}: 生ファイルのsha256がマニフェストと一致しません`,
    );
  return {
    text: await decodeLzhText(bytes),
    source: {
      file: m.file,
      sha256: m.sha256,
      bytes: m.bytes,
      fetchedAt: m.fetchedAt,
    },
  };
}

/** 解析結果の要約から、要確認の点を文にして返す */
function findDayProblems(day, s) {
  const problems = [];
  if (s.k_unparsed_lines > 0) problems.push(`K未解析行${s.k_unparsed_lines}`);
  if (s.k_extra_lines > 0) problems.push(`K付随行${s.k_extra_lines}`);
  if (s.b_extra_lines > 0) problems.push(`B付随行${s.b_extra_lines}`);
  if (day.k && day.b && s.k_races !== s.b_races)
    problems.push(`レース数不一致 K${s.k_races}/B${s.b_races}`);
  if (day.b && s.b_entries !== s.b_races * 6)
    problems.push(`B艇数 ${s.b_entries} != レース数×6`);
  if (day.k && s.k_boat_rows !== s.k_races * 6)
    problems.push(`K艇数 ${s.k_boat_rows} != レース数×6`);
  return problems;
}

/** 1日ぶんを解析して中間JSONへ書く。tally（written・anomalies）を更新する */
async function parseOneDay(opts, date, k, b, out, tally) {
  const [kr, br] = [
    await readRawSource(opts, date, "K", k),
    await readRawSource(opts, date, "B", b),
  ];
  const day = buildKbDay({
    date,
    kText: kr?.text ?? null,
    bText: br?.text ?? null,
    source: { K: kr?.source ?? null, B: br?.source ?? null },
  });
  const s = summarizeKbDay(day);
  const problems = findDayProblems(day, s);
  if (problems.length) {
    tally.anomalies.push({ date, problems });
    appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
      date,
      problems,
      at: new Date().toISOString(),
    });
  }
  const json = JSON.stringify(day);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
  tally.written++;
  console.log(
    `${date} K${s.k_races}R/B${s.b_races}R ${problems.length ? `⚠ ${problems.join(" / ")}` : "ok"}`,
  );
}

/** parse の集計行を出し、終了コードを返す */
function reportParse({ targets, written, skipped, anomalies }) {
  console.log(
    `\nparse: 対象 ${targets}日 / 出力 ${written} / 既存スキップ ${skipped} / 要確認 ${anomalies.length}`,
  );
  if (targets > 0 && written + skipped === 0) return 1;
  if (targets === 0) {
    console.error(
      "解析対象の生ファイルがありません（先に download を実行してください）",
    );
    return 1;
  }
  return 0;
}

async function cmdParse(opts) {
  const manifest = latestManifest(readJsonl(manifestPath(opts.archiveDir)));
  const tally = { targets: 0, written: 0, skipped: 0, anomalies: [] };
  for (const date of dateRange(opts.from, opts.to)) {
    const k = manifest.get(`${date}|K`);
    const b = manifest.get(`${date}|B`);
    if (k?.status !== "ok" && b?.status !== "ok") continue;
    tally.targets++;
    const out = parsedPath(opts.archiveDir, date, opts.plain);
    if (!opts.force && fs.existsSync(out)) {
      tally.skipped++;
      continue;
    }
    await parseOneDay(opts, date, k, b, out, tally);
  }
  return reportParse(tally);
}

function readParsedDay(dir, date) {
  for (const plain of [false, true]) {
    const file = parsedPath(dir, date, plain);
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

/** 中間JSONを全期間なめて、投入対象の日と件数の集計を返す。警告は都度出す */
function scanParsedDays(opts) {
  const totals = { days: 0, venueDays: 0, races: 0, boats: 0, warnings: 0 };
  // 全期間の行をメモリに溜めない（約200万艇になる）。集計は行を捨てて数えるだけにし、書き込み時に日ごとに再構築する
  const dates = [];
  for (const date of dateRange(opts.from, opts.to)) {
    const day = readParsedDay(opts.archiveDir, date);
    if (!day) continue;
    if (day.schema !== KB_SCHEMA)
      throw new Error(`${date}: 未対応のスキーマ ${day.schema}`);
    const rows = buildArchiveRows(day);
    totals.days++;
    totals.venueDays += rows.venueDays.length;
    totals.races += rows.races.length;
    totals.boats += rows.boats.length;
    totals.warnings += rows.warnings.length;
    for (const w of rows.warnings) console.warn(`  ⚠ ${w}`);
    dates.push(date);
  }
  return { totals, dates };
}

const chunk = (arr, n) =>
  Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
    arr.slice(i * n, i * n + n),
  );

/** 1表ぶんの行を perStmt 行ずつの文で書く。失敗した文があれば true */
async function putRows(opts, db, summary, spec, list, perStmt) {
  let failed = false;
  for (const part of chunk(list, perStmt)) {
    const r = await db.upsertChangedRows(db.supabase, spec.table, part, {
      onConflict: spec.onConflict,
      keyColumns: spec.keyColumns,
      chunkColumn: spec.chunkColumn,
      batchSize: opts.batchSize,
    });
    summary.written += r.written;
    summary.unchanged += r.skipped;
    if (r.error) failed = true;
    await sleep(opts.sleepMs); // 文の間隔（Disk IO Budgetへの配慮）
  }
  return failed;
}

/** 1日ぶんを3表へ書く。全部成功したら loaded に記録する */
async function loadOneDay(opts, db, summary, date, loadedFile) {
  const rows = buildArchiveRows(readParsedDay(opts.archiveDir, date));
  const venueFailed = await putRows(
    opts,
    db,
    summary,
    KB_ARCHIVE_TABLES.venueDays,
    rows.venueDays,
    opts.batchSize,
  );
  const raceFailed = await putRows(
    opts,
    db,
    summary,
    KB_ARCHIVE_TABLES.races,
    rows.races,
    opts.batchSize,
  );
  const boatFailed = await putRows(
    opts,
    db,
    summary,
    KB_ARCHIVE_TABLES.boats,
    rows.boats,
    opts.batchSize,
  ); // 200行/文（1レース6行のため33レースずつ）
  if (venueFailed || raceFailed || boatFailed) {
    summary.failedDays++;
    console.error(
      `${date}: 書き込みに失敗した文があります。loaded に記録しません（再実行で再試行されます）`,
    );
    return;
  }
  appendJsonl(loadedFile, {
    date,
    at: new Date().toISOString(),
    races: rows.races.length,
    boats: rows.boats.length,
  });
}

/** load の集計行と注意を出し、終了コードを返す */
function reportLoad(summary, processedDays, dates, totals) {
  console.log(
    `\nload: ${JSON.stringify(summary)}（処理 ${processedDays}日 / 投入済みスキップ ${dates.length - processedDays}日）`,
  );
  // kb_archive を書き換えたら、選手の集計の表の kb 層（マイグレーション 190）が古くなる。
  // 毎晩の Cron の指紋（行数・最大の日付）は、値だけを書き換える再投入を検知しない
  if (summary.written > 0)
    console.log(
      "⚠️ kb_archive に書き込みました。選手の集計の表の kb 層を計算し直す: node scripts/maintenance/racer-career-backfill.js --era=kb（数えるだけ）→ --apply",
    );
  if (summary.failedDays > 0) return 1;
  if (processedDays === 0) {
    console.log("対象は全て投入済みです（再投入は --force）");
    return 0;
  }
  // 0件書き込みを成功扱いにしない（全て変更なしの再実行は unchanged>0 で成功）
  if (summary.written + summary.unchanged === 0 && totals.boats > 0) {
    console.error("書き込みも変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
}

async function cmdLoad(opts) {
  if (!opts.allowOverlap && opts.to >= MAIN_TABLES_START) {
    console.error(
      `--to=${opts.to} は本体テーブルの範囲（${MAIN_TABLES_START}以降）と重なります。アーカイブ表へは ${MAIN_TABLES_START} より前だけを投入します（検証用に重ねる場合のみ --allow-overlap）`,
    );
    return 1;
  }
  const loadedFile = path.join(opts.archiveDir, "loaded.jsonl");
  const loaded = new Set(readJsonl(loadedFile).map((e) => e.date));
  const { totals, dates } = scanParsedDays(opts);
  console.log(
    `投入対象: ${totals.days}日 / 開催 ${totals.venueDays} / レース ${totals.races} / 艇 ${totals.boats} / 警告 ${totals.warnings}`,
  );
  if (totals.days === 0) {
    console.error(
      "投入対象の中間JSONがありません（先に download → parse を実行してください）",
    );
    return 1;
  }
  if (!opts.apply) {
    console.log(
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（DDL 074 の適用と、ユーザーの実行承認が前提）",
    );
    return 0;
  }

  const { supabase } = await import("../lib/supabaseClient.js");
  const { upsertChangedRows } = await import("../lib/unchangedRows.js");
  const db = { supabase, upsertChangedRows };
  const probe = await supabase
    .from(KB_ARCHIVE_TABLES.races.table)
    .select("race_id")
    .limit(1);
  if (probe.error) {
    console.error(
      `アーカイブ表を読めません（DDL 074 が未適用の可能性）: ${probe.error.message}`,
    );
    return 1;
  }
  const summary = { written: 0, unchanged: 0, failedDays: 0 };
  let processedDays = 0;
  for (const date of dates) {
    if (loaded.has(date) && !opts.force) continue;
    processedDays++;
    await loadOneDay(opts, db, summary, date, loadedFile);
  }
  return reportLoad(summary, processedDays, dates, totals);
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function cmdStatus(opts) {
  const manifest = latestManifest(readJsonl(manifestPath(opts.archiveDir)));
  const loaded = new Set(
    readJsonl(path.join(opts.archiveDir, "loaded.jsonl")).map((e) => e.date),
  );
  const c = { days: 0, K: {}, B: {}, parsed: 0, loaded: 0 };
  for (const date of dateRange(opts.from, opts.to)) {
    c.days++;
    for (const kind of ["K", "B"]) {
      const s = manifest.get(`${date}|${kind}`)?.status ?? "none";
      c[kind][s] = (c[kind][s] ?? 0) + 1;
    }
    if (readParsedDay(opts.archiveDir, date)) c.parsed++;
    if (loaded.has(date)) c.loaded++;
  }
  console.log(JSON.stringify(c, null, 2));
  return 0;
}

export {
  appendJsonl,
  sleep,
  sha256,
  finishDownload,
  readParsedDay,
  cmdParse,
  cmdLoad,
  cmdStatus,
};
