// データ健全性レポートのMarkdown描画。data-health-report.js から移しただけ（出力は1字も変えない）。

import { COVERAGE_METRICS } from "../lib/dataHealth/coverageSpec.js";
import { describeOutOfDenominator } from "./dataHealthReportAlerts.js";
import {
  renderDetectionLag,
  renderFirstRaceWindow,
  renderWindowsAggregate,
  renderWindowsCompare,
  renderWindowsDaily,
  renderWindowsExcludedDaily,
} from "./dataHealthReportMarkdownWindows.js";
import {
  renderDbSize,
  renderFreshness,
  renderMonthly,
  renderNotes,
  renderScrapedTimestamps,
  renderTimingColumns,
  renderWorkflows,
} from "./dataHealthReportMarkdownTail.js";
import {
  COVERAGE_DAYS,
  COVERAGE_THRESHOLD,
  WINDOW_DAYS,
  WINDOW_THRESHOLD,
  formatPct,
  isApplicableDay,
  metricDenominator,
  rate,
  tableHeader,
  tableRow,
  weekdayOf,
} from "./dataHealthReportConfig.js";

function renderHeader(params) {
  const lines = [];
  lines.push(`# データ健全性レポート ${params.reportDate}`);
  lines.push("");
  lines.push(
    `- 存在充足率の期間: ${params.coverage.start}〜${params.coverage.end}（${COVERAGE_DAYS}日。当日は結果未確定のため含めない）`,
  );
  lines.push(
    `- 窓内取得率の期間: ${params.windows.start}〜${params.windows.end}（${WINDOW_DAYS}日、土日${params.windows.weekendDays}日を含む）`,
  );
  if (params.windows.weekendDays === 0) {
    lines.push(
      "- 警告: 窓内取得率の期間に土日が含まれていない。完了の定義Bの根拠にならない",
    );
  }
  lines.push(
    `- 分母: 開催中止(cancellation_status='confirmed')を除外。閾値: 存在充足率${COVERAGE_THRESHOLD * 100}%、窓内取得率${WINDOW_THRESHOLD * 100}%`,
  );
  lines.push("");
  return lines;
}

function renderAlertTable(report) {
  const lines = [];
  lines.push("## 閾値未達・要注意項目");
  lines.push("");
  if (report.alerts.length === 0) {
    lines.push("なし");
  } else {
    lines.push(tableHeader(["区分", "項目", "値", "閾値", "詳細"]));
    for (const a of report.alerts) {
      lines.push(
        tableRow([
          a.kind,
          a.item,
          a.value === null ? "-" : formatPct(a.value),
          a.threshold === null ? "-" : formatPct(a.threshold),
          a.detail,
        ]),
      );
    }
  }
  lines.push("");
  return lines;
}

function renderCoverageSummary(report) {
  const lines = [];
  lines.push(`## 1. 存在充足率（直近${COVERAGE_DAYS}日の合計）`);
  lines.push("");
  const agg = report.coverage.aggregate;
  const rankDetail = report.coverage.rankDetail;
  lines.push(
    `分母（中止除外後）${agg[0].denominator}レース、除外（開催中止）${agg[0].excluded}レース。` +
      "指標ごとに分母が異なるものは、「分母」列にその指標の分母を出し、「分母外」列に外したレースの内訳を出す",
  );
  lines.push("");
  lines.push(
    tableHeader([
      "指標",
      "充足",
      "分母",
      "充足率",
      "閾値未満の日数",
      "最低の日",
      "分母外",
    ]),
  );
  const outOfDenominator = (m) =>
    describeOutOfDenominator(m, rankDetail).replace(/^、分母外: /, "") || "-";
  for (const m of agg) {
    lines.push(
      tableRow([
        m.label,
        m.numerator,
        m.denominator,
        m.rate === null && !m.belowThreshold
          ? "対象外"
          : `${formatPct(m.rate)}${m.belowThreshold ? " (未達)" : ""}`,
        m.daysBelowThreshold,
        m.worstDay ? `${m.worstDay.date} ${formatPct(m.worstDay.rate)}` : "-",
        outOfDenominator(m),
      ]),
    );
  }
  lines.push("");
  return lines;
}

