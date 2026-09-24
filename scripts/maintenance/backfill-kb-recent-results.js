#!/usr/bin/env node
/**
 * K/Bアーカイブによる直近欠損月の race_results 補填CLI（BOA-403）
 *
 * 背景: docs/design/scraping-vercel-consolidation/data-catalog.md N32。2025-12-03〜2026-03-31の
 * 一部レースで races 行はあるのに race_results 行が丸ごと無い（欠損。実測件数はPR本文・
 * `status`/`plan`コマンドの出力を参照。本番DBは並行稼働の他ジョブで日々変化するため、この
 * コメントに具体件数は書かない）。対応する公式K/Bファイルは既にダウンロード・パース済み
 * （data/kb-archive/parsed/、scripts/maintenance/kb-backfill.js parse。git管理外＝.gitignoreの
 * data/kb-archive/ 対象）のため、新規の公式サイトアクセス無しでこのCLIだけで完結する。
 *
 * 【新規の公式サイトアクセスは無い】（DB読み取り + ローカルの中間JSON読み取りのみ）ため、
 * kb-backfill.js のような夜間窓・レート制限は無い。
 *
 * 【重要】実データ調査の結果、欠損のうち機械的に埋められるのは一部のみ（`plan`のfound件数）。
 * 残り（venue_not_in_k・race_not_in_k_venue）は対象外（理由はscripts/lib/kbResultsBackfillRows.js
 * のコメント、およびtasks.md N32参照）。
 * race_entries は本期間で欠損行が0件（既に埋まっている）ため書き込み対象に含めない
 * （race_entriesの列単位の欠落＝branch等は、racelist-backfill.js（N19）が別の一次情報源
 * （racelist再取得）で対応中の別スコープ。混ぜるとkbArchiveRows.js既知の注意点＝情報源が
 * 違うと同じレースでも値が食い違いうる、という問題を持ち込むため意図的に対象外とする）。
 * race_payouts は2026-09-20新設のテーブルで本期間の履歴自体が無い（過去分の投入は本チケットの
 * バックフィルの定義＝「欠損の穴埋め」から外れる別判断のため対象外）。race_grade のNULL補完は
 * K-fileのstage/stage_rawが節内の组別（予選/準優/優勝等）であり大会グレード（SG/G1/G2/G3/ippan）
 * とは無関係と判明したため実装しない（詳細はtasks.md参照）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-recent-results.js status [--from=] [--to=]
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-recent-results.js plan [--from=] [--to=]
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-recent-results.js load [--from=] [--to=]          # DRY-RUN
 *   node --env-file=.env.local scripts/maintenance/backfill-kb-recent-results.js load [--from=] [--to=] --apply  # 書き込み（要承認）
 *
 * 既定の対象期間: 2025-12-03（本体テーブル開始日）〜2026-03-31（BOA-403時点の既知の欠損月末）
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchAll } from "../lib/supabaseClient.js";
import { upsertChangedRows } from "../lib/unchangedRows.js";
import {
  classifyMissingResult,
  buildRaceFactsForDay,
  buildRaceResultRow,
  MISSING_STATUS,
} from "../lib/kbResultsBackfillRows.js";
import { _internal as kbBackfillInternal } from "./kb-backfill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

const DEFAULT_FROM = "2025-12-03";
const DEFAULT_TO = "2026-03-31";

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = {
    command,
    from: DEFAULT_FROM,
    to: DEFAULT_TO,
    archiveDir: path.join(REPO_ROOT, "data/kb-archive"),
    apply: false,
    batchSize: 500,
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
      case "apply":
        opts.apply = true;
        break;
      case "batch-size":
        opts.batchSize = Number(v);
        break;
      default:
        throw new Error(`不明なオプション: ${arg}`);
    }
  }
  return opts;
}

function validateOptions(opts) {
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");
  if (!isDate(opts.from))
    throw new Error("--from の形式が不正です（YYYY-MM-DD）");
  if (!isDate(opts.to)) throw new Error("--to の形式が不正です（YYYY-MM-DD）");
  if (opts.from > opts.to) throw new Error("--from は --to 以前にしてください");
  return opts;
}

// ---------------------------------------------------------------------------
// DB読み取り（対象の確定）
// ---------------------------------------------------------------------------

/**
 * 対象期間で races にはあるが race_results が無いレースの一覧（読み取りのみ）。
 * @returns {Promise<Array<{race_id: string, race_date: string, venue_code: number,
 *   race_number: number, cancellation_status: string|null}>>}
 */
