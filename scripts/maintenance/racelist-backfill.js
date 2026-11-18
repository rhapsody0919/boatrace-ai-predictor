#!/usr/bin/env node
/**
 * 出走表（公式 racelist ページ）過去分バックフィルCLI（N19: 3連率の欠落対応、BOA-417: F数等の欠落対応）
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
 * 読み取りで決める**（global_3rate か f_count が NULL の行を持つレース。BOA-417 で f_count を追加）点が異なる:
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
import { pathToFileURL } from "node:url";
import { parseRaceListPage } from "../lib/raceListParser.js";
import { getYesterdayDateJST } from "../lib/dateUtils.js";
import {
  buildRacelistUrl,
  loadTargetRaceIds,
  racelistArchiveRelPath,
} from "../lib/racelistBackfillRows.js";
import { parseArgs } from "./racelist-backfill-args.js";
import {
  cmdLoad,
  latestManifestByKey,
  loadBatch,
  loadedPath,
  manifestPath,
  parsedPath,
  rawPath,
  readParsedRace,
} from "./racelist-backfill-load.js";
import {
  HARD_MIN_INTERVAL_MS,
  appendJsonl,
  readJsonl,
  runArchiveDownload,
  sha256,
} from "../lib/archiveDownloader.js";

const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const RACELIST_SCHEMA = "racelist-backfill/v1";

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

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

/** race_id の一覧を月ごとに数える（plan・status の内訳） */
const countByMonth = (raceIds) =>
  raceIds.reduce((acc, id) => {
    const m = id.slice(0, 7);
    return { ...acc, [m]: (acc[m] ?? 0) + 1 };
  }, {});

// ---------------------------------------------------------------------------
// plan / download（対象は本番DBの読み取りで決める。取得ループ自体は archiveDownloader.js を再利用）
// ---------------------------------------------------------------------------

async function loadTargets(opts, deps) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  // --to の既定は前日（JST）。当日以降のレースは日次の取得が埋めるため、夜間の取得（期間を指定しない）で
  // 当日・翌日の出走表を取りに行かない（BOA-417 で対象を F数の NULL に広げたため、当日分も対象に入りうる）
  return loadTargetRaceIds(client, {
    from: opts.from,
    to: opts.to ?? getYesterdayDateJST(),
  });
}

/**
 * @param {object} opts
 * @param {{client?: object, sleep?: Function, fetchOnce?: Function, now?: () => Date, log?: Function}} [deps]
 */
export async function cmdDownload(opts, deps = {}) {
  const log = deps.log ?? console.log;
  const targetIds = deps.targetIds ?? (await loadTargets(opts, deps));
  log(
    `対象レース（global_3rate か f_count が NULL、${opts.from ?? "全期間"}〜${opts.to ?? `${getYesterdayDateJST()}（前日）`}）: ${targetIds.length}件 ${JSON.stringify(countByMonth(targetIds))}`,
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

export { cmdLoad };

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