function renderRankDetail(report) {
  const lines = [];
  const rankDetail = report.coverage.rankDetail;
  lines.push("### 1-2. 着順4位以降の判定の内訳（BOA-381）");
  lines.push("");
  lines.push(
    "失格・欠場・転覆などで6艇が完走しないレースは、公式が最後の順位を付けない（rank6・rank5・rank4がNULLで正しい）ため、" +
      "完走艇数から「順位が付くべき最大順位」を決めて判定する。完走艇数は艇別の着欄（race_start_timings.finish_mark、マイグレーション077）が6艇分そろったレースだけ確定できる。",
  );
  lines.push("");
  lines.push(tableHeader(["区分", "レース数", "扱い"]));
  for (const row of [
    [
      "完走艇数を確定（着欄あり、完走4艇以上）",
      rankDetail.determinedRaces,
      "分母。完走艇数まで順位が付いていれば充足",
    ],
    [
      "着欄は未確定・rank4〜6がそろっている",
      rankDetail.fullRaces,
      "分母・充足（そろっていれば欠損ではない）",
    ],
    [
      "判定不能（着欄は未確定・rank4〜6に欠けあり）",
      rankDetail.undeterminedRaces,
      "分母外。欠損か非完走かを区別できない。着欄の取得（結果ページの再取得・K/Bの取り込み）で確定する",
    ],
    [
      "　└ うちST・展示が5艇分以下",
      rankDetail.undeterminedAbsentHintRaces,
      "欠場艇がいる可能性が高い（目安。確定ではない）",
    ],
    [
      "完走3艇以下（着欄あり）",
      rankDetail.finishersAtMost3Races,
      "分母外（rank4以降は付かない）",
    ],
    [
      "結果なし（rank1が無い）",
      rankDetail.noResultRaces,
      "分母外（「結果(rank1)」の指標で計上）",
    ],
  ]) {
    lines.push(tableRow(row));
  }
  lines.push("");
  lines.push(
    `- 充足率: ${rankDetail.numerator}/${rankDetail.denominator} = ${formatPct(rate(rankDetail.numerator, rankDetail.denominator))}。判定不能を全て欠損とみなした場合の下限: ${formatPct(rankDetail.lowerBoundRate)}（分母に判定不能${rankDetail.undeterminedRaces}レースを加えて算出）`,
  );
  lines.push(
    `- 変更前の定義（中止除外後の全レースを分母に、rank4・5・6がすべてある）: ${rankDetail.legacyDefinition.numerator}/${rankDetail.legacyDefinition.denominator} = ${formatPct(rankDetail.legacyDefinition.rate)}`,
  );
  lines.push(
    `- 参考（BOA-362。順位に非完走艇が入っているレース）: 確定（着欄で、完走艇数より多くの順位が付いている）${rankDetail.pollutedConfirmedRaces}レース、疑い（着欄が未確定で6着まで付いているが展示タイムが5艇分以下。展示の欠損も含む上限値）${rankDetail.absentSuspectRaces}レース`,
  );
  lines.push("");
  return lines;
}

function renderCoverageDaily(report) {
  const lines = [];
  lines.push("### 日別の存在充足率");
  lines.push("");
  const dayMetrics = [
    "result",
    "rank4_6",
    "actual_course",
    "winning_technique",
    "race_stage",
    "st_row",
    "st_value",
    "exhibition_row",
    "exhibition_time",
    "odds",
    "odds_all",
  ];
  lines.push(
    tableHeader([
      "日付",
      "総数",
      "除外",
      "分母",
      ...dayMetrics.map((k) => COVERAGE_METRICS.find((m) => m.key === k).label),
    ]),
  );
  for (const d of report.coverage.perDay) {
    lines.push(
      tableRow([
        `${d.d}(${weekdayOf(d.d)})`,
        d.total,
        d.excluded,
        d.denom,
        ...dayMetrics.map((k) => {
          const metric = COVERAGE_METRICS.find((m) => m.key === k);
          if (!isApplicableDay(metric, d.d)) return "対象外(取得開始前)";
          return formatPct(rate(Number(d[k]), metricDenominator(metric, d)));
        }),
      ]),
    );
  }
  lines.push("");
  return lines;
}

export function renderMarkdown(report) {
  return [
    ...renderHeader(report.params),
    ...renderAlertTable(report),
    ...renderCoverageSummary(report),
    ...renderRankDetail(report),
    ...renderCoverageDaily(report),
    ...renderWindowsAggregate(report),
    ...renderFirstRaceWindow(report),
    ...renderDetectionLag(report),
    ...renderWindowsDaily(report),
    ...renderWindowsExcludedDaily(report),
    ...renderWindowsCompare(report),
    ...renderTimingColumns(report),
    ...renderScrapedTimestamps(report),
    ...renderMonthly(report),
    ...renderFreshness(report),
    ...renderWorkflows(report),
    ...renderDbSize(report),
    ...renderNotes(),
  ].join("\n");
}
