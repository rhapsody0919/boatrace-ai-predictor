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
    body.includes("getRacesForVenueSince(venueCode, window.since)"),
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
  dailySeries.includes("`motor-daily-series-v2-") &&
    !src.includes("`motor-daily-series-${"),
);
check(
  "推移のキャッシュのキーが旧版（v2）と違う",
  methodBody("getMotorConditionTrend").includes("`motor-condition-v3-") &&
    !src.includes("`motor-condition-v2-"),
);
check(
  "部品交換のキャッシュのキーが旧版と違う",
  methodBody("getMotorPartsHistory").includes("`motor-parts-history-v2-"),
);
check(
  "使用履歴のキャッシュのキーが旧版と違う",
  methodBody("getMotorUsageHistory").includes("`motor-usage-history-v2-"),
);

// 4. 一覧表
const breakdown = methodBody("getRaceMotorBreakdown");
check("getRaceMotorBreakdown が見つかる", breakdown.length > 0);
check(
  "一覧表: 過去レースかを isPastRace(raceId) で判定する",
  breakdown.includes("const past = isPastRace(raceId);"),
);
check(
  "一覧表: 過去/当日をキャッシュのキーに含める（v5）",
  breakdown.includes(
    '`race-motor-breakdown-v5-${past ? "official" : "recalc"}-',
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
    chart.includes("drillDownMotor === null ? !officialMode") &&
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
    chart.includes("drillDownMotor === null && !racePreGeneration"),
);
check(
  "画面: 過去レースのドリルダウンは「このモーターの現在まで」と明示する",
  chart.includes("isPastSelectedRace && (") &&
    chart.includes("analysis.motor.drillCurrentStateNote"),
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
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: 過去レース・切り詰め・入れ替え前の文言がある`,
    [
      "periodOfficialNote",
      "periodClippedNote",
      "officialModeSourceNote",
      "drillPreGeneration",
      "periodSinceGeneration",
      "racePreGenerationNote",
      "drillCurrentStateNote",
    ].every((k) => typeof motor[k] === "string" && motor[k].length > 0),
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
