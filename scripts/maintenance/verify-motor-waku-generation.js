#!/usr/bin/env node
/**
 * verify-motor-waku-generation.js — モーターの枠番別成績・選手×枠成績（BOA-301）が、
 * 入れ替え前の別モーターの成績を混ぜないことを固定する。
 *
 * ## なぜ要るか
 *
 * getMotorWakuStats / getMotorRacerWakuStats は「会場×モーター番号」の直近180日を
 * 集計していた。モーターは会場ごとに概ね年1回入れ替わり番号が再利用されるため、
 * 180日窓は入れ替えをまたぐと別モーターの成績を混ぜる（窓を絞るのは、使用開始日が
 * 取れなかった頃の暫定策だった。BOA-329）。例: 丸亀は2026-09-17に入れ替えたので、
 * 9/28時点の180日窓は約170日分が旧モーターの成績だった。
 * 使用開始日（venue_motor_start_dates、マイグレーション104で匿名から読める）が
 * 取れるようになったため、現行世代（使用開始日以降）で集計する。
 *
 * ## 何を検査するか
 *
 * サービス層は import.meta.env に依存し node から実行できないため、ソースを検査する
 * （verify-motor-championship-generation.js と同じ方式）。
 * 1. 2関数とも getMotorGenerationStart で現行世代の開始日を決め、
 *    getRacesForVenueSince(venueCode, generationStart) でその日以降のレースだけを集める
 * 2. 日数の窓（getRacesForVenue(venueCode, days) / MOTOR_WAKU_STATS_WINDOW_DAYS）を使わない
 * 3. 使用開始日が不明なら集計せず generationStart: null を返す（別モーターを混ぜない）
 * 4. 戻り値の形を変えたので、キャッシュのキーが旧版と違う（localStorageに残る旧形式の
 *    配列を読むと、画面が .rows で落ちる）
 * 5. 画面が世代不明を「表示していません」に倒し、「直近180日」の文言が残っていない
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
const methodBody = (name) => {
  const begin = src.indexOf(`  ${name}(venueCode`);
  const end = src.indexOf("\n  },\n", begin);
  return begin >= 0 && end > begin ? src.slice(begin, end) : "";
};

check(
  "日数の窓の定数 MOTOR_WAKU_STATS_WINDOW_DAYS が残っていない",
  !src.includes("MOTOR_WAKU_STATS_WINDOW_DAYS"),
);

for (const name of ["getMotorWakuStats", "getMotorRacerWakuStats"]) {
  const body = methodBody(name);
  check(`${name} が見つかる`, body.length > 0);
  check(
    `${name}: getMotorGenerationStart で現行世代の開始日を決める`,
    body.includes("await getMotorGenerationStart(venueCode)"),
  );
  check(
    `${name}: 使用開始日以降のレースだけを集める（getRacesForVenueSince）`,
    body.includes("getRacesForVenueSince(venueCode, generationStart)"),
  );
  check(
    `${name}: 日数の窓（getRacesForVenue(venueCode, days)）を使わない`,
    !/getRacesForVenue\(venueCode/.test(body),
  );
  check(
    `${name}: 使用開始日が不明なら集計せず generationStart: null で返す`,
    /if \(generationStart === null\)/.test(body),
  );
  check(
    `${name}: 使用開始日の取得失敗を fetchFailed で返す（世代不明と区別する）`,
    body.includes("fetchFailed: true"),
  );
}

check(
  "getMotorWakuStats のキャッシュのキーが旧形式（配列）と異なる",
  methodBody("getMotorWakuStats").includes("`motor-waku-stats-generation-") &&
    !methodBody("getMotorWakuStats").includes("`motor-waku-stats-${"),
);
check(
  "getMotorRacerWakuStats のキャッシュのキーが旧形式（配列）と異なる",
  methodBody("getMotorRacerWakuStats").includes(
    "`motor-racer-waku-stats-generation-",
  ) &&
    !methodBody("getMotorRacerWakuStats").includes(
      "`motor-racer-waku-stats-${",
    ),
);

const since = src.slice(
  src.indexOf("async function fetchRacesForVenueSince("),
  src.indexOf("async function getMotorGenerationStart("),
);
check(
  "getRacesForVenueSince は使用開始日の当日を含む（gte）",
  since.includes('.gte("race_date", cutoff)'),
);

// 画面
const grid = read("src/components/analysis/MotorWakuStatsGrid.jsx");
check(
  "枠番別成績の表: 世代不明なら表を出さず「表示していません」に倒す",
  grid.includes("generationStart === null") &&
    grid.includes("analysis.motor.wakuStatsUnknownGeneration"),
);
const chart = read("src/components/analysis/MotorConditionChart.jsx");
check(
  "モータ情報: 新しい形（.rows / generationStart）で受け取る",
  chart.includes("motorWakuStats.rows") &&
    chart.includes("motorWakuStats.generationStart") &&
    chart.includes("motorRacerWakuStats.rows"),
);
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: 集計期間の文言に「180」が残っていない`,
    !/180/.test(motor.wakuStatsWindowNote) && !/180/.test(motor.racerWakuNote),
  );
  check(
    `${lang}: 世代不明の文言がある`,
    typeof motor.wakuStatsUnknownGeneration === "string" &&
      motor.wakuStatsUnknownGeneration.length > 0,
  );
}

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
