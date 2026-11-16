// データ健全性レポートの閾値アラート。data-health-report.js から移しただけ（判定・文言・順序は変えない）。

import {
  COVERAGE_THRESHOLD,
  WINDOW_THRESHOLD,
} from "./dataHealthReportConfig.js";
import { DETECTION_LAG } from "../lib/scrapeJobs/expectedUnpublished.js";

/** 分母に入れなかったレースの内訳（分母外を、欠損に混ぜずに明示する）。無ければ空文字 */
export function describeOutOfDenominator(m, rankDetail) {
  const parts = [];
  if (m.since !== null && m.notApplicableRaces > 0) {
    parts.push(
      `対象外(取得開始前。${m.since}より前の${m.notApplicableDays}日) ${m.notApplicableRaces}レース`,
    );
  }
  if (m.metric === "rank4_6") {
    parts.push(
      `判定不能 ${rankDetail.undeterminedRaces}レース・完走3艇以下 ${rankDetail.finishersAtMost3Races}レース・結果なし ${rankDetail.noResultRaces}レース`,
    );
  }
  return parts.length === 0 ? "" : `、分母外: ${parts.join("・")}`;
}

function coverageAlerts(report) {
  const alerts = [];
  const rankDetail = report.coverage.rankDetail;
  for (const m of report.coverage.aggregate) {
    if (m.belowThreshold) {
      alerts.push({
        kind: "coverage",
        item: `存在充足率 ${m.label}`,
        value: m.rate,
        threshold: COVERAGE_THRESHOLD,
        detail: `${m.numerator}/${m.denominator}、閾値未満の日 ${m.daysBelowThreshold}日${describeOutOfDenominator(m, rankDetail)}`,
      });
    }
  }
  // 判定不能（完走艇数を確定できず、欠損か非完走かを区別できない）を全て欠損とみなしても閾値を割らないかを見る
  if (
    rankDetail.undeterminedRaces > 0 &&
    (rankDetail.lowerBoundRate === null ||
      rankDetail.lowerBoundRate < COVERAGE_THRESHOLD)
  ) {
    alerts.push({
      kind: "rank_undetermined",
      item: "着順4位以降: 判定不能を全て欠損とした場合(下限)",
      value: rankDetail.lowerBoundRate,
      threshold: COVERAGE_THRESHOLD,
      detail: `判定不能 ${rankDetail.undeterminedRaces}レース（分母外。艇別の着欄が未保存で、欠損か非完走か区別できない。うちST・展示が5艇分以下=欠場の可能性が高い ${rankDetail.undeterminedAbsentHintRaces}レース）`,
    });
  }
  return alerts;
}

function windowAlerts(report) {
  const alerts = [];
  for (const w of report.windows.aggregate) {
    if (w.belowThreshold) {
      alerts.push({
        kind: "window",
        item: `窓内取得率 ${w.minutesBefore}分前`,
        value: w.rateAdjusted,
        threshold: WINDOW_THRESHOLD,
        detail: `${w.inWindow}/${w.racesAdjusted}${w.structural > 0 ? `（想定内の未公開 ${w.structural}件を分母から除外。除外なしは${w.inWindow}/${w.races}）` : ""}`,
      });
    }
  }
  if (report.detectionLag?.belowThreshold) {
    const lag = report.detectionLag;
    alerts.push({
      kind: "detection_lag",
      item: "発売開始の検知の遅れ",
      value: lag.rate,
      threshold: DETECTION_LAG.rate,
      detail: `${DETECTION_LAG.thresholdMin}分以内 ${lag.within}/${lag.measured}（p95 ${lag.p95Min ?? "-"}分・最大 ${lag.maxMin ?? "-"}分、計測不能 ${lag.unmeasured}件）`,
    });
  }
  return alerts;
}

function monthlyAlerts(report) {
  const alerts = [];
  for (const m of report.monthlyResults) {
    if (m.belowThreshold) {
      alerts.push({
        kind: "monthly_result",
        item: `月別結果充足率 ${m.month}`,
        value: m.rateExcludingCancelled,
        threshold: COVERAGE_THRESHOLD,
        detail: `${m.withResult}/${m.denominator}（中止除外${m.excluded}件）`,
      });
    }
  }
  return alerts;
}

function emptyTableAlerts(report) {
  const alerts = [];
  for (const f of report.freshness) {
    if (f.empty) {
      alerts.push({
        kind: "empty_table",
        item: `空: ${f.table}`,
        value: 0,
        threshold: null,
        detail: "0件",
      });
    }
  }
  return alerts;
}

function workflowAlerts(report) {
  const alerts = [];
  for (const w of report.workflows.items) {
    const alert = (kind, item, detail) =>
      alerts.push({ kind, item, value: null, threshold: null, detail });
    if (w.error) {
      alert("workflow_check_failed", `取得失敗: ${w.workflow}`, w.error);
    } else if (w.noRunHistory) {
      alert("workflow_never_ran", `実行履歴0件: ${w.workflow}`, "");
    } else {
      if (
        ["failure", "cancelled", "timed_out", "startup_failure"].includes(
          w.lastRunConclusion,
        )
      ) {
        alert(
          "workflow_last_run_failed",
          `最終実行が失敗: ${w.workflow}`,
          `${w.lastRunConclusion}（${w.lastRunAt}）`,
        );
      }
      if (w.lastSuccessAt === null) {
        alert(
          "workflow_never_succeeded",
          `successの履歴なし: ${w.workflow}`,
          "",
        );
      } else if (
        w.expectedMaxSuccessHours !== null &&
        w.hoursSinceLastSuccess > w.expectedMaxSuccessHours
      ) {
        alert(
          "workflow_stale",
          `最終successが古い: ${w.workflow}`,
          `${w.hoursSinceLastSuccess}時間前（許容${w.expectedMaxSuccessHours}時間、cron式からの推定）`,
        );
      }
    }
  }
  return alerts;
}

function noDataAlerts(report) {
  const alerts = [];
  const noDataDays = [
    ...report.coverage.missingDates.map((d) => `存在充足率: ${d}`),
    ...report.windows.missingDates.map((d) => `窓内取得率: ${d}`),
  ];
  if (noDataDays.length > 0) {
    alerts.push({
      kind: "no_data_days",
      item: "対象レースが0件の日",
      value: null,
      threshold: null,
      detail: noDataDays.join(", "),
    });
  }
  return alerts;
}

function timingAlerts(report) {
  const alerts = [];
  for (const t of report.timingColumns) {
    if (t.unmeasurable) {
      alerts.push({
        kind: "timing_unmeasurable",
        item: `タイミング計測不能: ${t.table}`,
        value: null,
        threshold: null,
        detail:
          t.quality === "table_missing"
            ? "テーブル不在"
            : t.quality === "weak"
              ? `取得時刻列なし（${t.columns.join("/")}のみ）`
              : "時刻列なし",
      });
    }
  }
  return alerts;
}

export function collectAlerts(report) {
  return [
    ...coverageAlerts(report),
    ...windowAlerts(report),
    ...monthlyAlerts(report),
    ...emptyTableAlerts(report),
    ...workflowAlerts(report),
    ...noDataAlerts(report),
    ...timingAlerts(report),
  ];
}