export async function findMissingResultRaces(client, { from, to }) {
  // 本番は並行稼働の他ジョブ・セッションで races が常時更新されている。fetchAll の
  // .range() ページングは明示的な順序が無いと、ページ間で行の物理位置がずれて重複・欠落を
  // 引き起こしうる（実際に 2026-09-24、この関数の呼び出し順で race_id の重複が発生し、
  // ON CONFLICT DO UPDATE がバッチ内の同一行を2回対象にしてエラーになった）。race_id で
  // 明示的にソートしてページングを安定させる。念のため、返却直前にも race_id で重複排除する
  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number, cancellation_status",
    (q) => q.gte("race_date", from).lte("race_date", to).order("race_id"),
    { throwOnError: true, client },
  );
  const results = await fetchAll(
    "race_results",
    "race_id",
    (q) => q.gte("race_id", from).lte("race_id", `${to}~`),
    { throwOnError: true, client },
  );
  const existing = new Set(results.map((r) => r.race_id));
  const seen = new Set();
  return races
    .filter((r) => !existing.has(r.race_id))
    .filter((r) => {
      if (seen.has(r.race_id)) return false;
      seen.add(r.race_id);
      return true;
    })
    .sort((a, b) => (a.race_id < b.race_id ? -1 : 1));
}

/** race_entries・race_payouts の充足状況（読み取りのみ、参考情報） */
async function checkOtherTables(client, { from, to }) {
  const races = await fetchAll(
    "races",
    "race_id",
    (q) => q.gte("race_date", from).lte("race_date", to),
    { throwOnError: true, client },
  );
  const totalRaces = races.length;
  const entryRaceIds = new Set(
    (
      await fetchAll(
        "race_entries",
        "race_id",
        (q) => q.gte("race_id", from).lte("race_id", `${to}~`),
        { throwOnError: true, client },
      )
    ).map((r) => r.race_id),
  );
  const payoutRaceIds = new Set(
    (
      await fetchAll(
        "race_payouts",
        "race_id",
        (q) => q.gte("race_id", from).lte("race_id", `${to}~`),
        { throwOnError: true, client },
      )
    ).map((r) => r.race_id),
  );
  return {
    totalRaces,
    raceEntriesMissing: totalRaces - entryRaceIds.size,
    racePayoutsMissing: totalRaces - payoutRaceIds.size,
  };
}

// ---------------------------------------------------------------------------
// K/B中間JSONとの突き合わせ
// ---------------------------------------------------------------------------

/**
 * @param {ReturnType<typeof findMissingResultRaces> extends Promise<infer T> ? T : never} missingRaces
 * @param {string} archiveDir
 * @returns {{
 *   byStatus: Record<string, number>,
 *   found: Array<{raceRow: object, race: object}>,
 *   excluded: Array<{raceRow: object, status: string, maxRaceNumberInVenue?: number}>,
 * }}
 */
function classifyAll(missingRaces, archiveDir) {
  const dayCache = new Map();
  const getDay = (date) => {
    if (!dayCache.has(date)) {
      dayCache.set(date, kbBackfillInternal.readParsedDay(archiveDir, date));
    }
    return dayCache.get(date);
  };

  const byStatus = {};
  const found = [];
  const excluded = [];
  for (const raceRow of missingRaces) {
    const day = getDay(raceRow.race_date);
    const result = classifyMissingResult(
      day,
      raceRow.venue_code,
      raceRow.race_number,
    );
    byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    if (result.status === MISSING_STATUS.FOUND) {
      found.push({ raceRow, race: result.race, day });
    } else {
      excluded.push({
        raceRow,
        status: result.status,
        maxRaceNumberInVenue: result.maxRaceNumberInVenue,
      });
    }
  }
  return { byStatus, found, excluded };
}

/** found（K/Bにレースがある）のうち、実際にrace_results行を組み立てられるものを分ける */
function buildInsertableRows(found) {
  const rows = [];
  const anomalies = [];
  const factsCache = new Map(); // race_date → race_id別の確定情報（1日1回だけ組み立てる）
  for (const { raceRow, race, day } of found) {
    if (!factsCache.has(raceRow.race_date)) {
      factsCache.set(raceRow.race_date, buildRaceFactsForDay(day));
    }
    const fact = factsCache.get(raceRow.race_date).get(raceRow.race_id);
    const { row, valid, boatsInOrder } = buildRaceResultRow(
      raceRow.race_id,
      fact,
      race,
    );
    if (row) rows.push(row);
    else
      anomalies.push({
        race_id: raceRow.race_id,
        valid,
        boatsInOrder,
        reason: !valid
          ? "着順に艇番の重複（パース異常の疑い）"
          : `有効な着順が${boatsInOrder.length}艇のみ（rank1〜3のNOT NULL制約を満たせない）`,
      });
  }
  return { rows, anomalies };
}

