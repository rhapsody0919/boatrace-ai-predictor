#!/usr/bin/env node
/**
 * verify-motor-window-generation.js — モータ情報の機力指数・2連率推移・部品交換・
 * 使用履歴と、レース詳細の一覧表が、入れ替え前の別モーターの成績を混ぜないことを
 * 固定する（BOA-329）。
 *
 * ## なぜ要るか
 *
 * モーターは会場ごとに概ね年1回入れ替わり、番号は新しいモーターに再利用される。
 * 機力指数（getMotorPowerIndex）・推移と部品交換（fetchMotorDailySeries）・
 * 使用履歴（getMotorUsageHistory）は「今日から遡るN日」を会場×モーター番号で
 * 集めていたため、入れ替えをまたいで別モーターの成績を混ぜていた。
 * 例: 戸田は2026-08-06に入れ替えたので、9/28時点の「過去90日」のうち約40日は
 * 旧モーター（7月に河野大が乗った21号機）の成績だった。
 * 機力指数の期間実績は、レース詳細「モータ情報」の一覧表の2連率・3連率の列にも
 * 差し替えられているため、表の数字そのものに混ざっていた。
 *
 * また過去レースの一覧表も「今日から遡るN日」を集計していたため、レース後の
 * データが混ざり、入れ替え前のレースでは別モーターの成績になっていた。
 * 2026-09-29のユーザー判断(c)で、過去レースは出走表時点の公式値を出す。
 *
 * ## 何を検査するか
 *
 * サービス層は import.meta.env に依存し node から実行できないため、ソースを検査する
 * （verify-motor-waku-generation.js と同じ方式）。
 * 1. 期間の開始を max(使用開始日, 今日−days) にする motorWindowStart がある
 * 2. 機力指数・日次系列・使用履歴が motorWindowStart → getRacesForVenueSince を通り、
 *    日数だけの窓（getRacesForVenue）が残っていない
 * 3. 戻り値の形を変えた関数のキャッシュのキーが旧版と違う
 * 4. 一覧表: 過去レースは再計算せず公式値（rate_source: "official"、power_index: null、
 *    venue_motor_stats はレース日以前のスナップショット）。過去/当日がキャッシュの
 *    キーに入っている（当日に保存した再計算の値を、翌日以降に7日TTLで読まない）
 * 5. 画面: 過去レースでは期間の切り替えを出さず注記に置き換え、公式2連率の列を畳む。
 *    入れ替え前のモーターはドリルダウンの中身を出さない。選手ページも、直近出走が
 *    入れ替え前なら機力指数を出さない
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatGenerationDate,
  isClippedByGeneration,
} from "../../src/utils/motorGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

const src = read("src/services/supabaseDataService.js");
const slice = (beginMarker, endMarker) => {
  const begin = src.indexOf(beginMarker);
  const end = src.indexOf(endMarker, begin + beginMarker.length);
  return begin >= 0 && end > begin ? src.slice(begin, end) : "";
};
const methodBody = (name) => slice(`  ${name}(`, "\n  },\n");

// 1. 期間の開始日
const windowFn = slice("async function motorWindowStart(", "\n}\n");
check("motorWindowStart がある", windowFn.length > 0);
check(
  "motorWindowStart: 使用開始日を getMotorGenerationStart で取る",
  windowFn.includes("await getMotorGenerationStart(venueCode)"),
);
check(
  "motorWindowStart: 使用開始日が今日−days より後なら使用開始日で切り詰める（max）",
  windowFn.includes("generationStart > windowStart") &&
    windowFn.includes(
      "since: clippedByGeneration ? generationStart : windowStart",
    ),
);
check(
  "motorWindowStart: 使用開始日が不明なら since: null（集計しない）",
  /if \(generationStart === null\) \{\s*return \{ since: null/.test(windowFn),
);

// 2. 各集計が世代で切り詰めた窓を通る
check(
  "日数だけの窓 getRacesForVenue が残っていない",
  !/function getRacesForVenue\(/.test(src) &&
    !/getRacesForVenue\(venueCode/.test(src),
);
const dailySeries = slice("function fetchMotorDailySeries(", "\n}\n");
for (const [label, body] of [
  ["機力指数（getMotorPowerIndex）", methodBody("getMotorPowerIndex")],
  ["推移・部品交換（fetchMotorDailySeries）", dailySeries],
  ["使用履歴（getMotorUsageHistory）", methodBody("getMotorUsageHistory")],
]) {
  check(`${label} が見つかる`, body.length > 0);
  check(
    `${label}: motorWindowStart で期間の開始を決める`,
    body.includes("await motorWindowStart(venueCode, "),
  );
  check(
    `${label}: 切り詰めた開始日以降のレースだけを集める`,
    /getRacesForVenueSince\(\s*venueCode,\s*window\.since[,)]/.test(body),
  );
  check(
    `${label}: 使用開始日が不明なら集計しない`,
    body.includes("window.since === null"),
  );
}

// 3. キャッシュのキー
check(
  "機力指数のキャッシュのキーが旧版（v2）と違う",
  methodBody("getMotorPowerIndex").includes("`motor-power-index-v3-") &&
    !src.includes("`motor-power-index-v2-"),
);
check(
  "日次系列のキャッシュのキーが旧版と違う（戻り値を {window, series} に変えた）",
  // 版は後から上がる（BOA-513 で v3）。v2 以上であることを見る
  /`motor-daily-series-v([2-9]|\d{2,})-/.test(dailySeries) &&
    !src.includes("`motor-daily-series-${"),
);
check(
  "推移のキャッシュのキーが旧版（v2）と違う",
  methodBody("getMotorConditionTrend").includes("`motor-condition-v3-") &&
    !src.includes("`motor-condition-v2-"),
);
check(
  "部品交換のキャッシュのキーが旧版と違う",
  /`motor-parts-history-v([2-9]|\d{2,})-/.test(
    methodBody("getMotorPartsHistory"),
  ),
);
check(
  "使用履歴のキャッシュのキーが旧版と違う",
  /`motor-usage-history-v([2-9]|\\d{2,})-/.test(
    methodBody("getMotorUsageHistory"),
  ),
);

// 4. 一覧表
const breakdown = methodBody("getRaceMotorBreakdown");
check("getRaceMotorBreakdown が見つかる", breakdown.length > 0);
check(
  "一覧表: 過去レースかを isPastRace(raceId) で判定する",
  breakdown.includes("const past = isPastRace(raceId);"),
);
check(
  "一覧表: 過去/当日をキャッシュのキーに含める（v5〜）",
  breakdown.includes(
    '`race-motor-breakdown-v8-${past ? "official" : "recalc"}-',
  ),
);
const pastBranch = breakdown.slice(
  breakdown.indexOf("if (past) {"),
  breakdown.indexOf("const [powerIndexes, venueMotorStatsList"),
);
check("一覧表: 過去レースの分岐がある", pastBranch.length > 0);
check(
  "一覧表（過去）: 機力指数を再計算しない（getMotorPowerIndex を呼ばない）",
  !pastBranch.includes("getMotorPowerIndex"),
);
check(
  '一覧表（過去）: rate_source: "official"・power_index: null',
  pastBranch.includes('rate_source: "official"') &&
    pastBranch.includes("power_index: null"),
);
check(
  "一覧表（過去）: 優出・優勝・1着率はレース日以前の公式スナップショット",
  pastBranch.includes(
    "this.getVenueMotorStats(venueCode, row.motor_number, raceDate)",
  ),
);
check(
  "一覧表（過去）: motor_2rate / motor_3rate を差し替えない（出走表の公式値のまま）",
  !/motor_2rate:/.test(pastBranch) && !/motor_3rate:/.test(pastBranch),
);
const venueStats = methodBody("getVenueMotorStats");
check(
  "getVenueMotorStats: asOfDate 以前で最新のスナップショットを取り、キーを分ける",
  venueStats.includes('.lte("scraped_date", asOfDate ?? "9999-12-31")') &&
    venueStats.includes("`venue-motor-stats-asof-"),
);
const pastFn = slice("function isPastRace(", "\n}\n");
check(
  "isPastRace: レースの日付が今日（JST）より前",
  pastFn.includes("raceId.slice(0, 10) < jstToday()"),
);

// 5. 画面
const chart = read("src/components/analysis/MotorConditionChart.jsx");
check(
  "画面: 過去レース（rate_source: official）では期間の切り替えを出さず注記に置き換える",
  chart.includes('breakdown.some((r) => r.rate_source === "official")') &&
    /drillDownMotor === null\s*\?\s*!officialMode/.test(chart) &&
    chart.includes("analysis.motor.periodOfficialNote"),
);
check(
  "画面: 過去レースでは「公式2連率（節時点）」の列を畳む（見出しとセルの両方）",
  (chart.match(/\{!officialMode && \(/g) ?? []).length >= 2,
);
check(
  "画面: 入れ替え前のモーターはドリルダウンの中身を出さない",
  chart.includes("raceDate < generationStart") &&
    chart.includes("setDrillPreGeneration(true)") &&
    chart.includes("analysis.motor.drillPreGeneration"),
);
check(
  "画面: 期間を使用開始日で切り詰めたら注記を出す",
  chart.includes("analysis.motor.periodClippedNote"),
);
check(
  "画面: 切り詰めたときは機力指数の要約に「過去90日」と書かない",
  chart.includes("period: powerIndex.clipped_by_generation") &&
    chart.includes("analysis.motor.periodSinceGeneration"),
);
const racer = read("src/services/racerService.js");
check(
  "選手ページ: 直近出走が入れ替え前なら機力指数・公式成績を出さない",
  racer.includes("date < generationStart") &&
    /preGeneration\s*\?\s*null\s*:\s*supabaseDataService\.getMotorPowerIndex/.test(
      racer,
    ),
);
// 2026-09-29 ファン評価1周目の修正
check(
  "選手ページ: 直近出走が入れ替え前なら理由を書き、行き止まりのリンクを出さない",
  racer.includes("preGeneration,\n  };") &&
    read("src/components/racer/RacerMotorStatusCard.jsx").includes(
      "{preGeneration ? (",
    ),
);
check(
  "画面: 入れ替え前のレースは一覧の時点で伝え、「行を押すと推移」の案内を出さない",
  chart.includes("setRacePreGeneration(preGeneration)") &&
    chart.includes("analysis.motor.racePreGenerationNote") &&
    /racePreGeneration \? \(\s*<p className="table-note">\{t\("analysis\.motor\.highlightNote"\)\}/.test(
      chart,
    ),
);
check(
  // 当日のレースも「直前まで」で集計するので、注記も当日から出す（BOA-557）
  "画面: ドリルダウンは（過去・当日とも）「このレースの直前まで」と明示する（BOA-521）",
  chart.includes("{selectedRace && (") &&
    chart.includes("analysis.motor.drillAsOfRaceNote"),
);
{
  // 出典の注記は横スクロール枠（右端のフェード）の外に置く（375pxで行末が隠れる）
  const wrapperStart = chart.indexOf("table-wrapper hscroll-hint");
  const noteAt = chart.indexOf("motor-official-source-note", wrapperStart);
  const between = chart.slice(wrapperStart, noteAt);
  const opens = (between.match(/<div\b/g) ?? []).length;
  const closes = (between.match(/<\/div>/g) ?? []).length;
  check(
    "画面: 出典の注記が横スクロール枠の外にある",
    wrapperStart >= 0 && noteAt > wrapperStart && closes > opens,
  );
}
check(
  "画面: 過去レースはドリルダウンでも期間を選ばせない（90日に戻す）",
  chart.includes("!drillPreGeneration && !isPastSelectedRace") &&
    /selectedRace\.slice\(0, 10\) < getTodayJST\(\)\) \{\s*setPeriodDays\(90\)/.test(
      chart,
    ),
);
check(
  "画面: 入れ替え前のレースでもハイライト行の説明は残す",
  chart.includes("analysis.motor.highlightNote"),
);
// BOA-521: 過去レースのドリルダウンは「このレースの直前まで」で集計する
{
  const races = slice("function getRacesForVenueSince(", "\n}\n");
  check(
    "getRacesForVenueSince: beforeRaceId より前のレースに限り（race_id <）、キーを分ける",
    races.includes("races.filter((r) => r.race_id < beforeRaceId)") &&
      races.includes("${beforeKey(beforeRaceId)}"),
  );
  check(
    "motorWindowStart: beforeRaceId があれば、その日付を基準日にする",
    windowFn.includes("beforeRaceId === null") &&
      windowFn.includes("beforeRaceId.slice(0, 10)"),
  );
  for (const [label, body] of [
    ["機力指数", methodBody("getMotorPowerIndex")],
    ["日次系列", dailySeries],
    ["使用履歴", methodBody("getMotorUsageHistory")],
    ["枠番別成績", methodBody("getMotorWakuStats")],
    ["選手×枠成績", methodBody("getMotorRacerWakuStats")],
  ]) {
    check(
      `${label}: 上限（beforeRaceId）をレースの取得に通し、キャッシュのキーに入れる`,
      /getRacesForVenueSince\([^)]*beforeRaceId,?\s*\)/.test(body) &&
        body.includes("${beforeKey(beforeRaceId)}"),
    );
  }
  const champ = methodBody("getVenueMotorChampionshipHistory");
  check(
    "優勝履歴: 過去レースではそのレースより前の優勝に限る",
    champ.includes("raceId < beforeRaceId") &&
      champ.includes("${beforeKey(beforeRaceId)}"),
  );
  check(
    "会場内順位: asOfDate 以前のスナップショットで順位を出す",
    methodBody("getVenueMotorRanking").includes(
      '.lte("scraped_date", asOfDate ?? "9999-12-31")',
    ),
  );
  check(
    // 当日のレースも「このレースの直前まで」（BOA-557）
    "画面: ドリルダウンで beforeRaceId（過去・当日とも表示中のレース）を9つの取得すべてに渡す",
    chart.includes("const beforeRaceId = selectedRace ?? null;") &&
      (chart.match(/\bbeforeRaceId,\n/g) ?? []).length >= 7 &&
      (chart.match(/isPast \? raceDate : null/g) ?? []).length >= 2,
  );
}
// 2026-09-29 ユーザー判断 B: 使用開始日を画面に出す（ADR-0067 2026-09-28追記の改訂）。
// 日付を伏せた注記「入れ替え後のため…」が「最近入れ替えた」と誤読されたため
check(
  "画面: 使用開始日の行を、期間の切り替えを出すとき（当日のレース）だけに出す",
  /showPeriodToggle \? \(\s*<>\s*\{\/\*[\s\S]*?\*\/\}\s*\{generationStart !== null && \(/.test(
    chart,
  ) && chart.includes("analysis.motor.generationStartSource"),
);
check(
  "画面: 切り詰めの注記と機力指数の要約に使用開始日を差し込む",
  /periodClippedNote", \{\s*date: formatGenerationDate\(generationStart/.test(
    chart,
  ) &&
    /periodSinceGeneration", \{\s*date: formatGenerationDate\(generationStart/.test(
      chart,
    ),
);
check(
  "画面: 使用開始日の取得に失敗しても一覧表は出す（try/catch で null に倒す）",
  /let venueGenerationStart = null;\s*try \{\s*venueGenerationStart =\s*await supabaseDataService\.getMotorGenerationStart/.test(
    chart,
  ),
);
// 入れ替えから1ヶ月以内は「直近1ヶ月」まで切り詰められ、切り替えても中身が変わらない
// （2026-09-29 ファン評価。丸亀 9/17 入れ替え → 9/29 は両方とも 9/17 以降）
check(
  "isClippedByGeneration: 丸亀（9/17〜）は 9/29 時点で30日も切り詰め、戸田（8/6〜）は切り詰めない",
  isClippedByGeneration("2026-09-17", "2026-09-29", 30) === true &&
    isClippedByGeneration("2026-08-06", "2026-09-29", 30) === false &&
    isClippedByGeneration("2026-08-06", "2026-09-29", 90) === true &&
    isClippedByGeneration(null, "2026-09-29", 30) === false,
);
check(
  "isClippedByGeneration: 境界（使用開始日 = 基準日−days）は切り詰めない",
  isClippedByGeneration("2026-08-30", "2026-09-29", 30) === false &&
    isClippedByGeneration("2026-08-31", "2026-09-29", 30) === true,
);
check(
  "formatGenerationDate: 2026/8/6 と 8/6（先頭の0を付けない）",
  formatGenerationDate("2026-08-06") === "2026/8/6" &&
    formatGenerationDate("2026-08-06", { short: true }) === "8/6" &&
    formatGenerationDate(null) === "",
);
check(
  "画面: 両方の期間が切り詰められるときは、期間の切り替えボタンを出さない",
  /periodChoiceHasEffect && \(\s*<div className="period-toggle"/.test(chart),
);
check(
  "画面: 枠番別成績の注記にも使用開始日を入れる",
  read("src/components/analysis/MotorWakuStatsGrid.jsx").includes(
    "date: formatGenerationDate(generationStart, { short: true })",
  ),
);
check(
  "画面: 経過日数（◯日目）は出さない（ファンの単位は節。2026-09-29 ファン議論）",
  !/日目/.test(chart),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  // BOA-521: ドリルダウンは「このレースの直前まで」なので、一覧の注記で機力指数を
  // 「今日から遡る指標」と説明すると食い違う（2026-09-29 ファン評価）
  check(
    `${lang}: 過去レースの出典注記が、機力指数を「今日から遡る」と説明していない`,
    !/今日から遡|computed backward from today|從今天回溯|오늘부터 거슬러/.test(
      motor.officialModeSourceNote,
    ),
  );
  check(
    `${lang}: 使用開始日の行・注記が日付（{{date}}）を受け取り、出典に BOATCAST とある`,
    motor.generationStartLabel?.includes("{{date}}") &&
      motor.periodClippedNote.includes("{{date}}") &&
      motor.periodSinceGeneration.includes("{{date}}") &&
      motor.generationStartSource?.includes("BOATCAST"),
  );
  check(
    `${lang}: 過去レース・切り詰め・入れ替え前の文言がある`,
    [
      "periodOfficialNote",
      "periodClippedNote",
      "officialModeSourceNote",
      "drillPreGeneration",
      "periodSinceGeneration",
      "racePreGenerationNote",
      "drillAsOfRaceNote",
      "highlightNote",
    ].every((k) => typeof motor[k] === "string" && motor[k].length > 0),
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
