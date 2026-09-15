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
 * （updateVenueHealth、履歴の畳み込み）を再利用して連続失敗日数を算出する。
 *
 * ただしdriftHealth.js の findDriftAlerts / STRUCTURAL_DRIFT_REASONS は
 * venue_motor_stats固有のreasonコード（"motor_stats_table_not_found"等）に
 * 決め打ちされており、本FRのreasonコード（"notice_section_not_found"等）とは
 * 語彙が異なるため、そのままでは一致せず一切アラートが飛ばない
 * （ADR-0059に明記の通り、reasonコード分類はスクレイパーごとに個別定義が必要）。
 * そのため findDriftAlerts 相当のフィルタ・整形ロジックのみ、本FR用の
 * reasonコード分類で再定義する（updateVenueHealthの履歴管理コアと
 * DRIFT_ALERT_THRESHOLD_DAYSはそのまま再利用）。新規のHTTPリクエストは行わない。
 */
import {
  supabase,
  isSupabaseEnabled,
  VENUE_NAMES,
} from "../lib/supabaseClient.js";
import { getDateDaysAgo } from "../lib/dateUtils.js";
import {
  updateVenueHealth,
  DRIFT_ALERT_THRESHOLD_DAYS,
} from "../lib/venueMotorStats/driftHealth.js";

// race-notices（scripts/daily/scrape-race-information.js）が返しうる、
// HTML構造が変わった可能性を示すreasonコード。http_5xxやtimeout等の一時的な
// 障害は対象外とする（driftHealth.jsのSTRUCTURAL_DRIFT_REASONSと同じ考え方）
const RACE_NOTICES_STRUCTURAL_DRIFT_REASONS = new Set([
  "notice_section_not_found",
  "unexpected_section_count",
]);

function isRaceNoticesStructuralDriftReason(reason) {
  return reason != null && RACE_NOTICES_STRUCTURAL_DRIFT_REASONS.has(reason);
}

/**
 * driftHealth.js の findDriftAlerts と同じ形（会場×連続失敗日数×reason）で
 * 返すが、フィルタ条件は本FR用の isRaceNoticesStructuralDriftReason を使う
 */
function findRaceNoticesDriftAlerts(health) {
  return Object.entries(health)
    .filter(
      ([, entry]) =>
        entry.consecutiveFailDays >= DRIFT_ALERT_THRESHOLD_DAYS &&
        isRaceNoticesStructuralDriftReason(entry.lastReason),
    )
    .map(([venueCode, entry]) => ({
      venueCode,
      consecutiveFailDays: entry.consecutiveFailDays,
      lastReason: entry.lastReason,
    }));
}

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

  const alerts = findRaceNoticesDriftAlerts(health);
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
