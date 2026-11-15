// データ健全性レポートのMarkdown描画。data-health-report.js から移しただけ（出力は1字も変えない）。

import { DETECTION_LAG } from "../lib/scrapeJobs/expectedUnpublished.js";
import {
  WINDOW_DAYS,
  WINDOW_MINUTES,
  EXPECTED_UNPUBLISHED_MINUTES,
  KNOWN_INCIDENTS,
  LATER_WINDOW_MINUTES,
  formatPct,
  rate,
  tableHeader,
  tableRow,
  weekdayOf,
} from "./dataHealthReportConfig.js";

export function renderWindowsAggregate(report) {
  const lines = [];
  lines.push(
    `## 2. 窓内取得率（締切=発走時刻、窓の中心±3分、直近${WINDOW_DAYS}日）`,
  );
  lines.push("");
  lines.push(
    "障害期間の除外: " +
      (KNOWN_INCIDENTS.length === 0
        ? "なし"
        : KNOWN_INCIDENTS.map(
            (i) =>
              `${i.label} ${i.start}〜${i.end}（窓が重なる(レース,窓)を除外）`,
          ).join(" / ")),
  );
  lines.push("");
  lines.push(
    "想定内の未公開の除外（BOA-386）: 各会場・日の第1レースの" +
      `${EXPECTED_UNPUBLISHED_MINUTES}分前の窓が窓内に取れておらず、後続の窓（${LATER_WINDOW_MINUTES.join("・")}分前）のどれかに取れているもの（後で公開された）を、分母から外した値を「全体(想定内の未公開を除外)」に出す。閾値の判定はこの値で行う。外した件数は「想定内の未公開」に別に出す。後続の窓にも取れていない第1レースは、除外しない（本当に取れていない）`,
  );
  lines.push("");
  lines.push(
    tableHeader([
      "窓",
      "全体(除外なし)",
      "全体(想定内の未公開を除外)",
      "想定内の未公開",
      "全体(障害期間を除外)",
      "障害期間の除外件数",
      "平日(除外なし)",
      "土日(除外なし)",
    ]),
  );
  for (const w of report.windows.aggregate) {
    const wd = report.windows.weekday.find(
      (x) => x.minutesBefore === w.minutesBefore,
    );
    const we = report.windows.weekend.find(
      (x) => x.minutesBefore === w.minutesBefore,
    );
    const cell = (x) => `${formatPct(x.rate)} (${x.inWindow}/${x.races})`;
    lines.push(
      tableRow([
        `${w.minutesBefore}分前`,
        cell(w),
        `${formatPct(w.rateAdjusted)} (${w.inWindow}/${w.racesAdjusted})${w.belowThreshold ? " (未達)" : ""}`,
        w.structural,
        `${formatPct(w.rateClean)} (${w.inWindowClean}/${w.racesClean})`,
        w.excludedRaces,
        cell(wd),
        cell(we),
      ]),
    );
  }
  lines.push("");
  return lines;
}

export function renderFirstRaceWindow(report) {
  const lines = [];
  const m60 = report.windows.aggregate.find(
    (w) => w.minutesBefore === EXPECTED_UNPUBLISHED_MINUTES,
  );
  lines.push(
    `### 第1レースの${EXPECTED_UNPUBLISHED_MINUTES}分前の窓（想定内の未公開）`,
  );
  lines.push("");
  lines.push(
    tableHeader([
      "日付",
      "第1レース(件)",
      "窓内",
      "窓内取得率",
      "想定内の未公開",
      "取れていない(後続の窓にも無い)",
    ]),
  );
  for (const date of [...new Set(report.windows.perDay.map((r) => r.d))]) {
    const row = report.windows.perDay.find(
      (r) => r.d === date && Number(r.m) === EXPECTED_UNPUBLISHED_MINUTES,
    );
    if (!row) continue;
    const first = Number(row.first_race ?? 0);
    const inWin = Number(row.first_race_in_window ?? 0);
    const structural = Number(row.structural ?? 0);
    lines.push(
      tableRow([
        `${date}(${weekdayOf(date)})`,
        first,
        inWin,
        formatPct(rate(inWin, first)),
        structural,
        first - inWin - structural,
      ]),
    );
  }
  if (m60) {
    lines.push(
      tableRow([
        "合計",
        m60.firstRace,
        m60.firstRaceInWindow,
        formatPct(rate(m60.firstRaceInWindow, m60.firstRace)),
        m60.structural,
        m60.firstRace - m60.firstRaceInWindow - m60.structural,
      ]),
    );
  }
  lines.push("");
  return lines;
}

