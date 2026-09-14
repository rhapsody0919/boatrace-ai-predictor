/**
 * verify-venue-motor-stats-drift-detection.js - BOA-285の構造変化検知ロジック
 * （scripts/lib/venueMotorStats/driftHealth.js）の回帰テスト。
 * 実際のHTTPリクエスト・DBアクセスは行わず、純関数を合成データで検証する。
 */
import {
  updateVenueHealth,
  findDriftAlerts,
  STRUCTURAL_DRIFT_REASONS,
  DRIFT_ALERT_THRESHOLD_DAYS,
} from "../lib/venueMotorStats/driftHealth.js";

let failures = 0;
function check(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  if (!pass) {
    failures++;
    console.error(
      `❌ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  } else {
    console.log(`✅ ${label}`);
  }
}

// ①成功したら連続失敗日数がリセットされる
{
  const afterFail = updateVenueHealth(undefined, {
    success: false,
    reason: "motor_stats_table_not_found",
    date: "2026-09-01",
  });
  check("失敗直後は連続1日", afterFail.consecutiveFailDays, 1);

  const afterSuccess = updateVenueHealth(afterFail, {
    success: true,
    reason: null,
    date: "2026-09-02",
  });
  check("成功でリセットされる", afterSuccess.consecutiveFailDays, 0);
  check("成功時はlastReasonもnull", afterSuccess.lastReason, null);
}

// ②同じ構造的理由で失敗し続けるとカウントが積み上がる
{
  let entry;
  for (let i = 0; i < 5; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "unexpected_table_header",
      date: `2026-09-0${i + 1}`,
    });
  }
  check("5日連続失敗でカウント5", entry.consecutiveFailDays, 5);
}

// ③閾値未満ではアラート対象にならない（唐津の実例＝新モーター切替期間中の
// 短期間の構造的失敗を誤検知しないことを確認する）
{
  let entry;
  for (let i = 0; i < DRIFT_ALERT_THRESHOLD_DAYS - 1; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "motor_stats_table_not_found",
      date: `day${i}`,
    });
  }
  const alerts = findDriftAlerts({ 23: entry });
  check("閾値-1日ではアラート無し（切替期間中の誤検知防止）", alerts.length, 0);
}

// ④閾値以上・構造的理由ならアラート対象になる
{
  let entry;
  for (let i = 0; i < DRIFT_ALERT_THRESHOLD_DAYS; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "motor_stats_table_not_found",
      date: `day${i}`,
    });
  }
  const alerts = findDriftAlerts({ 7: entry });
  check("閾値到達でアラート1件", alerts.length, 1);
  check("アラート対象の会場コード", alerts[0]?.venueCode, "7");
}

// ⑤閾値以上でも、構造的理由でない（http_5xx等の一時的障害）はアラート対象外
{
  let entry;
  for (let i = 0; i < DRIFT_ALERT_THRESHOLD_DAYS + 5; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "http_503",
      date: `day${i}`,
    });
  }
  const alerts = findDriftAlerts({ 22: entry });
  check("http_503が長期間続いても構造変化アラートにはしない", alerts.length, 0);
}

// ⑥宮島のPDF解析失敗は動的な文字列（pdf_parse_error: <詳細>）だが、前方一致で
// 構造起因として検知できる
{
  let entry;
  for (let i = 0; i < DRIFT_ALERT_THRESHOLD_DAYS; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "pdf_parse_error: bad XRef entry",
      date: `day${i}`,
    });
  }
  const alerts = findDriftAlerts({ 17: entry });
  check(
    "pdf_parse_error(動的文字列)も前方一致でアラート対象になる",
    alerts.length,
    1,
  );
}

// ⑦蒲郡のtable_not_found（table要素自体が無い）も構造起因として検知できる
{
  let entry;
  for (let i = 0; i < DRIFT_ALERT_THRESHOLD_DAYS; i++) {
    entry = updateVenueHealth(entry, {
      success: false,
      reason: "table_not_found",
      date: `day${i}`,
    });
  }
  const alerts = findDriftAlerts({ 7: entry });
  check("table_not_foundもアラート対象になる", alerts.length, 1);
}

// ⑧STRUCTURAL_DRIFT_REASONSに含まれる理由のみがアラート対象という前提の確認
{
  check(
    "STRUCTURAL_DRIFT_REASONSに主要な構造起因reasonが揃っている",
    STRUCTURAL_DRIFT_REASONS.includes("motor_stats_table_not_found") &&
      STRUCTURAL_DRIFT_REASONS.includes("motor_number_column_not_found") &&
      STRUCTURAL_DRIFT_REASONS.includes("unexpected_table_header") &&
      STRUCTURAL_DRIFT_REASONS.includes("pdf_link_not_found"),
    true,
  );
}

console.log(`\n${failures === 0 ? "✅ 全て合格" : `❌ ${failures}件失敗`}`);
process.exit(failures === 0 ? 0 : 1);
