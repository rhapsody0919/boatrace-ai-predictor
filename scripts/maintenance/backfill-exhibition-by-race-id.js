/**
 * 展示データ欠損レースのバックフィル（BOA-354）
 *
 * 展示データは発走30/15/10分前のウィンドウでしか取得されないため、DB障害などで
 * そのウィンドウを逃したレースは通常の取得経路では回復しない。公式サイトの
 * beforeinfoは発走後も展示データを掲載し続けるので、指定レースについて
 * scrape-exhibition-data.jsのrun()をそのまま再利用して取得し直す。
 * 既にexhibition_dataがあるレースはrun()側でスキップされるため上書きしない。
 *
 * run()は「今から発走30/15/10分前のレース」しか対象にしないため、対象レースの
 * start_timeを「今+15分」に差し替えたscheduleを渡してウィンドウに入れている
 * （start_timeは対象選定にしか使われず、DBには書き込まれない）。run()の窓
 * （scrape-exhibition-data.js、現状30/15/10分前±3分）に15分前が含まれることに依存する。
 * 何度再実行しても安全。
 *
 * 使い方:
 *   node scripts/maintenance/backfill-exhibition-by-race-id.js --race-ids=2026-09-16-07-09,2026-09-16-07-10          # dry-run
 *   node scripts/maintenance/backfill-exhibition-by-race-id.js --race-ids=2026-09-16-07-09 --apply                    # 書き込み
 */

import { supabase, isSupabaseEnabled } from "../lib/supabaseClient.js";
import { extractDateFromRaceId } from "../lib/dateUtils.js";
import { run as runExhibition } from "../daily/scrape-exhibition-data.js";

const RACE_ID_PATTERN = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;
const IN_WINDOW_MINUTES = 15;

function getArg(name) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.slice(name.length + 3) : null;
}

async function fetchTargets(raceIds) {
  const { data: races, error } = await supabase
    .from("races")
    .select("race_id, venue_code, race_number")
    .in("race_id", raceIds);
  if (error) throw new Error(`races取得エラー: ${error.message}`);

  const missingIds = raceIds.filter(
    (id) => !(races ?? []).some((r) => r.race_id === id),
  );
  if (missingIds.length > 0) {
    throw new Error(`racesに存在しないrace_id: ${missingIds.join(", ")}`);
  }

  const { data: exhibitions, error: exhibitionsError } = await supabase
    .from("exhibition_data")
    .select("race_id")
    .in("race_id", raceIds);
  if (exhibitionsError)
    throw new Error(`exhibition_data取得エラー: ${exhibitionsError.message}`);

  const hasExhibition = new Set((exhibitions ?? []).map((r) => r.race_id));
  return (races ?? []).map((r) => ({
    ...r,
    hasExhibition: hasExhibition.has(r.race_id),
  }));
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
  const dates = new Set(raceIds.map(extractDateFromRaceId));
  if (dates.size > 1) {
    throw new Error("race_idは同一日付のものだけ指定してください");
  }
  const [date] = dates;

  const targets = await fetchTargets(raceIds);
  console.log(
    `対象${targets.length}レース（${apply ? "書き込み" : "dry-run"}）`,
  );
  for (const t of targets) {
    console.log(
      `  ${t.race_id} 展示データ=${t.hasExhibition ? "あり" : "なし"}`,
    );
  }

  const needs = targets.filter((t) => !t.hasExhibition);
  if (!apply) {
    console.log(
      `\ndry-run: 取得対象${needs.length}件。書き込むには --apply を付けて再実行`,
    );
    return;
  }
  if (needs.length === 0) {
    console.log("\n全レースで展示データが取得済みのため何もしません");
    return;
  }

  const startTime = new Date(Date.now() + IN_WINDOW_MINUTES * 60 * 1000);
  const schedule = needs.map((t) => ({
    race_id: t.race_id,
    venue_code: t.venue_code,
    race_no: t.race_number,
    start_time: startTime,
  }));
  await runExhibition(schedule, date);

  const after = await fetchTargets(raceIds);
  const stillMissing = after.filter((t) => !t.hasExhibition);
  if (stillMissing.length > 0) {
    console.error(
      `\n展示データを取得できなかったレース: ${stillMissing.map((t) => t.race_id).join(", ")}`,
    );
    process.exit(1);
  }
  console.log("\n完了");
}

main().catch((error) => {
  console.error(
    "❌ backfill-exhibition-by-race-id 実行中にエラー:",
    error.message,
  );
  process.exit(1);
});