export function renderDetectionLag(report) {
  const lines = [];
  const lag = report.detectionLag;
  lines.push(
    `### 発売開始の検知の遅れ（想定内の未公開のレース。基準: ${DETECTION_LAG.thresholdMin}分以内の割合${DETECTION_LAG.rate * 100}%以上）`,
  );
  lines.push("");
  lines.push(
    "監視と同じ定義で予定表(scrape_slots)から計測（延長で取得した場合は平均の試行間隔、後続の窓で取得した場合は直前の未公開の試行から成功までの差）",
  );
  lines.push("");
  if (lag && lag.total > 0) {
    lines.push(
      tableHeader([
        `${DETECTION_LAG.thresholdMin}分以内`,
        "対象",
        "割合",
        "p50",
        "p95",
        "最大",
        "計測不能",
      ]),
    );
    lines.push(
      tableRow([
        lag.within,
        lag.measured,
        formatPct(lag.rate),
        lag.p50Min !== null ? `${lag.p50Min}分` : "-",
        lag.p95Min !== null ? `${lag.p95Min}分` : "-",
        lag.maxMin !== null ? `${lag.maxMin}分` : "-",
        lag.unmeasured,
      ]),
    );
    if (lag.belowThreshold) {
      lines.push("");
      lines.push(
        `(未達: ${formatPct(lag.rate)} < ${DETECTION_LAG.rate * 100}%)`,
      );
    }
  } else {
    lines.push("（対象レース0件）");
  }
  lines.push("");
  return lines;
}

export function renderWindowsDaily(report) {
  const lines = [];
  lines.push("### 日別の窓内取得率");
  lines.push("");
  lines.push(
    tableHeader([
      "日付",
      ...WINDOW_MINUTES.map((m) => `${m}分前`),
      "対象レース",
    ]),
  );
  for (const date of [...new Set(report.windows.perDay.map((r) => r.d))]) {
    const ofDay = report.windows.perDay.filter((r) => r.d === date);
    const cells = WINDOW_MINUTES.map((m) => {
      const row = ofDay.find((r) => Number(r.m) === m);
      return formatPct(
        row ? rate(Number(row.in_window), Number(row.races)) : null,
      );
    });
    lines.push(
      tableRow([`${date}(${weekdayOf(date)})`, ...cells, ofDay[0].races]),
    );
  }
  return lines;
}

export function renderWindowsExcludedDaily(report) {
  const lines = [];
  const excludedDays = [
    ...new Set(
      report.windows.perDay
        .filter((r) => Number(r.races) !== Number(r.races_clean))
        .map((r) => r.d),
    ),
  ];
  if (excludedDays.length > 0) {
    lines.push("");
    lines.push(
      "### 日別の窓内取得率（障害期間を除外した値。除外があった日のみ）",
    );
    lines.push("");
    lines.push(
      tableHeader([
        "日付",
        ...WINDOW_MINUTES.map((m) => `${m}分前`),
        "除外件数(窓別)",
      ]),
    );
    for (const date of excludedDays) {
      const ofDay = report.windows.perDay.filter((r) => r.d === date);
      const rowOf = (m) => ofDay.find((r) => Number(r.m) === m);
      lines.push(
        tableRow([
          `${date}(${weekdayOf(date)})`,
          ...WINDOW_MINUTES.map((m) =>
            formatPct(
              rate(
                Number(rowOf(m).in_window_clean),
                Number(rowOf(m).races_clean),
              ),
            ),
          ),
          WINDOW_MINUTES.map(
            (m) => Number(rowOf(m).races) - Number(rowOf(m).races_clean),
          ).join("/"),
        ]),
      );
    }
  }
  return lines;
}

export function renderWindowsCompare(report) {
  const lines = [];
  if (report.windows.compare) {
    lines.push("");
    lines.push(
      `参考（${report.windows.compare.dates.join("・")}のみで再集計）`,
    );
    lines.push("");
    lines.push(tableHeader(["窓", "取得率", "件数"]));
    for (const w of report.windows.compare.aggregate) {
      lines.push(
        tableRow([
          `${w.minutesBefore}分前`,
          formatPct(w.rate),
          `${w.inWindow}/${w.races}`,
        ]),
      );
    }
  }
  lines.push("");
  return lines;
}
