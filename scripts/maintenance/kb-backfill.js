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

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  KB_USER_AGENT,
  KB_SCHEMA,
  PENDING_MARKER,
  buildKbUrl,
  kbArchiveRelPath,
  decodeLzhText,
  buildKbDay,
  summarizeKbDay,
} from "../lib/kbFileParser.js";
import { buildArchiveRows, KB_ARCHIVE_TABLES } from "../lib/kbArchiveRows.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

// 本体テーブル（races等）が持つ最古の日。これ以降のK/Bはアーカイブへ投入しない（重複）
export const MAIN_TABLES_START = "2025-12-03";
const EARLIEST_AVAILABLE = "2005-01-01";

const HARD_MIN_INTERVAL_MS = 3000; // 公式サイトへの最小間隔（ADR-0067）。これ未満は指定できない
const FETCH_TIMEOUT_MS = 45000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 純粋関数（verify-kb-backfill.js で単体検証する）
// ---------------------------------------------------------------------------

export function* dateRange(from, to) {
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
}

/** JSTの「今日」 YYYY-MM-DD */
export function jstToday(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "22-06" → {start: 22, end: 6}。"any" は制限なし（null） */
export function parseWindow(spec) {
  if (spec === "any") return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec);
  if (!m)
    throw new Error(`--window の形式が不正です（例: 22-06 / any）: ${spec}`);
  const [start, end] = [Number(m[1]), Number(m[2])];
  if (start > 24 || end > 24 || start === end) {
    throw new Error(
      `--window は開始と終了が異なる0〜24の時刻で指定します: ${spec}`,
    );
  }
  return { start, end };
}

/** JSTの時刻が窓（日をまたぐ窓を含む）に入っているか */
export function inWindow(win, now = new Date()) {
  if (!win) return true;
  const h = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  return win.start < win.end
    ? h >= win.start && h < win.end
    : h >= win.start || h < win.end;
}

/**
 * 日次上限の集計キー。夜間窓（例: 22-06）は日をまたぐため、窓の終了時刻ぶん遡った
 * JST日付を「その夜の日付」とする（23:00と翌03:00が同じ夜に数えられる）。
 */
export function windowDayKey(win, at) {
  const shift = win && win.start > win.end ? win.end * 60 * 60 * 1000 : 0;
  return new Date(new Date(at).getTime() + JST_OFFSET_MS - shift)
    .toISOString()
    .slice(0, 10);
}

/** HTTP結果の分類。bad=サーキットブレーカーの連続カウント対象 */
export function classifyResponse(status) {
  if (status === 200) return { kind: "ok", bad: false };
  if (status === 404) return { kind: "absent", bad: false };
  if (status === 403)
    return { kind: "blocked", bad: true, threshold: 2, backoff: false };
  if (status === 429 || status === 503)
    return { kind: "throttled", bad: true, threshold: 3, backoff: true };
  if (status >= 500)
    return { kind: "server-error", bad: true, threshold: 3, backoff: true };
  return { kind: "unexpected", bad: true, threshold: 3, backoff: false };
}

/** マニフェスト（JSONL、追記のみ）から (date,kind) ごとの最新状態を作る */
export function latestManifest(entries) {
  const map = new Map();
  for (const e of entries) map.set(`${e.date}|${e.kind}`, e);
  return map;
}

const DONE_STATUSES = new Set(["ok", "absent", "skipped"]);

/**
 * 取得計画。K（成績）が無い日（404）はBの取得を省く（開催が無い日）。
 * @returns {Array<{date: string, kind: "K"|"B"}>}
 */
export function planDownload({ from, to, kinds, manifest }) {
  const todo = [];
  for (const date of dateRange(from, to)) {
    for (const kind of kinds) {
      const state = manifest.get(`${date}|${kind}`);
      if (state && DONE_STATUSES.has(state.status)) continue;
      todo.push({ date, kind });
    }
  }
  return todo;
}

