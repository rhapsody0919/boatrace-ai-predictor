#!/usr/bin/env node
/**
 * モーター2連率 0 の「実績なし」の判定（BOA-702）を検証する。DB接続は不要。
 *
 * 新モーターの最初の節で一度も使われなかったモーターは、公式の2連率が 0 になる（唐津 9/16 切替の実測）。
 * これを「0.0%」と出すと「2着以内に一度も来ていない」と読まれる。本当に 0%（走って2着以内0回）は
 * 0.0% のまま出す。画面（src/utils/motorGeneration.js isMotorUnrated）と本日のデータ一覧の生成
 * （scripts/lib/motorUnrated.js isUnratedMotor）の両方を固定する。
 */
import { isMotorUnrated } from "../../src/utils/motorGeneration.js";
import { isUnratedMotor } from "../lib/motorUnrated.js";

const cases = [
  // 当日のレース: 自社集計の走数で判定（全会場）
  [
    "当日・走数0で2連率0 → 実績なし（唐津45号機 10/2）",
    isMotorUnrated(
      { motor_2rate: 0, rate_source: "recalc", sample_count: 0 },
      false,
    ),
    true,
  ],
  [
    "当日・走数4で2連率0 → 本当に0%（唐津2号機）",
    isMotorUnrated(
      { motor_2rate: 0, rate_source: "recalc", sample_count: 4 },
      true,
    ),
    false,
  ],
  [
    "当日・2連率が0でない → 対象外",
    isMotorUnrated(
      { motor_2rate: 31.7, rate_source: "recalc", sample_count: 0 },
      true,
    ),
    false,
  ],
  [
    "当日・2連率が無い → 対象外",
    isMotorUnrated(
      { motor_2rate: null, rate_source: "recalc", sample_count: 0 },
      true,
    ),
    false,
  ],
  // 過去のレース: 会場公式の出走数で判定
  [
    "過去・公式の出走数0 → 実績なし",
    isMotorUnrated(
      { motor_2rate: 0, rate_source: "official", race_count: 0 },
      true,
    ),
    true,
  ],
  [
    "過去・公式の出走数4 → 本当に0%",
    isMotorUnrated(
      { motor_2rate: 0, rate_source: "official", race_count: 4 },
      true,
    ),
    false,
  ],
  [
    "過去・会場に公式の出走数が無い（戸田等）→ 断定しない",
    isMotorUnrated(
      { motor_2rate: 0, rate_source: "official", race_count: null },
      false,
    ),
    false,
  ],
  ["行が無い → 対象外", isMotorUnrated(undefined, true), false],
  // 本日のデータ一覧の生成側
  [
    "生成・2連率0で切替後・節の初日より前の出走0 → 実績なし（唐津61号機 10/2: 今節3走だが公式は節初日の値）",
    isUnratedMotor(0, 0),
    true,
  ],
  ["生成・2連率0で出走あり → 本当に0%", isUnratedMotor(0, 3), false],
  [
    "生成・切替日が分からない（null）→ 断定しない",
    isUnratedMotor(0, null),
    false,
  ],
  ["生成・2連率が0でない → 対象外", isUnratedMotor(16.1, 0), false],
];

let failed = 0;
for (const [name, got, want] of cases) {
  if (got === want) console.log(`✅ ${name}`);
  else {
    failed++;
    console.error(`❌ ${name}: 期待 ${want}、実際 ${got}`);
  }
}
if (failed > 0) process.exit(1);
console.log(`\n✅ 全${cases.length}件成功`);
