#!/usr/bin/env node
/**
 * GitHub Actions（race-notices-drift-monitor.yml）から日次で呼ばれる、
 * レース特記事項ページ（FR-1、BOA-318/319/320）のHTML構造変化検知。
 *
 * api/cron/race-notices.js はVercel Functionとして10分間隔で実行され、
 * ファイルシステムへの永続化・git commitができないため、
 * scripts/daily/scrape-race-information.js が会場×日付単位の当日集計を
 * race_notices_health テーブル（Supabase）に書き込む。本スクリプトは
 * 直近日数分をSupabaseから読み、driftHealth.js（BOA-285）のコアロジック
 * （updateVenueHealth/findDriftAlerts）で連続構造起因失敗日数を畳み込んで判定する。
 * 新規のHTTPリクエストは行わない。
 */
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getDateDaysAgo } from "../lib/dateUtils.js";
import {
  updateVenueHealth,
  findDriftAlerts,
  DRIFT_ALERT_THRESHOLD_DAYS,
} from "../lib/venueMotorStats/driftHealth.js";

// 閾値日数より十分長い期間を見て、日次実行の抜け（非開催日等）があっても
// 連続日数を正しく畳み込めるようにする
const LOOKBACK_DAYS = DRIFT_ALERT_THRESHOLD_DAYS + 10;

async function main() {
  if (!isSupabaseEnabled()) {
    console.log("Supabase未設定のため今回はチェックをスキップします。");
    process.exit(0);
  }

  const sinceDate = getDateDaysAgo(LOOKBACK_DAYS);
  const { data, error } = await supabase
    .from("race_notices_health")
    .select("venue_code,check_date,had_success,last_reason")
    .gte("check_date", sinceDate)
    .order("check_date", { ascending: true });

  if (error) {
    console.error("race_notices_health取得エラー:", error.message);
    process.exit(0); // 監視自体の障害で誤アラートしない
  }

  if (!data || data.length === 0) {
    console.log("履歴データがまだありません。今回はチェックをスキップします。");
    process.exit(0);
  }

  const health = {};
  for (const row of data) {
    const key = String(row.venue_code);
    health[key] = updateVenueHealth(health[key], {
      success: row.had_success,
      reason: row.had_success ? null : row.last_reason,
      date: row.check_date,
    });
  }

  const alerts = findDriftAlerts(health);
  if (alerts.length === 0) {
    console.log("✅ 構造変化の疑いがある会場はありません。");
    process.exit(0);
  }

  const lines = alerts.map(
    (a) =>
      `${VENUE_NAMES[a.venueCode] ?? `会場コード${a.venueCode}`}: ${a.lastReason} が ${a.consecutiveFailDays}日連続`,
  );
  console.log(lines.join("\n"));
  process.exit(1);
}

main();