/** 見積り。intervalは平均、latencyは1リクエストの応答時間（利用環境で異なる） */
export function estimatePlan({
  requests,
  dailyLimit,
  meanIntervalMs,
  latencyMs,
}) {
  const perRequestMs = meanIntervalMs + latencyMs;
  const nights = Math.ceil(requests / dailyLimit);
  return {
    requests,
    nights,
    totalHours: Math.round(((requests * perRequestMs) / 3600000) * 10) / 10,
    hoursPerFullNight:
      Math.round(
        ((Math.min(requests, dailyLimit) * perRequestMs) / 3600000) * 10,
      ) / 10,
  };
}

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {
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
      case "kinds":
        opts.kinds = v.split(",").map((s) => s.trim().toUpperCase());
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
      case "allow-overlap":
        opts.allowOverlap = true;
        break;
      default:
        throw new Error(`不明なオプション: ${arg}`);
    }
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
// アーカイブ（ファイルシステム）
// ---------------------------------------------------------------------------

const manifestPath = (dir) => path.join(dir, "manifest.jsonl");
const rawPath = (dir, kind, date) =>
  path.join(dir, "raw", kbArchiveRelPath(kind, date));
const parsedPath = (dir, date, plain) =>
  path.join(
    dir,
    "parsed",
    date.slice(0, 7).replace("-", ""),
    `kb-${date}.json${plain ? "" : ".gz"}`,
  );

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l, i) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        throw new Error(`${file} の${i + 1}行目が不正なJSONです: ${e.message}`);
      }
    });
}

const appendJsonl = (file, obj) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

