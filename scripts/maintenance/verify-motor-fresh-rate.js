#!/usr/bin/env node
/**
 * verify-motor-fresh-rate.js — 新しいモーターの最初の開催で、モータ情報の一覧が全艇 0.0% に
 * ならないことを固定する（BOA-830、2026-10-11 ユーザー決定「艇ごとに、公式が0のときだけ自前の値」）。
 *
 * ## なぜ要るか
 *
 * 公式の出走表のモーター2連率・3連率は、入れ替え後の最初の節の間は全艇 0（2節目の初日から入る）。
 * 過去レースの一覧は公式の値をそのまま出していたため、常滑（2026-10-06 入れ替え）の
 * 10/06〜10/11 は全行 0.0%・機力指数「-」だった。
 *
 * ## 何を検査するか
 *
 * 1. motorRateView / motorRate3View の決まり。行は本番の実データから取った
 *    - 常滑 2026-10-06 7R（全艇 公式 0）: 0走（20号機）・1走で2着以内0回（35号機）・1走1回（57号機）
 *    - 唐津（会場コード23）2026-09-30 3R（公式と自前の混在）: 10号機 公式55.56（前の節まで9走）、
 *      7号機 公式2連率0・3連率28.57（8走で2着以内0回）、53号機 公式0（0走）
 * 2. 入れ替えから90日以内の判定
 * 3. 画面とサービスのソース（一覧が motorRateView を使う・帯・「※」・キャッシュの版）
 * 4. 4言語の文言キーと、禁止語を使っていないこと
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  motorRateView,
  motorRate3View,
  isWithinFreshMotorWindow,
} from "../../src/utils/motorFreshRate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const failures = [];
const check = (label, ok) => {
  console.log(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- 1. 決まり（本番の実データ） ----
// 過去レースの行（rate_source: "official"、motor_2rate/3rate は出走表時点の公式値）
const past = (o) => ({ rate_source: "official", ...o });

// 常滑 2026-10-06 7R
const tokoNotRun = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 0,
  generation_rate2: null,
  generation_rate3: null,
});
const tokoZero = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 1,
  generation_rate2: 0,
  generation_rate3: 0,
});
const tokoOwn = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 1,
  generation_rate2: 100,
  generation_rate3: 100,
});
check(
  "常滑 10/06 7R 20号機（公式0・0走）→ まだ走っていません",
  same(motorRateView(tokoNotRun), { kind: "notRun" }) &&
    same(motorRate3View(tokoNotRun), { kind: "notRun" }),
);
check(
  "常滑 10/06 7R 35号機（公式0・1走で2着以内0回）→ 0%（1走）",
  same(motorRateView(tokoZero), { kind: "zero", runs: 1 }),
);
check(
  "常滑 10/06 7R 57号機（公式0・1走1回）→ 自前の 100%（1走）、3連率も自前",
  same(motorRateView(tokoOwn), { kind: "own", value: 100, runs: 1 }) &&
    same(motorRate3View(tokoOwn), { kind: "own", value: 100 }),
);

// 唐津 2026-09-30 3R
const karaOfficial = past({
  motor_2rate: 55.56,
  motor_3rate: 66.67,
  generation_runs: 9,
  generation_rate2: 55.56,
  prior_meet_runs: 9,
});
const karaZeroWith3 = past({
  motor_2rate: 0,
  motor_3rate: 28.57,
  generation_runs: 8,
  generation_rate2: 0,
  generation_rate3: 25,
});
const karaNotRun = past({
  motor_2rate: 0,
  motor_3rate: 0,
  generation_runs: 0,
});
check(
  "唐津 9/30 3R 10号機（公式55.56）→ 公式のまま、前の節までの走り（9走）を添える",
  same(motorRateView(karaOfficial), {
    kind: "official",
    value: 55.56,
    priorRuns: 9,
  }) && same(motorRate3View(karaOfficial), { kind: "official", value: 66.67 }),
);
check(
  "唐津 9/30 3R 7号機（公式2連率0・3連率28.57・8走で2着以内0回）→ 2連率は 0%（8走）、3連率は公式のまま",
  same(motorRateView(karaZeroWith3), { kind: "zero", runs: 8 }) &&
    same(motorRate3View(karaZeroWith3), { kind: "official", value: 28.57 }),
);
check(
  "唐津 9/30 3R 53号機（公式0・0走）→ まだ走っていません",
  same(motorRateView(karaNotRun), { kind: "notRun" }),
);
check(
  "自前の値が無い（世代が分からない・入れ替え前のレース）なら、公式0でも公式のまま",
  same(
    motorRateView(
      past({ motor_2rate: 0, motor_3rate: 0, generation_runs: null }),
    ),
    { kind: "official", value: 0, priorRuns: null },
  ),
);
check(
  "当日のレースは公式の列（official_2rate）で判定する",
  same(
    motorRateView({
      rate_source: "recalc",
      motor_2rate: 25,
      official_2rate: 0,
      generation_runs: 8,
      generation_rate2: 25,
    }),
    { kind: "own", value: 25, runs: 8 },
  ) &&
    same(
      motorRateView({
        rate_source: "recalc",
        motor_2rate: 30,
        official_2rate: 41.2,
        generation_runs: 20,
        prior_meet_runs: 17,
      }),
      { kind: "official", value: 41.2, priorRuns: 17 },
    ),
);

// ---- 2. 入れ替えから90日以内 ----
check(
  "入れ替えから90日以内（使用開始日の当日は含む、91日目は外れる、前のレースは外れる）",
  isWithinFreshMotorWindow("2026-10-06", "2026-10-06") &&
    isWithinFreshMotorWindow("2026-09-16", "2026-09-30") &&
    isWithinFreshMotorWindow("2026-10-06", "2027-01-04") &&
    !isWithinFreshMotorWindow("2026-10-06", "2027-01-05") &&
    !isWithinFreshMotorWindow("2026-10-06", "2026-10-05") &&
    !isWithinFreshMotorWindow(null, "2026-10-06"),
);

// ---- 3. ソース ----
const chart = read("src/components/analysis/MotorConditionChart.jsx");
const service = read("src/services/supabaseDataService.js");
check(
  "一覧の2連率の列は motorRateView、過去レースの3連率は motorRate3View で決める",
  chart.includes("breakdown.map(motorRateView)") &&
    chart.includes("motorRate3View(row)"),
);
check(
  "最初の節（その日の公式2連率が全行0）は表の上に帯を出し、優出・優勝は「-」",
  chart.includes('t("analysis.motor.freshFirstMeetBanner"') &&
    /firstMeet\s*\?\s*"-"\s*:\s*\(row\.final_count \?\? "-"\)/.test(chart) &&
    /firstMeet\s*\?\s*"-"\s*:\s*\(row\.championship_count \?\? "-"\)/.test(
      chart,
    ),
);
check(
  "「※」は押しても行のドリルダウンを開かない（stopPropagation）",
  /className="motor-fresh-own-mark"[\s\S]{0,900}e\.stopPropagation\(\)/.test(
    chart,
  ),
);
check(
  "過去レースの機力指数は、自前の値があれば出す（generation_power_index）",
  chart.includes("row.generation_power_index"),
);
check(
  "サービス: 自前の値は「このレースより前」、前の節までの走数は節の初日より前で数える",
  /this\.getMotorPowerIndex\(venueCode, r\.motor_number, 90, raceId\)/.test(
    service,
  ) &&
    /getMotorPowerIndex\(\s*venueCode,\s*r\.motor_number,\s*90,\s*meetStart,?\s*\)/.test(
      service,
    ),
);
check(
  "サービス: 最初の節の確認は、入れ替えから90日以内でこのレースに公式0の艇があるときだけ（セルフレビュー）",
  /fresh && official\.some\(\(v\) => v === 0\)\s*\?\s*isAllOfficialMotorRateZero\(/.test(
    service,
  ),
);
check(
  "サービス: 一覧のキャッシュの版を上げた（v10 には自前の値の列が無い）",
  service.includes("`race-motor-breakdown-v11-") &&
    !service.includes("`race-motor-breakdown-v10-"),
);
check(
  "サービス: 材料が取れなかったら保存しない（fetchFailed）",
  /fresh\.failed\s*\n?\s*\?\s*\{ rows: merged, freshness: fresh\.freshness, fetchFailed: true \}/.test(
    service,
  ),
);

// ---- 4. 文言 ----
const KEYS = [
  "freshNotRun",
  "freshZeroRuns",
  "freshOwnMark",
  "freshOwnExplain",
  "freshOwnExplainBoat",
  "freshOwnHint",
  "freshPriorRuns",
  "freshFirstMeetBanner",
  "officialModeSourceNoteFresh",
];
const BANNED =
  /数える|集計|算出|対象|似た|似ている|ふつう|いつも|競艇|tally|tallied/i;
for (const lang of ["ja", "en", "zh-TW", "ko"]) {
  const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
    .motor;
  check(
    `${lang}: BOA-830 の文言キーが揃い、禁止語を使っていない`,
    KEYS.every((k) => typeof motor[k] === "string" && !BANNED.test(motor[k])),
  );
  check(
    `${lang}: 「集計前」の印のキーを消した`,
    motor.officialPendingBadge === undefined &&
      motor.officialPendingNote === undefined,
  );
}
const ja = JSON.parse(read("src/locales/ja/common.json")).analysis.motor;
check(
  "ja: ユーザー決定の文言のまま",
  ja.freshNotRun === "まだ走っていません" &&
    ja.freshZeroRuns === "0%（{{n}}走）" &&
    ja.freshOwnExplain ===
      "公式の2連率がまだ出ていないモーターです。このレースより前の、この場での走り（{{n}}走）から出した2連率です" &&
    ja.freshPriorRuns === "前の節までの走り（{{n}}走）で出た数字" &&
    ja.freshFirstMeetBanner ===
      "{{venue}}は{{month}}月{{day}}日にモーターが新しくなりました。公式の2連率は次の節から入ります。それまでは、龍神レーダーがこの場での走りから出した数字を出します",
);

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
