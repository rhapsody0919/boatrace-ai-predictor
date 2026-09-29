#!/usr/bin/env node
/**
 * verify-motor-championship-generation.js — モータ情報「優勝した日・選手」が、
 * 入れ替え前の別モーターの優勝を混ぜないことを固定する。
 *
 * ## なぜ要るか
 *
 * getVenueMotorChampionshipHistory は race_stage='優勝戦' × 会場 × モーター番号 だけで
 * 優勝履歴を集めていて、期間の下限が無かった。モーターは会場ごとに概ね年1回入れ替わり、
 * 番号は新しいモーターに再利用されるため、入れ替え前の別モーターの優勝が現行モーターの
 * 履歴として出ていた（2026-09-28の実測で、優勝戦552レースのうち165レースが現行世代より前）。
 *
 * ## 何を検査するか
 *
 * 1. src/utils/motorGeneration.js の純関数
 *    - currentMotorGenerationStart: 使用開始日の履歴から最新の日付を選ぶ。行が無ければ null
 *    - isInMotorGeneration: 使用開始日の前日は除外、当日・以降は含める
 * 2. getVenueMotorChampionshipHistory の本体が、上の2関数と venue_motor_start_dates を通っていること
 *    （使用開始日の取得は getMotorGenerationStart に共通化。枠番別成績も同じものを使う）
 *    また、戻り値の形を変えたため、キャッシュのキーが旧版と違うこと（localStorageに30分残る
 *    旧形式の配列を読むと、画面が .wins.length で落ちる）
 *    （サービス層は import.meta.env に依存し node から実行できないため、ソースを検査する）
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  currentMotorGenerationStart,
  isInMotorGeneration,
} from "../../src/utils/motorGeneration.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVICE = path.resolve(
  __dirname,
  "../../src/services/supabaseDataService.js",
);

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};

// 1. 世代の開始日
check(
  "使用開始日の行が無ければ null（世代不明）",
  currentMotorGenerationStart([]) === null &&
    currentMotorGenerationStart(null) === null,
);
check(
  "複数の使用開始日（入れ替えの履歴）からは最新を選ぶ",
  currentMotorGenerationStart([
    { start_date: "2025-09-17" },
    { start_date: "2026-09-17" },
    { start_date: "2026-03-01" },
  ]) === "2026-09-17",
);

// 2. 世代の境界（丸亀: 2026-09-17 使用開始の実例）
const start = "2026-09-17";
check(
  "使用開始日の前日の優勝戦は除外する（入れ替え前の別モーター）",
  isInMotorGeneration("2026-09-16-15-12", start) === false,
);
check(
  "使用開始日の当日の優勝戦は含める",
  isInMotorGeneration("2026-09-17-15-12", start) === true,
);
check(
  "使用開始日より後の優勝戦は含める",
  isInMotorGeneration("2026-09-28-15-12", start) === true,
);
check(
  "前年の同じ月日の優勝戦は除外する（年をまたいだ文字列比較）",
  isInMotorGeneration("2025-12-31-15-12", start) === false,
);

// 3. サービス層が世代の絞り込みを通っていること
const src = readFileSync(SERVICE, "utf8");
// 引数が増えて Prettier で改行されても見つかるよう、空白を挟んで探す
const begin = src.search(/getVenueMotorChampionshipHistory\(\s*venueCode/);
const end = src.indexOf("\n  },\n", begin);
const body = begin >= 0 && end > begin ? src.slice(begin, end) : "";
check("getVenueMotorChampionshipHistory が見つかる", body.length > 0);
// 使用開始日の取得は枠番別成績（BOA-301）と共通の getMotorGenerationStart に寄せた
const helperBegin = src.indexOf("async function getMotorGenerationStart(");
const helperEnd = src.indexOf("\n}\n", helperBegin);
const helper =
  helperBegin >= 0 && helperEnd > helperBegin
    ? src.slice(helperBegin, helperEnd)
    : "";
check(
  "getMotorGenerationStart が venue_motor_start_dates から使用開始日を読む",
  helper.includes('.from("venue_motor_start_dates")'),
);
check(
  "getMotorGenerationStart が currentMotorGenerationStart で現行世代の開始日を決める",
  helper.includes("currentMotorGenerationStart("),
);
check(
  "getMotorGenerationStart が権限エラーを世代不明（null）に倒す",
  helper.includes("isPermissionDeniedError(err)"),
);
check(
  "優勝履歴が getMotorGenerationStart で現行世代の開始日を決める",
  body.includes("getMotorGenerationStart(venueCode)"),
);
check(
  "isInMotorGeneration で優勝戦を現行世代に絞る",
  body.includes("isInMotorGeneration("),
);
check(
  "使用開始日が不明なら優勝履歴を出さない（generationStart: null で早期に返す）",
  /if \(generationStart === null\) return \{ generationStart, wins: \[\] \}/.test(
    body,
  ),
);

check(
  "キャッシュのキーが旧形式（配列）のキーと異なる（localStorageの旧値で描画が落ちない）",
  !body.includes("`venue-motor-championship-history-"),
);

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
