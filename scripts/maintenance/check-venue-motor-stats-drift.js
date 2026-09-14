#!/usr/bin/env node
/**
 * GitHub Actions（scrape-venue-motor-stats.yml）から呼ばれる、会場公式サイトの
 * HTML構造変化検知（BOA-285）。scrape-venue-motor-stats.jsが日次で更新する
 * data/analysis/venue-motor-stats-health.json を読み、構造起因の失敗が
 * 閾値日数以上続いている会場があれば、Slack通知用のテキストをstdoutに出力し
 * exit code 1 を返す（ワークフロー側はexit codeで通知要否を判断する）。
 *
 * 新規のHTTPリクエストは行わない（scrape-venue-motor-stats.jsが同じ
 * ワークフロー実行内で既に取得済みの結果を読むだけ）。
 */
import fs from "node:fs";
import { findDriftAlerts } from "../lib/venueMotorStats/driftHealth.js";
import { VENUE_MOTOR_STATS_CONFIG } from "../lib/venueMotorStats/venueConfig.js";

const HEALTH_FILE_PATH = new URL(
  "../../data/analysis/venue-motor-stats-health.json",
  import.meta.url,
);

function main() {
  let health;
  try {
    health = JSON.parse(fs.readFileSync(HEALTH_FILE_PATH, "utf8"));
  } catch {
    console.log(
      "履歴ファイルが見つかりません。今回はチェックをスキップします。",
    );
    process.exit(0);
  }

  const nameByCode = Object.fromEntries(
    VENUE_MOTOR_STATS_CONFIG.map((v) => [String(v.venueCode), v.name]),
  );

  const alerts = findDriftAlerts(health);
  if (alerts.length === 0) {
    console.log("✅ 構造変化の疑いがある会場はありません。");
    process.exit(0);
  }

  const lines = alerts.map(
    (a) =>
      `${nameByCode[a.venueCode] ?? `会場コード${a.venueCode}`}: ${a.lastReason} が ${a.consecutiveFailDays}日連続`,
  );
  console.log(lines.join("\n"));
  process.exit(1);
}

main();
