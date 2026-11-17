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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFakeSupabase,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  NONE,
  OFFICIAL_POSITIVE_DAY,
  OFFICIAL_ZERO_DAY,
  OWN12,
  RACE,
  VENUE,
  breakdownTables,
  freshTables,
  oldGenerationTables,
  rows3,
} from "./verifyData/motor-fresh-rate.js";
import {
  motorRateView,
  motorRate3View,
  isWithinFreshMotorWindow,
} from "../../src/utils/motorFreshRate.js";
import {
  section1,
  section2,
  section3,
} from "./verifyData/motor-fresh-rate-sections.js";

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
  "最初の開催だけ、2連率の列の見出しから「公式」を外す（2026-10-11 ユーザー決定）",
  /firstMeet\s*\?\s*"analysis\.motor\.freshRate2Header"\s*:\s*"analysis\.motor\.officialRate2Header"/.test(
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
  "サービス: 材料が取れなかったら保存しない（fetchFailed）",
  /fresh\.failed\s*\n?\s*\?\s*\{ rows: merged, freshness: fresh\.freshness, fetchFailed: true \}/.test(
    read("src/pure/raceMotorBreakdown.js"),
  ),
);

// ---- サービス層を偽の supabase クライアントの上で呼ぶ（BOA-1675。共通の部品 verifyData/fakeServiceSupabase.js） ----
registerFakeServiceSupabase();
// サービス層のキャッシュは localStorage にも書く。Node には無いので、メモリの Map で代える（setTables で空にする）
const localStore = new Map();
globalThis.localStorage = {
  getItem: (k) => localStore.get(k) ?? null,
  setItem: (k, v) => void localStore.set(k, String(v)),
  removeItem: (k) => void localStore.delete(k),
  key: (i) => [...localStore.keys()][i] ?? null,
  get length() {
    return localStore.size;
  },
};

// ---- 3b. サービス（getRaceMotorFreshness・getRaceMotorBreakdown を偽の supabase の上で呼ぶ） ----
const fakeTables = {};
const failTables = new Map();
const fake = setFakeSupabase(createFakeSupabase(fakeTables, { failTables }));
const { clearCache } = await import("../../src/services/core.js");
const { getRaceMotorFreshness } =
  await import("../../src/services/motorQueries2.js");
const { getRaceMotorBreakdown } =
  await import("../../src/services/motorQueries3.js");
const setTables = (next) => {
  for (const k of Object.keys(fakeTables)) delete fakeTables[k];
  Object.assign(fakeTables, next);
  failTables.clear();
  localStore.clear();
  clearCache();
  fake.calls.length = 0;
};
const queriesOn = (table) => fake.calls.filter((c) => c.table === table);
const quiet = async (fn) => {
  // 失敗の再現中の console.error を静かにする
  const orig = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = orig;
  }
};

const ctx = {
  NONE,
  OFFICIAL_POSITIVE_DAY,
  OFFICIAL_ZERO_DAY,
  OWN12,
  RACE,
  VENUE,
  assert,
  breakdownTables,
  check,
  failTables,
  freshTables,
  getRaceMotorBreakdown,
  getRaceMotorFreshness,
  localStore,
  oldGenerationTables,
  queriesOn,
  quiet,
  read,
  rows3,
  setTables,
};
await section1(ctx);
await section2(ctx);
await section3(ctx);

if (failures.length > 0) {
  console.error(`\n${failures.length}件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
