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
  /officialModeSourceNote", \{\s*\/\/[^\n]*\n[\s\S]*?venueCols: \[\s*showFirstPlaceRate &&\s*"analysis\.motor\.firstPlaceRateHeader"/.test(
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

for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: 縦軸の名前が「出現率」でない（2連率・3連率を指す）`,
    !/出現率|Occurrence|出現率|출현율/.test(motor.yAxis),
  );
  check(
    `${lang}: 出典注記が {{venueCols}} を受け取り、見出し・区切り・更新遅れの注記・使用履歴の期間がある`,
    motor.officialModeSourceNote.includes("{{venueCols}}") &&
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
