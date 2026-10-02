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
import {
  formatPowerIndex,
  formatRateOrCount,
  powerIndexTone,
} from "../../src/utils/smallSampleRate.js";
import { officialTallyState } from "../../src/utils/motorGeneration.js";
import { exhibitionTimeAxis } from "../../src/utils/chartDomain.js";
import { competitionRank } from "../../src/utils/competitionRank.js";

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
    // 2回走った日が1日でもあれば全部の点に付ける（BOA-557。付く点と付かない点が混ざらない）
    card.includes("runsOnDate.values()].some((n) => n > 1)"),
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
  /isOfficialPending = \(row\) =>\s*Number\(row\.official_2rate\) === 0 &&\s*Number\(row\.official_3rate\) === 0 &&\s*\(row\.rate_source === "official" \|\| row\.sample_count > 0\) &&\s*officialTallyState\(venueHasOfficialStats, row\.race_count\) === "pending"/.test(
    chart,
  ) &&
    chart.includes('t("analysis.motor.officialPendingBadge")') &&
    read("src/services/supabaseDataService.js").includes(
      "official_3rate: row.motor_3rate ?? null",
    ) &&
    read("src/services/supabaseDataService.js").includes(
      "`race-motor-breakdown-v8-",
    ),
);
check(
  "一覧: 「集計前」の印が付く行があるときは、表の下の注記でその意味を書く（ファン評価 P2）",
  /breakdown\.some\(isOfficialPending\) &&\s*t\("analysis\.motor\.officialPendingNote"\)/.test(
    chart,
  ),
);
// ---- BOA-549: 走数が少ない機力指数（2026-09-29 ファン4人のパネル） ----
check(
  "powerIndexTone: n<6 は評価せず small、6以上は符号で good/bad/even、値なしは null",
  powerIndexTone(-3.1, 4, 6) === "small" &&
    powerIndexTone(9.5, 5, 6) === "small" &&
    powerIndexTone(9.5, 6, 6) === "good" &&
    powerIndexTone(-0.9, 20, 6) === "bad" &&
    powerIndexTone(0, 20, 6) === "even" &&
    // 丸めて 0.0 になる値は良い・悪いと言わない（丸亀45号機 -0.04 が「低調」と出ていた）
    powerIndexTone(-0.04, 13, 6) === "even" &&
    powerIndexTone(0.04, 13, 6) === "even" &&
    powerIndexTone(0.05, 13, 6) === "good" &&
    powerIndexTone(null, 4, 6) === null,
);
check(
  "機力指数: 一覧・ドリルダウン・選手ページの3か所で powerIndexTone を使い、小標本では評価の言葉を出さない",
  (chart.match(/powerIndexTone\(/g) ?? []).length >= 2 &&
    chart.includes('t("analysis.motor.powerIndexSmallSample")') &&
    card.includes("powerIndexTone(") &&
    card.includes('tone === "small"'),
);
check(
  "グラフ: 縦軸のラベルを縦方向の中央に置き（375px で切れない）、展示タイムの目盛りは小数2桁にそろえる",
  read("src/components/analysis/TrendLineChart.jsx").includes(
    'style: { textAnchor: "middle" }',
  ) && /exhibitionYAxis"\)\}\s*yTickDecimals=\{2\}/.test(chart),
);
{
  // 使用履歴の節ごとの2連率も、着順の付かなかった走を分母に数える（機力指数・枠番別と
  // そろえる。BOA-549、戸田14号機で 4/6 と 22/38 が食い違っていた）
  const svc = read("src/services/supabaseDataService.js");
  const usage = svc.slice(
    svc.indexOf("  getMotorUsageHistory("),
    svc.indexOf("\n  },\n", svc.indexOf("  getMotorUsageHistory(")),
  );
  check(
    "使用履歴: 着順の付かなかった走も、結果の出たレースなら分母に数える（キャッシュのキーも上げる）",
    /\} else if \(isUsableRaceResult\(result\)\) \{\s*n \+= 1;/.test(usage) &&
      usage.includes("race_status") &&
      usage.includes("`motor-usage-history-v4-"),
  );
}
check(
  "formatPowerIndex: 丸めて0になる負の値を「-0.0」と出さない（丸亀45号機 -0.04 → 0.0）",
  formatPowerIndex(-0.04) === "0.0" &&
    formatPowerIndex(12.14) === "+12.1" &&
    formatPowerIndex(-4.1) === "-4.1" &&
    formatPowerIndex(0) === "0.0" &&
    !/power_index > 0 \? "\+" : ""/.test(chart + card),
);
check(
  "一覧: オレンジ色の機力指数がある行があるときは、表の下の注記で意味（6走未満の参考値）を書く",
  chart.includes('t("analysis.motor.powerIndexSmallSampleNote"'),
);
check(
  "選手ページ: 参考値の文言をレースページと同じ「— 走数が少ないため参考値」にそろえる",
  card.includes('" — 走数が少ないため参考値"'),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  // 「入れ替え後の最初の節」ではなくモーター単位で言う。丸亀は入れ替え後の最初の節が
  // 終わった後も、その後に初めて使われたモーターが集計前になる（ファン評価2周目 P2）
  check(
    `${lang}: 集計前の説明を「入れ替え後の最初の節」でなく、モーターが初めて使われた節で言う`,
    !/入れ替え後の最初の節|first meet since the changeover|更換後第一節|교체 후 첫 절/.test(
      motor.officialPendingNote +
        motor.trendNotYetOfficial +
        motor.trendOfficialZeroUnknown,
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
      /90/.test(motor.usageHistoryNote) &&
      // 使用履歴の「-」（着順の付かない走）と「未」の意味・数え方を書く（BOA-549）
      /「-」|"-"/.test(motor.usageHistoryNote) &&
      // 枠番別成績の展示タイムの列が、平均の値と推移の図だと分かる見出し（BOA-549）
      /平均|avg|平均|평균/i.test(motor.exhibitionTrendHeader),
  );
}

// ---- BOA-557（BOA-549 ファン評価の残り） ----
{
  const chart = read("src/components/analysis/MotorConditionChart.jsx");
  const service = read("src/services/supabaseDataService.js");
  const racerCard = read("src/components/racer/RacerMotorStatusCard.jsx");
  const trendChart = read("src/components/analysis/TrendLineChart.jsx");
  // 当日のレースも「このレースの直前まで」。終了後に開くとそのレース自身の結果が入り、
  // 翌日（過去レース扱い）に開いたときと数字が変わっていた
  check(
    "ドリルダウンは当日のレースも「このレースの直前まで」で集計する",
    /const beforeRaceId = selectedRace \?\? null;/.test(chart),
  );
  check(
    "一覧の機力指数も当日のレースは「このレースの直前まで」",
    /this\.getMotorPowerIndex\(\s*venueCode,\s*row\.motor_number,\s*days,\s*raceId,?\s*\)/.test(
      service,
    ),
  );
  check(
    "過去レースの行にも公式3連率がある（「集計前」の判定）",
    /rate_source: "official",[\s\S]{0,200}official_3rate: row\.motor_3rate/.test(
      service,
    ),
  );
  check(
    "「集計前」の判定は、過去レースの行では走数の条件を見ない",
    /row\.rate_source === "official" \|\| row\.sample_count > 0/.test(chart),
  );
  check(
    "過去レースの一覧でも「集計前」の印と注記を出す",
    /officialMode && isOfficialPending\(row\)/.test(chart) &&
      !/!officialMode &&\s*breakdown\.some\(isOfficialPending\)/.test(chart),
  );
  // 展示タイムの縦軸の端は0.2秒の倍数（6.43 / 6.63 … や上端だけ7.10にしない）
  // 範囲だけ渡すと recharts が5本に等分し、幅0.6秒で 6.80/6.95/7.10… になった（ファン評価）
  const axisA = exhibitionTimeAxis([6.86, 7.31]);
  const axisB = exhibitionTimeAxis([6.53, 7.04, null]);
  check(
    "展示タイムの縦軸は端も目盛りも0.2秒刻み（幅0.6秒でも0.15刻みにしない）",
    JSON.stringify(axisA) ===
      JSON.stringify({ domain: [6.8, 7.4], ticks: [6.8, 7, 7.2, 7.4] }) &&
      JSON.stringify(axisB.ticks) === JSON.stringify([6.4, 6.6, 6.8, 7, 7.2]) &&
      exhibitionTimeAxis([null]) === null,
  );
  check(
    "展示タイムのグラフ（モータ情報・選手ページ）が0.2秒刻みの範囲と目盛りを使い、直線でつなぐ",
    [chart, racerCard].every(
      (src) =>
        src.includes("yAxisDomain={exhibitionAxis?.domain}") &&
        src.includes("yTicks={exhibitionAxis?.ticks}") &&
        /dataKey: "exhibition_time",[\s\S]{0,200}type: "linear"/.test(src),
    ) &&
      !/dataMin - 0\.1/.test(chart + racerCard) &&
      /ticks=\{yTicks\}/.test(trendChart),
  );
  check(
    "選手ページの展示タイムも、375pxでラベルを間引かない",
    /yTicks=\{exhibitionAxis\?\.ticks\}\s*\/\/[^\n]*\n\s*slantXLabels/.test(
      racerCard,
    ),
  );
  check(
    "過去レースの3連率の0.0にも「集計前」を付ける",
    /\{row\.motor_3rate\?\.toFixed\(1\)\}[\s\S]{0,300}officialMode && isOfficialPending\(row\)/.test(
      chart,
    ),
  );
  check(
    "「このレースの直前まで」の注記を当日のレースのドリルダウンにも出す",
    /\{selectedRace && \(\s*<p className="table-note">\s*\{t\("analysis\.motor\.drillAsOfRaceNote"\)\}/.test(
      chart,
    ),
  );
  check(
    "使用履歴のグラフは選手名を間引かず、直線でつなぐ",
    /slantXLabels\b/.test(chart) &&
      /interval: 0/.test(trendChart) &&
      !/dataKey: "rate[23]",[\s\S]{0,160}type: "monotone"/.test(
        chart.slice(chart.indexOf("usageHistoryChartData}")),
      ),
  );
  check(
    "選手ページの展示タイムの横軸は、レース番号を全部の点に付けるか全部付けない",
    /hasDoubleRunDay && row\.raceNo/.test(racerCard),
  );
  check(
    "使用履歴のグラフの向きの説明は、グラフが出ているときだけ",
    /usageHistoryChartData\.length > 1 &&\s*` \$\{t\("analysis\.motor\.usageHistoryChartNote"\)\}`/.test(
      chart,
    ),
  );
  // 初出走（直前までの走りが0）の空表示は、取得失敗と区別できる文言にする
  check(
    "初出走のドリルダウンは「データが見つかりません」でなく理由を出す（3か所）",
    /drillFirstRun =\s*powerIndex\?\.sample_count === 0 && usageHistory\.length === 0/.test(
      chart,
    ) &&
      (chart.match(/t\(emptyKey\("analysis\.motor\.[a-zA-Z]+Empty"\)\)/g) ?? [])
        .length === 3,
  );
  // ダークモードでツールチップの見出しが白地に白字にならない
  check(
    "推移グラフのツールチップはテーマの色（背景・文字）を使う",
    /contentStyle=\{\{[\s\S]{0,120}background: "var\(--surface-card\)"/.test(
      trendChart,
    ) && /labelStyle=\{\{ color: "var\(--text-primary\)" \}\}/.test(trendChart),
  );
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 公式値の更新遅れの注記が、当サイトの集計を「最新のレースまで」と言わない`,
      !/最新のレースまで|latest race|至最新比賽|최신 레이스까지/.test(
        motor.officialSnapshotNote,
      ),
    );
    check(
      `${lang}: 使用履歴の注記からグラフの向きの文を分け、別キーにある`,
      typeof motor.usageHistoryChartNote === "string" &&
        !motor.usageHistoryNote.includes(motor.usageHistoryChartNote),
    );
  }
}

// ---- BOA-529: 会場内順位の同値は同じ順位 ----
{
  // 丸亀 2026-09-28 のスナップショット: 11号機の2連率44.4は5基が同値、上に10基
  const values = [
    60, 58, 55, 52, 50, 49, 48, 47, 46, 45, 44.4, 44.4, 44.4, 44.4, 44.4, 40,
  ];
  check(
    "competitionRank: 同値5基・上に10基なら11位で5基タイ（行順に依存しない）",
    JSON.stringify(competitionRank(values, 44.4)) ===
      JSON.stringify({ rank: 11, tied: 5 }) &&
      JSON.stringify(competitionRank([...values].reverse(), 44.4)) ===
        JSON.stringify({ rank: 11, tied: 5 }),
  );
  check(
    "competitionRank: 同値の次は飛ばす（1, 2, 2, 4）",
    competitionRank([9, 8, 8, 7], 7).rank === 4 &&
      competitionRank([9, 8, 8, 7], 8).rank === 2,
  );
  check(
    "competitionRank: 小さいほど良い指標（事故率）は昇順",
    competitionRank([0.1, 0.2, 0.2, 0.5], 0.5, { ascending: true }).rank === 4,
  );
  const service = read("src/services/supabaseDataService.js");
  const chart = read("src/components/analysis/MotorConditionChart.jsx");
  check(
    "会場内順位は competitionRank で出し、同値なら「◯位タイ」の文言を使う",
    /competitionRank\(\s*valued\.map/.test(service) &&
      !/rank: rankIndex \+ 1/.test(service) &&
      service.includes("`venue-motor-ranking-v2-") &&
      /venueMotorRanking\.tied > 1\s*\?\s*"analysis\.motor\.venueRankBadgeTied"/.test(
        chart,
      ) &&
      /value: Number\(venueMotorRanking\.value\)\.toFixed\(1\)/.test(chart) &&
      /venueMotorRanking &&\s*` \$\{t\("analysis\.motor\.venueRankRoundingNote"\)\}`/.test(
        chart,
      ),
  );
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 会場内順位の値が一覧と0.1違いうる理由（会場公式は切り捨て）の注記がある`,
      /0\.1/.test(motor.venueRankRoundingNote ?? ""),
    );
    check(
      `${lang}: 会場内順位の見出しに基準（2連率）が書いてある`,
      /2連率|top-2|2연대율/.test(motor.venueRankLabel),
    );
    check(
      `${lang}: 同順位の会場内順位の文言がある`,
      /\{\{rank\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        /\{\{total\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        // 何の値の順位かを数字で示す（当日は一覧に2連率が2列ある。ファン評価2周目）
        [motor.venueRankBadge, motor.venueRankBadgeTied].every((s) =>
          s.includes("{{value}}"),
        ),
    );
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
