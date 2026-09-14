#!/usr/bin/env node
/**
 * 展示データの欠落率チェック（GitHub Actions: exhibition-gap-monitor.yml から呼ばれる）
 *
 * 結果が確定済み（race_results.payout_winが非null）のレースのうち、
 * exhibition_dataが存在しないものの割合を前日分（JST）で計測する。
 * docs/design/scraping-serverless-migration/spec.md Step 2の並走期間中の
 * 日次監視に使う。移行前3日間の実測値は0.6%/6.7%/8.1%（2026-09-12〜14）。
 *
 * 閾値を超えている場合のみ、Slack通知用のテキストをstdoutに出力し、
 * exit code 1 を返す（ワークフロー側はexit codeで通知要否を判断する）。
 */

import { getYesterdayDateJST } from "../lib/dateUtils.js";
import { supabase } from "../lib/supabaseClient.js";

const GAP_RATE_ALERT_THRESHOLD = 0.02; // 2%

async function main() {
  const date = getYesterdayDateJST();

  const { data: races, error: racesError } = await supabase
    .from("races")
    .select("race_id")
    .gte("race_id", date)
    .lt("race_id", `${date}~`);
  if (racesError) throw new Error(`races取得エラー: ${racesError.message}`);

  const { data: results, error: resultsError } = await supabase
    .from("race_results")
    .select("race_id")
    .gte("race_id", date)
    .lt("race_id", `${date}~`)
    .not("payout_win", "is", null);
  if (resultsError)
    throw new Error(`race_results取得エラー: ${resultsError.message}`);

  const { data: exhibitions, error: exhibitionsError } = await supabase
    .from("exhibition_data")
    .select("race_id")
    .gte("race_id", date)
    .lt("race_id", `${date}~`);
  if (exhibitionsError)
    throw new Error(`exhibition_data取得エラー: ${exhibitionsError.message}`);

  const finishedIds = new Set((results ?? []).map((r) => r.race_id));
  const exhibitionIds = new Set((exhibitions ?? []).map((r) => r.race_id));
  const finishedRaces = (races ?? []).filter((r) => finishedIds.has(r.race_id));
  const missing = finishedRaces.filter((r) => !exhibitionIds.has(r.race_id));

  const gapRate =
    finishedRaces.length === 0 ? 0 : missing.length / finishedRaces.length;
  const gapRatePercent = (gapRate * 100).toFixed(1);

  const summary = `${date}: 結果確定${finishedRaces.length}件中、展示データ欠落${missing.length}件（欠落率${gapRatePercent}%）`;

  if (gapRate <= GAP_RATE_ALERT_THRESHOLD) {
    console.log(`OK: ${summary}`);
    process.exit(0);
  }

  console.log(
    `${summary}\n閾値（${GAP_RATE_ALERT_THRESHOLD * 100}%）を超過\n欠落レース例: ${missing
      .slice(0, 10)
      .map((r) => r.race_id)
      .join(", ")}`,
  );
  process.exit(1);
}

main().catch((error) => {
  console.error("❌ check-exhibition-gap-rate 実行中にエラー:", error.message);
  process.exit(1);
});
