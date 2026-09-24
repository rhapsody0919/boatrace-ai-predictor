#!/usr/bin/env node
/**
 * 2025-12-03〜2026-03-31の中止・打ち切りレースへ cancellation_status='confirmed' を是正する（BOA-406）
 *
 * 背景: BOA-403（K/B本体テーブル補填）の調査で、race_results が欠損しているレースのうち
 * 一部が「K-fileにそのレースの記録が無い（開催されなかった）」パターンと判明した
 * （classifyMissingResult の RACE_NOT_IN_K_VENUE）。BOA-406 でこの全件を K-file と突き合わせ、
 * 全件が中止・打ち切りと確定できること、全件 cancellation_status が NULL のままだったことを
 * 確認した（docs/design/scraping-vercel-consolidation/、PR #816参照）。
 *
 * 【新規の公式サイトアクセスは無い】（DB読み取り + ローカルの中間JSON読み取りのみ）。
 * 本番は並行稼働の他ジョブ・セッションで races が常時更新されているため、対象件数は実行のたびに
 * 変動しうる（BOA-403と同じ理由）。fetchAll の races 取得には .order("race_id") を付け、
 * ページング不安定によるバグ（BOA-403で発見・修正済み）を踏まない。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js plan
 *   node --env-file=.env.local scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js apply          # DRY-RUN
 *   node --env-file=.env.local scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js apply --apply  # 書き込み（要承認）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAll, supabase } from "../lib/supabaseClient.js";
import {
  classifyMissingResult,
  MISSING_STATUS,
} from "../lib/kbResultsBackfillRows.js";
import { _internal as kbBackfillInternal } from "./kb-backfill.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const ARCHIVE_DIR = path.join(REPO_ROOT, "data/kb-archive");

const FROM = "2025-12-03";
const TO = "2026-03-31";

/** races にはあるが race_results が無いレースのうち、RACE_NOT_IN_K_VENUE（中止・打ち切り）を集める */
async function findConfirmedCancellations() {
  const races = await fetchAll(
    "races",
    "race_id, race_date, venue_code, race_number, cancellation_status",
    (q) => q.gte("race_date", FROM).lte("race_date", TO).order("race_id"),
    { throwOnError: true },
  );
  const results = await fetchAll(
    "race_results",
    "race_id",
    (q) => q.gte("race_id", FROM).lte("race_id", `${TO}~`),
    { throwOnError: true },
  );
  const hasResult = new Set(results.map((r) => r.race_id));
  const seen = new Set();
  const missing = races
    .filter((r) => !hasResult.has(r.race_id))
    .filter((r) => {
      if (seen.has(r.race_id)) return false;
      seen.add(r.race_id);
      return true;
    });

  const dayCache = new Map();
  const getDay = (date) => {
    if (!dayCache.has(date)) {
      dayCache.set(date, kbBackfillInternal.readParsedDay(ARCHIVE_DIR, date));
    }
    return dayCache.get(date);
  };

  const cancelled = [];
  for (const r of missing) {
    const day = getDay(r.race_date);
    const result = classifyMissingResult(day, r.venue_code, r.race_number);
    if (result.status === MISSING_STATUS.RACE_NOT_IN_K_VENUE) {
      cancelled.push(r);
    }
  }
  return cancelled;
}

async function cmdPlan() {
  const cancelled = await findConfirmedCancellations();
  const alreadySet = cancelled.filter((r) => r.cancellation_status != null);
  const toFix = cancelled.filter((r) => r.cancellation_status == null);
  console.log(`対象（K-fileで中止・打ち切り確定）: ${cancelled.length}件`);
  console.log(
    `  既にcancellation_status設定済み: ${alreadySet.length}件（触らない）`,
  );
  console.log(`  is要修正（NULL→confirmed）: ${toFix.length}件`);
  return 0;
}

async function cmdApply(apply) {
  const cancelled = await findConfirmedCancellations();
  const toFix = cancelled.filter((r) => r.cancellation_status == null);
  console.log(
    `投入対象: ${toFix.length}件（既に設定済みのため対象外: ${cancelled.length - toFix.length}件）`,
  );
  if (toFix.length === 0) {
    console.log("対象0件です");
    return 0;
  }
  if (!apply) {
    console.log("[DRY-RUN] --apply を付けると本番へ書き込みます");
    console.log(
      toFix
        .slice(0, 10)
        .map((r) => r.race_id)
        .join(", ") + (toFix.length > 10 ? " ..." : ""),
    );
    return 0;
  }
  const raceIds = toFix.map((r) => r.race_id);
  const { data, error } = await supabase
    .from("races")
    .update({ cancellation_status: "confirmed" })
    .in("race_id", raceIds)
    .is("cancellation_status", null) // 二重防御: 実行時点でNULLの行だけを対象にする
    .select("race_id");
  if (error) {
    console.error("書き込みエラー:", error.message);
    return 1;
  }
  console.log(`書き込み完了: ${data.length}件`);
  return 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");
  if (command === "plan") return await cmdPlan();
  if (command === "apply") return await cmdApply(apply);
  console.error(
    "使い方: node scripts/maintenance/fix-cancellation-status-2025-12-2026-03.js <plan|apply> [--apply]",
  );
  return 1;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
