/**
 * 結果欠損レースのバックフィルと、誤確定された中止・順延の解除（BOA-354）
 *
 * DB障害などで発走後の結果取得ウィンドウ（発走5〜90分後）を逃したレースは、
 * race_resultsに行が無いまま races.cancellation_status='confirmed'（中止・順延確定、
 * BOA-254）にされてしまい、通常の取得経路では二度と回復しない。
 * 指定したレースの結果を公式サイトから取得し直し（scrape-results.jsの
 * scrapeAndSaveResultsをそのまま再利用: 払戻・決まり手・スタート展示・的中判定）、
 * 結果が入ったレースに限り cancellation_status / cancellation_check_streak を戻す。
 * 何度再実行しても安全（結果が揃ったレースは再取得せず、解除も結果のあるレースだけ）。
 *
 * 注意: scrapeAndSaveResultsは末尾で日次と同じ自己修復（直近10日分の的中フラグ補完）も
 * 実行するため、指定外のレースの欠落フラグも書き込まれうる。進入コース・rank4〜6は
 * 日次のKファイル同期（直近4日分）に任せており、それより古い日付は別途同期が要る。
 *
 * 使い方:
 *   node scripts/maintenance/backfill-results-by-race-id.js --race-ids=2026-09-16-07-07,2026-09-16-07-08          # dry-run
 *   node scripts/maintenance/backfill-results-by-race-id.js --race-ids=2026-09-16-07-07 --apply                    # 書き込み
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { extractDateFromRaceId } from "../lib/dateUtils.js";
import { scrapeAndSaveResults } from "../daily/scrape-results.js";

const RACE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function fetchTargets(raceIds) {
  const { data: races, error } = await supabase
    .from("races")
    .select(
      "race_id, venue_code, race_number, cancellation_status, cancellation_check_streak",
    )
    .in("race_id", raceIds);
  if (error) throw new Error(`races取得エラー: ${error.message}`);

  const missingIds = raceIds.filter(
    (id) => !(races ?? []).some((r) => r.race_id === id),
  );
  if (missingIds.length > 0) {
    throw new Error(`racesに存在しないrace_id: ${missingIds.join(", ")}`);
  }

  const { data: results, error: resultsError } = await supabase
    .from("race_results")
    .select("race_id, payout_win, winning_technique")
    .in("race_id", raceIds);
  if (resultsError)
    throw new Error(`race_results取得エラー: ${resultsError.message}`);

  const resultById = new Map((results ?? []).map((r) => [r.race_id, r]));
  return (races ?? []).map((r) => {
    const result = resultById.get(r.race_id);
    return {
      ...r,
      hasResultRow: result != null,
      // scrapeAndSaveResultsが「完了」とみなす条件（BOA-323）と同じ
      isComplete:
        result?.payout_win != null && result?.winning_technique != null,
    };
  });
}

async function main() {
  if (!isSupabaseEnabled()) {
    throw new Error("Supabaseが設定されていません");
  }
  const raceIds = (getArg("race-ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const apply = process.argv.includes("--apply");

  if (raceIds.length === 0) {
    throw new Error("--race-ids=ID,ID,... を指定してください");
  }
  const invalid = raceIds.filter((id) => !RACE_ID_PATTERN.test(id));
  if (invalid.length > 0) {
    throw new Error(`race_idの形式が不正: ${invalid.join(", ")}`);
  }

  const targets = await fetchTargets(raceIds);
  console.log(
    `対象${targets.length}レース（${apply ? "書き込み" : "dry-run"}）`,
  );
  for (const t of targets) {
    const resultLabel = !t.hasResultRow
      ? "なし"
      : t.isComplete
        ? "あり"
        : "あり(払戻・決まり手が一部未取得)";
    console.log(
      `  ${t.race_id} cancellation_status=${t.cancellation_status ?? "null"} 結果=${resultLabel}`,
    );
  }

  const needsResult = targets.filter((t) => !t.isComplete);
  if (!apply) {
    console.log(
      `\ndry-run: 結果取得対象${needsResult.length}件。書き込むには --apply を付けて再実行`,
    );
    return;
  }

  const byDate = new Map();
  for (const t of needsResult) {
    const date = extractDateFromRaceId(t.race_id);
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      race_id: t.race_id,
      venue_code: t.venue_code,
      race_number: t.race_number,
    });
  }
  for (const [date, races] of byDate) {
    await scrapeAndSaveResults(races, date);
  }

  const after = await fetchTargets(raceIds);
  // 結果行があるレースは開催済みなので、中止・順延の暫定(tentative)・確定(confirmed)を解除する。
  // 結果行が無いレースは触らない
  const restorable = after.filter(
    (t) => t.hasResultRow && t.cancellation_status != null,
  );
  if (restorable.length > 0) {
    const { error } = await supabase
      .from("races")
      .update({ cancellation_status: null, cancellation_check_streak: 0 })
      .in(
        "race_id",
        restorable.map((t) => t.race_id),
      )
      .not("cancellation_status", "is", null);
    if (error) throw new Error(`racesの中止・順延解除エラー: ${error.message}`);
    console.log(`\n中止・順延の状態を解除: ${restorable.length}件`);
  }

  const incomplete = after.filter((t) => t.hasResultRow && !t.isComplete);
  if (incomplete.length > 0) {
    console.warn(
      `\n払戻・決まり手が未取得のレース（公式サイトの掲載待ちの可能性。時間を置いて同じコマンドで再実行）: ${incomplete.map((t) => t.race_id).join(", ")}`,
    );
  }

  const stillMissing = after.filter((t) => !t.hasResultRow);
  if (stillMissing.length > 0) {
    console.error(
      `\n結果を取得できなかったレース: ${stillMissing.map((t) => t.race_id).join(", ")}`,
    );
    process.exit(1);
  }
  console.log("\n完了");
}

main().catch((error) => {
  console.error(
    "❌ backfill-results-by-race-id 実行中にエラー:",
    error.message,
  );
  process.exit(1);
});
