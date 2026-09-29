#!/usr/bin/env node
/**
 * verify-motor-tab-readability.js — モータ情報タブ・選手ページのモーター状況の
 * 読みやすさの修正（BOA-513 の文言・不具合の分）を固定する。
 *
 * ## なぜ要るか
 *
 * BOA-329 / BOA-521 のファン評価（2026-09-28〜29）で、次の読み違いが指摘された。
 * どれも値は正しいのに、見せ方で誤読を生む。
 * - 375px で枠番別成績の表の3連率・展示タイム推移の列が切れ、横に動かせることも分からない
 * - 枠番別成績の見出しが「1着率」と「2連率 (%)」で (%) の有無が揃っていない
 * - 過去レースの出典注記が、表に無い「1着率」の列に触れる（戸田など）
 * - 2連率推移の縦軸が「出現率 (%)」で出目の用語に見え、グラフに見出しが無い
 * - 使用履歴のグラフが推移グラフと左右逆で、「右肩下がり＝最近悪化」と読める
 * - 使用履歴に集計期間が書かれていない
 * - 鮮度（◯走目）・1着率などの公式値は節の終わりにしか更新されず、機力指数の走数と合わない
 * - 選手ページの展示タイムのグラフで、同じ日に2回走ると横軸の日付が重複する
 *
 * ## 何を検査するか
 *
 * 画面はブラウザでしか動かないため、ソースと文言を検査する
 * （verify-motor-window-generation.js と同じ方式）。
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatRateOrCount } from "../../src/utils/smallSampleRate.js";
import { officialTallyState } from "../../src/utils/motorGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const chart = read("src/components/analysis/MotorConditionChart.jsx");
const grid = read("src/components/analysis/MotorWakuStatsGrid.jsx");
const card = read("src/components/racer/RacerMotorStatusCard.jsx");
const racerService = read("src/services/racerService.js");

check(
  "枠番別成績の表に、横スクロールの目印（hscroll-hint・›）を付ける",
  grid.includes("useHorizontalScrollHint(") &&
    grid.includes("hscroll-hint") &&
    grid.includes('className="table-scroll"'),
);
check(
  "枠番別成績の見出しは、セルに%が付くので (%) の付かない名前（legend2/legend3）を使う",
  grid.includes('t("analysis.motor.legend2")') &&
    grid.includes('t("analysis.motor.legend3")') &&
    !grid.includes('t("analysis.motor.rate2Header")'),
);
check(
  "使用履歴の2連率ラベルも (%) の付かない名前を使う（「2連率 (%) 66.7%」と二重にしない）",
  !/\{t\("analysis\.motor\.rate2Header"\)\} \{meet\.rate2/.test(chart),
);
check(
  "過去レースの出典注記は、表に出ている会場公式の列だけを挙げる（1着率の列が無ければ触れない）",
  /venueColsLabel = \[\s*showFirstPlaceRate && "analysis\.motor\.firstPlaceRateHeader"/.test(
    chart,
  ),
);
check(
  "2連率・3連率の推移グラフに見出しを付ける",
  chart.includes('t("analysis.motor.rateTrendHeading")'),
);
check(
  "使用履歴のグラフは左が古く右が新しい（推移グラフと同じ向き）",
  /usageHistoryChartData = \[\.\.\.usageHistory\]\s*\.reverse\(\)/.test(chart),
);
check(
  "公式サイトのスナップショット（鮮度・順位・1着率・優出・優勝）の更新が遅れる旨を注記する",
  chart.includes('t("analysis.motor.officialSnapshotNote")'),
);
check(
  "選手ページ: 同じ日に2回走った日は、横軸にレース番号を添える",
  racerService.includes("raceNo: Number(e.race_id.slice(-2))") &&
    card.includes("runsOnDate.get(row.date) > 1"),
);
check(
  "選手ページ: 説明文の「）」と「、」の間に空白を入れない（1つのテンプレート文字列で組む）",
  /\}）、この選手がこのモーターで出走してからの展示タイム`/.test(card),
);

// ---- BOA-513 PR2: ファン4人のパネルで決めた表示（2026-09-29 ユーザー承認） ----
check(
  "formatRateOrCount: n<6 は「該当数/出走数」、6以上は %、出走なしは「-」",
  formatRateOrCount(66.66666, 3, 6) === "2/3" &&
    formatRateOrCount(100, 1, 6) === "1/1" &&
    formatRateOrCount(0, 5, 6) === "0/5" &&
    formatRateOrCount(50, 6, 6) === "50.0%" &&
    formatRateOrCount(null, 0, 6) === "-",
);
check(
  "枠番別成績・選手×枠成績の率を formatRateOrCount で出す（n<6 の率を % で出さない）",
  (grid.match(/formatRateOrCount\(/g) ?? []).length >= 3 &&
    (
      read("src/components/analysis/MotorRacerWakuDrillDown.jsx").match(
        /formatRateOrCount\(/g,
      ) ?? []
    ).length >= 3,
);
check(
  "展示タイムのスパークラインは3点未満なら出さない",
  grid.includes("trend.length < 3) return null"),
);
check(
  "優出数・優勝数は、会場の全モーターで値が無いとき列ごと畳む（見出し・セル・出典注記）",
  chart.includes("showFinalCount && (") &&
    chart.includes("showChampionshipCount && (") &&
    chart.includes('showFinalCount && "analysis.motor.finalCountHeader"') &&
    // 列が1つも無い会場（戸田など）では、列名の文ごと出さない（文が崩れない）
    /\{venueColsLabel &&\s*`\$\{t\(/.test(chart),
);
check(
  "結果の出た走が無い新モーター（sample_count === 0）に「初下ろし」を添える",
  chart.includes("row.sample_count === 0 && (") &&
    chart.includes('t("analysis.motor.firstUseBadge")') &&
    /sample_count: powerIndexes\[i\]\?\.sample_count/.test(
      read("src/services/supabaseDataService.js"),
    ),
);
check(
  "推移グラフは、入れ替え直後の 2連率・3連率とも 0 の先頭の点を描かない",
  /findIndex\(\s*\(row\) => row\.motor_2rate !== 0 \|\| row\.motor_3rate !== 0/.test(
    chart,
  ),
);
{
  const svc = read("src/services/supabaseDataService.js");
  check(
    "部品交換に、交換が記録されたレース番号を添える（キャッシュのキーも上げる）",
    svc.includes("eventRaceNos") &&
      svc.includes("raceNos: d.eventRaceNos") &&
      svc.includes("`motor-daily-series-v3-") &&
      svc.includes("`motor-parts-history-v3-") &&
      chart.includes("event.raceNos.map((n) => `${n}R`)"),
  );
}
// ---- BOA-513 PR2 ファン評価1周目（2026-09-29） ----
// 公式 0/0 が「集計前」か「集計済みの 0%」かは、会場公式の出走数で分ける
// （丸亀24号機は 9/21 に2走とも6着＝集計済みの 0%。2026-09-29 ファン評価 P1）
check(
  "officialTallyState: 会場公式の出走数が1以上なら集計済み、値のある会場で0/無しなら集計前、値の無い会場は不明",
  officialTallyState(true, 2) === "tallied" &&
    officialTallyState(false, 2) === "tallied" &&
    officialTallyState(true, 0) === "pending" &&
    officialTallyState(true, null) === "pending" &&
    officialTallyState(false, null) === "unknown",
);
check(
  "推移グラフ: 全部の点が 0 のとき、集計前なら線を引かず、集計済みなら 0 の線を引き、不明なら断定しない",
  /firstRatedIndex === -1\s*\?\s*drillTallyState === "tallied"/.test(chart) &&
    chart.includes('t("analysis.motor.trendNotYetOfficial")') &&
    chart.includes('t("analysis.motor.trendOfficialZeroUnknown")'),
);
check(
  "推移グラフ: 先頭の 0 を落としたときは、展示タイムと始まりがずれる理由を書く",
  chart.includes("firstRatedIndex > 0 && (") &&
    chart.includes('t("analysis.motor.trendStartNote")'),
);
check(
  "使用履歴: 今日これから走るレースは「未」と出し、欠場等の「-」と区別する",
  /r\.date >= getTodayJST\(\)\s*\?\s*t\("analysis\.motor\.usageHistoryNotRun"\)/.test(
    chart,
  ),
);
check(
  "選手×枠成績: n<6 では (n=◯) を付けない（分数に走数が入る）",
  /\{!isSmallSample && \(\s*<span className="motor-waku-n">/.test(
    read("src/components/analysis/MotorRacerWakuDrillDown.jsx"),
  ),
);
// 公式の 0.0 が「集計前」か「本当に0%」かを区別する（2026-09-29 ファン4人・ユーザー承認）
check(
  "一覧: 公式2連率・3連率がどちらも0で、結果の出た走があり、会場公式の出走数が0（集計前）のときだけ「集計前」を添える（公式の0.0は残す）",
  /isOfficialPending = \(row\) =>\s*Number\(row\.official_2rate\) === 0 &&\s*Number\(row\.official_3rate\) === 0 &&\s*row\.sample_count > 0 &&\s*officialTallyState\(venueHasOfficialStats, row\.race_count\) === "pending"/.test(
    chart,
  ) &&
    chart.includes('t("analysis.motor.officialPendingBadge")') &&
    read("src/services/supabaseDataService.js").includes(
      "official_3rate: row.motor_3rate ?? null",
    ) &&
    read("src/services/supabaseDataService.js").includes(
      "`race-motor-breakdown-v7-",
    ),
);
check(
  "一覧: 「集計前」の印が付く行があるときは、表の下の注記でその意味を書く（ファン評価 P2）",
  /breakdown\.some\(isOfficialPending\) &&\s*t\("analysis\.motor\.officialPendingNote"\)/.test(
    chart,
  ),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  // 「入れ替え後の最初の節」ではなくモーター単位で言う。丸亀は入れ替え後の最初の節が
  // 終わった後も、その後に初めて使われたモーターが集計前になる（ファン評価2周目 P2）
  check(
    `${lang}: 集計前の説明を「入れ替え後の最初の節」でなく、モーターが初めて使われた節で言う`,
    !/入れ替え後の最初の節|first meet since the changeover|更換後第一節|교체 후 첫 절/.test(
      motor.officialPendingNote + motor.trendNotYetOfficial,
    ),
  );
  check(
    `${lang}: 縦軸の名前が「出現率」でない（2連率・3連率を指す）`,
    !/出現率|Occurrence|出現率|출현율/.test(motor.yAxis),
  );
  check(
    `${lang}: 出典注記が {{venueCols}} を受け取り、見出し・区切り・更新遅れの注記・使用履歴の期間がある`,
    !motor.officialModeSourceNote.includes("{{venueCols}}") &&
      motor.venueColsPastNote?.includes("{{venueCols}}") &&
      motor.venueColsTodayNote?.includes("{{venueCols}}") &&
      typeof motor.rateTrendHeading === "string" &&
      motor.quotedLabel?.includes("{{label}}") &&
      typeof motor.quotedLabelSeparator === "string" &&
      typeof motor.officialSnapshotNote === "string" &&
      /90/.test(motor.usageHistoryNote),
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