async function fetchOnce(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": KB_USER_AGENT },
      signal: ac.signal,
      redirect: "manual",
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, bytes, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {object} opts
 * @param {{sleep?: Function, fetchOnce?: Function, now?: () => Date, backoffBaseMs?: number}} [deps] テスト用の差し替え
 */
export async function cmdDownload(opts, deps = {}) {
  const sleepFn = deps.sleep ?? sleep;
  const fetchFn = deps.fetchOnce ?? fetchOnce;
  const nowFn = deps.now ?? (() => new Date());
  const backoffBaseMs = deps.backoffBaseMs ?? 30000;
  const manifestFile = manifestPath(opts.archiveDir);
  const manifest = latestManifest(readJsonl(manifestFile));
  let todo = planDownload({
    from: opts.from,
    to: opts.to,
    kinds: opts.kinds,
    manifest,
  });
  const win = parseWindow(opts.window);
  const meanInterval = (opts.intervalMinMs + opts.intervalMaxMs) / 2;
  const est = estimatePlan({
    requests: todo.length,
    dailyLimit: opts.dailyLimit,
    meanIntervalMs: meanInterval,
    latencyMs: opts.latencyMs,
  });
  const days = new Set(todo.map((t) => t.date)).size;
  console.log(
    `対象 ${opts.from}〜${opts.to} / 種別 ${opts.kinds.join(",")}: 未取得 ${todo.length} リクエスト（${days}日分）` +
      ` / 日次上限 ${opts.dailyLimit} → 最短 ${est.nights} 夜、合計約 ${est.totalHours} 時間` +
      `（間隔 ${opts.intervalMinMs}〜${opts.intervalMaxMs}ms + 応答 ${opts.latencyMs}ms を仮定）`,
  );
  if (opts.dryRun) {
    console.log(
      "[DRY-RUN] ネットワーク・書き込みなし。先頭5件:",
      JSON.stringify(todo.slice(0, 5)),
    );
    return 0;
  }
  if (todo.length === 0) {
    console.log("未取得はありません（完了済み）");
    return 0;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const stats = {
    requests: 0,
    ok: 0,
    absent: 0,
    pending: 0,
    error: 0,
    skipped: 0,
  };
  let consecutiveBad = 0;
  let badKind = null;
  let consecutiveNotLzh = 0;
  let consecutiveAbsent = 0; // 404が続くのは、URL構造の変更やアクセス制限の疑い（ボートレースは毎日どこかで開催）
  const skipB = new Set(); // Kが404の日（開催なし）はBを取得しない

  const nightCount = () => {
    const key = windowDayKey(win, nowFn());
    return [...readJsonl(manifestFile)].filter(
      (e) => e.requested && windowDayKey(win, e.fetchedAt) === key,
    ).length;
  };
  let usedTonight = nightCount();

  const stop = (code, reason, resumeFrom) => {
    console.log(`\n停止: ${reason}`);
    if (resumeFrom)
      console.log(
        `再開: 同じコマンドを再実行（次の対象 ${resumeFrom.date} ${resumeFrom.kind}）`,
      );
    console.log(`集計: ${JSON.stringify(stats)}`);
    appendJsonl(path.join(opts.archiveDir, "runs.jsonl"), {
      runId,
      stopped: reason,
      stats,
    });
    return code;
  };

  for (let i = 0; i < todo.length; i++) {
    const { date, kind } = todo[i];
    if (kind === "B" && (skipB.has(date) || manifest.get(`${date}|K`)?.status === "absent")) {
      appendJsonl(manifestFile, {
        date,
        kind,
        status: "skipped",
        reason: "K-absent",
        fetchedAt: new Date().toISOString(),
      });
      stats.skipped++;
      continue;
    }
    if (!inWindow(win, nowFn()))
      return stop(2, `実行窓（JST ${opts.window}）の外です`, todo[i]);
    if (usedTonight >= opts.dailyLimit)
      return stop(
        2,
        `日次上限 ${opts.dailyLimit} リクエストに到達しました`,
        todo[i],
      );
    if (stats.requests >= opts.maxRequests)
      return stop(
        2,
        `--max-requests=${opts.maxRequests} に到達しました`,
        todo[i],
      );

    const url = buildKbUrl(kind, date);
    let res;
    let netError = null;
    try {
      res = await fetchFn(url);
    } catch (e) {
      netError = e;
    }
    stats.requests++;
    usedTonight++;
    const fetchedAt = nowFn().toISOString();

    const cls = netError
      ? { kind: "network", bad: true, threshold: 3, backoff: true }
      : classifyResponse(res.status);
    let entry = {
      date,
      kind,
      url,
      requested: true,
      fetchedAt,
      http: res?.status ?? null,
      ms: res?.ms ?? null,
    };

    if (cls.bad) {
      consecutiveBad = badKind === cls.kind ? consecutiveBad + 1 : 1;
      badKind = cls.kind;
      entry = {
        ...entry,
        status: "error",
        reason: netError
          ? String(netError.message ?? netError)
          : `HTTP ${res.status}`,
      };
      appendJsonl(manifestFile, entry);
      stats.error++;
      console.log(
        `[${i + 1}/${todo.length}] ${date} ${kind} ${entry.reason}（連続 ${consecutiveBad}/${cls.threshold}）`,
      );
      if (consecutiveBad >= cls.threshold)
        return stop(
          4,
          `サーキットブレーカー: ${cls.kind} が ${consecutiveBad} 回連続しました。時間を置き、間隔を広げてから再開してください`,
          todo[i],
        );
      if (cls.backoff) {
        const wait = Math.min(300000, backoffBaseMs * 2 ** (consecutiveBad - 1));
        console.log(`  バックオフ ${Math.round(wait / 1000)} 秒`);
        await sleepFn(wait);
      }
      i--; // 同じ対象をやり直す（連続失敗の上限で必ず止まる）
      continue;
    }
    consecutiveBad = 0;
    badKind = null;

    if (cls.kind === "absent") {
      appendJsonl(manifestFile, { ...entry, status: "absent" });
      stats.absent++;
      consecutiveAbsent++;
      if (kind === "K") skipB.add(date);
      console.log(`[${i + 1}/${todo.length}] ${date} ${kind} 404（開催なし）`);
      if (consecutiveAbsent >= 3)
        return stop(
          4,
          `404が${consecutiveAbsent}回連続しました（URL構造の変更またはアクセス制限の疑い。開催のない日が3日続くことは通常ありません）`,
          todo[i + 1] ?? null,
        );
    } else {
      consecutiveAbsent = 0;
      // 200: LZHとして展開できること、Kは確定済み（プレースホルダでない）ことを確認して保存する
      let text = null;
      try {
        text = await decodeLzhText(res.bytes);
      } catch (e) {
        entry = {
          ...entry,
          status: "error",
          reason: `LZH展開失敗: ${e.message}`,
          bytes: res.bytes.length,
        };
        appendJsonl(manifestFile, entry);
        stats.error++;
        console.log(
          `[${i + 1}/${todo.length}] ${date} ${kind} ${entry.reason}`,
        );
        consecutiveNotLzh++;
        if (consecutiveNotLzh >= 3)
          return stop(
            4,
            "LZHとして展開できない応答が3回連続しました（応答の形式変更またはブロックの疑い）",
            todo[i],
          );
        continue;
      }
      consecutiveNotLzh = 0;
      if (kind === "K" && text.includes(PENDING_MARKER)) {
        appendJsonl(manifestFile, {
          ...entry,
          status: "pending",
          bytes: res.bytes.length,
        });
        stats.pending++;
        console.log(
          `[${i + 1}/${todo.length}] ${date} ${kind} 未確定（プレースホルダ）。保存しません`,
        );
      } else {
        const file = rawPath(opts.archiveDir, kind, date);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, res.bytes);
        appendJsonl(manifestFile, {
          ...entry,
          status: "ok",
          bytes: res.bytes.length,
          sha256: sha256(res.bytes),
          file: kbArchiveRelPath(kind, date),
        });
        stats.ok++;
        console.log(
          `[${i + 1}/${todo.length}] ${date} ${kind} ok ${res.bytes.length}B ${res.ms}ms（今夜 ${usedTonight}/${opts.dailyLimit}）`,
        );
      }
    }
    const wait =
      opts.intervalMinMs +
      Math.random() * (opts.intervalMaxMs - opts.intervalMinMs);
    await sleepFn(wait);
  }
  console.log(`\n完了: ${JSON.stringify(stats)}`);
  appendJsonl(path.join(opts.archiveDir, "runs.jsonl"), {
    runId,
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

async function cmdParse(opts) {
  const manifest = latestManifest(readJsonl(manifestPath(opts.archiveDir)));
  let targets = 0;
  let written = 0;
  let skipped = 0;
  const anomalies = [];
  for (const date of dateRange(opts.from, opts.to)) {
    const k = manifest.get(`${date}|K`);
    const b = manifest.get(`${date}|B`);
    if (k?.status !== "ok" && b?.status !== "ok") continue;
    targets++;
    const out = parsedPath(opts.archiveDir, date, opts.plain);
    if (!opts.force && fs.existsSync(out)) {
      skipped++;
      continue;
    }
    const read = async (kind, m) =>
      m?.status === "ok"
        ? {
            text: await decodeLzhText(
              new Uint8Array(
                fs.readFileSync(rawPath(opts.archiveDir, kind, date)),
              ),
            ),
            source: {
              file: m.file,
              sha256: m.sha256,
              bytes: m.bytes,
              fetchedAt: m.fetchedAt,
            },
          }
        : null;
    const [kr, br] = [await read("K", k), await read("B", b)];
    const day = buildKbDay({
      date,
      kText: kr?.text ?? null,
      bText: br?.text ?? null,
      source: { K: kr?.source ?? null, B: br?.source ?? null },
    });
    const s = summarizeKbDay(day);
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
    if (problems.length) {
      anomalies.push({ date, problems });
      appendJsonl(path.join(opts.archiveDir, "parsed", "anomalies.jsonl"), {
        date,
        problems,
        at: new Date().toISOString(),
      });
    }
    const json = JSON.stringify(day);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, opts.plain ? json : zlib.gzipSync(json));
    written++;
    console.log(
      `${date} K${s.k_races}R/B${s.b_races}R ${problems.length ? `⚠ ${problems.join(" / ")}` : "ok"}`,
    );
  }
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

async function cmdLoad(opts) {
  if (!opts.allowOverlap && opts.to >= MAIN_TABLES_START) {
    console.error(
      `--to=${opts.to} は本体テーブルの範囲（${MAIN_TABLES_START}以降）と重なります。アーカイブ表へは ${MAIN_TABLES_START} より前だけを投入します（検証用に重ねる場合のみ --allow-overlap）`,
    );
    return 1;
  }
  const loadedFile = path.join(opts.archiveDir, "loaded.jsonl");
  const loaded = new Set(readJsonl(loadedFile).map((e) => e.date));
  const totals = { days: 0, venueDays: 0, races: 0, boats: 0, warnings: 0 };
  const perDay = [];
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
    perDay.push({ date, rows });
  }
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
      "[DRY-RUN] DBには書き込みません。書き込むには --apply を付けます（DDL 072 の適用と、ユーザーの実行承認が前提）",
    );
    return 0;
  }

  const { supabase } = await import("../lib/supabaseClient.js");
  const { upsertChangedRows } = await import("../lib/unchangedRows.js");
  const probe = await supabase
    .from(KB_ARCHIVE_TABLES.races.table)
    .select("race_id")
    .limit(1);
  if (probe.error) {
    console.error(
      `アーカイブ表を読めません（DDL 072 が未適用の可能性）: ${probe.error.message}`,
    );
    return 1;
  }
  const chunk = (arr, n) =>
    Array.from({ length: Math.ceil(arr.length / n) }, (_, i) =>
      arr.slice(i * n, i * n + n),
    );
  const summary = { written: 0, unchanged: 0, failedDays: 0 };
  for (const { date, rows } of perDay) {
    if (loaded.has(date) && !opts.force) continue;
    let dayFailed = false;
    const put = async (spec, list, perStmt) => {
      for (const part of chunk(list, perStmt)) {
        const r = await upsertChangedRows(supabase, spec.table, part, {
          onConflict: spec.onConflict,
          keyColumns: spec.keyColumns,
          chunkColumn: spec.chunkColumn,
          batchSize: opts.batchSize,
        });
        summary.written += r.written;
        summary.unchanged += r.skipped;
        if (r.error) dayFailed = true;
        await sleep(opts.sleepMs); // 文の間隔（Disk IO Budgetへの配慮）
      }
    };
    await put(KB_ARCHIVE_TABLES.venueDays, rows.venueDays, opts.batchSize);
    await put(KB_ARCHIVE_TABLES.races, rows.races, opts.batchSize);
    await put(KB_ARCHIVE_TABLES.boats, rows.boats, opts.batchSize); // 200行/文（1レース6行のため33レースずつ）
    if (dayFailed) {
      summary.failedDays++;
      console.error(
        `${date}: 書き込みに失敗した文があります。loaded に記録しません（再実行で再試行されます）`,
      );
      continue;
    }
    appendJsonl(loadedFile, {
      date,
      at: new Date().toISOString(),
      races: rows.races.length,
      boats: rows.boats.length,
    });
  }
  console.log(`\nload: ${JSON.stringify(summary)}`);
  if (summary.failedDays > 0) return 1;
  // 0件書き込みを成功扱いにしない（全て変更なしの再実行は unchanged>0 で成功）
  if (summary.written + summary.unchanged === 0 && totals.boats > 0) {
    console.error("書き込みも変更なしの判定も0件でした。異常として扱います");
    return 1;
  }
  return 0;
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