function printClassification({ missingCount, byStatus, found, excluded }) {
  console.log(`対象期間の race_results 欠損: ${missingCount}件`);
  console.log("K/Bとの突き合わせ結果（内訳）:");
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}件`);
  }
  const cancelPending = excluded.filter(
    (e) => e.status === MISSING_STATUS.RACE_NOT_IN_K_VENUE,
  ).length;
  const dateDrift = excluded.filter(
    (e) => e.status === MISSING_STATUS.VENUE_NOT_IN_K,
  ).length;
  if (cancelPending > 0) {
    console.log(
      `  → race_not_in_k_venue（${cancelPending}件）: K-fileのそのレースは開催されていない` +
        "（中止・打ち切りの疑い。races.cancellation_statusの是正は別対応、本CLIでは書かない）",
    );
  }
  if (dateDrift > 0) {
    console.log(
      `  → venue_not_in_k（${dateDrift}件）: race_idの日付ズレの疑い` +
        "（BOA-325/BOA-402系統の既知の問題。race_id自体の訂正が必要なため本CLIでは書かない）",
    );
  }
  console.log(`K/Bで見つかったレース: ${found.length}件`);
}

// ---------------------------------------------------------------------------
// コマンド
// ---------------------------------------------------------------------------

async function cmdStatus(opts, deps = {}) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const missingRaces = await findMissingResultRaces(client, opts);
  const other = await checkOtherTables(client, opts);
  console.log(
    JSON.stringify(
      {
        range: { from: opts.from, to: opts.to },
        race_results_missing: missingRaces.length,
        race_entries_missing: other.raceEntriesMissing,
        race_payouts_missing: other.racePayoutsMissing,
        races_total: other.totalRaces,
      },
      null,
      2,
    ),
  );
  return 0;
}

async function cmdPlan(opts, deps = {}) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const missingRaces = await findMissingResultRaces(client, opts);
  const cancelledAlready = missingRaces.filter(
    (r) => r.cancellation_status,
  ).length;
  if (cancelledAlready > 0) {
    console.log(
      `注記: 欠損${missingRaces.length}件中、既にcancellation_status設定済みが${cancelledAlready}件` +
        "（期待件数の分母から除外すべき。完了報告に含める）",
    );
  }
  const { byStatus, found, excluded } = classifyAll(
    missingRaces,
    opts.archiveDir,
  );
  printClassification({
    missingCount: missingRaces.length,
    byStatus,
    found,
    excluded,
  });
  const { rows, anomalies } = buildInsertableRows(found);
  console.log(`挿入可能な行（rank1〜3充足・着順重複なし）: ${rows.length}件`);
  if (anomalies.length > 0) {
    console.log(`要確認（自動投入しない）: ${anomalies.length}件`);
    for (const a of anomalies) console.log(`  ${a.race_id}: ${a.reason}`);
  }
  return 0;
}

async function cmdLoad(opts, deps = {}) {
  const client =
    deps.client ?? (await import("../lib/supabaseClient.js")).supabase;
  const missingRaces = await findMissingResultRaces(client, opts);
  const { found } = classifyAll(missingRaces, opts.archiveDir);
  const { rows, anomalies } = buildInsertableRows(found);
  console.log(
    `投入対象: ${rows.length}件（要確認のため除外: ${anomalies.length}件）`,
  );
  if (rows.length === 0) {
    console.log("投入対象がありません");
    return 0;
  }
  const result = await upsertChangedRows(client, "race_results", rows, {
    onConflict: "race_id",
    keyColumns: ["race_id"],
    chunkColumn: "race_id",
    label: "race_results（K/Bアーカイブからの欠損補填）",
    dryRun: !opts.apply,
    batchSize: opts.batchSize,
  });
  if (result.error) return 1;
  return 0;
}

// ---------------------------------------------------------------------------

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
    if (!["status", "plan", "load"].includes(opts.command)) {
      console.error(
        "使い方: node scripts/maintenance/backfill-kb-recent-results.js <status|plan|load> [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--apply]\n詳細はファイル冒頭のコメントを参照",
      );
      return 1;
    }
    validateOptions(opts);
    if (opts.command === "status") return await cmdStatus(opts);
    if (opts.command === "plan") return await cmdPlan(opts);
    return await cmdLoad(opts);
  } catch (e) {
    console.error(`エラー: ${e.message}`);
    return 1;
  }
}

export const _internal = {
  parseArgs,
  validateOptions,
  classifyAll,
  buildInsertableRows,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await main();
}
