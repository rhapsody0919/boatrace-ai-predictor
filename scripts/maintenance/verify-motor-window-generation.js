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
 * サービス層（motorWindowStart・getMotorPowerIndex・fetchMotorDailySeries・getMotorConditionTrend・
 * getMotorPartsHistory・getMotorUsageHistory・getRaceMotorBreakdown・getVenueMotorStats・getVenueMotorSnapshot・
 * getVenueMotorRanking・getRacesForVenueSince）を偽の supabase クライアントの上で呼び、返り値と
 * 記録された問い合わせで見る（BOA-1406。以前は本文の正規表現）。
 * 1. 期間の開始を max(使用開始日, 基準日−days) にする（基準日は今日、beforeRaceId があればその日）
 * 2. 機力指数・日次系列・使用履歴・枠番別成績が、その開始日以降のレースだけを集め、日数だけの窓
 *    （getRacesForVenue）が残っていない。使用開始日が不明なら集計しない
 * 3. 戻り値の形を変えた関数は、localStorage に残る旧版のキャッシュを読まない
 * 4. 一覧表: 過去レースは再計算せず公式値（rate_source: "official"、power_index: null、
 *    venue_motor_stats はレース日以前のスナップショット）。過去/当日がキャッシュの
 *    キーに入っている（当日に保存した再計算の値を、翌日以降に7日TTLで読まない。時計を進めて見る）
 * 5. 画面（ソースと文言を検査する）: 過去レースでは期間の切り替えを出さず注記に置き換え、公式2連率の列を畳む。
 *    入れ替え前のモーターはドリルダウンの中身を出さない。選手ページも、直近出走が
 *    入れ替え前なら機力指数を出さない
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import {
  M,
  V,
  ent,
  makeBreakdownWorld,
  makeWorld,
  race,
  resultOf,
  startRows,
} from "./verifyData/motor-window-generation.js";
import {
  formatGenerationDate,
  isClippedByGeneration,
  motorGenerationStartAsOf,
} from "../../src/utils/motorGeneration.js";
import { motorWindowFrom } from "../../src/utils/motorPowerIndex.js";
import {
  section1,
  section2,
  section3,
  section4,
  section5,
} from "./verifyData/motor-window-generation-sections1.js";
import {
  section6,
  section7,
  section8,
  section9,
  section10,
  section11,
  section12,
} from "./verifyData/motor-window-generation-sections2.js";
import {
  section13,
  section14,
  section15,
  section16,
} from "./verifyData/motor-window-generation-sections3.js";
import {
  section17,
  section18,
  section19,
} from "./verifyData/motor-window-generation-sections4.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

// サービス層を偽の supabase クライアントの上で呼ぶ（BOA-1675。共通の部品 verifyData/fakeServiceSupabase.js）
registerFakeServiceSupabase();

const say = console.log.bind(console);
const sayErr = console.error.bind(console);
const failures = [];
const check = (label, ok) => {
  say(`${ok ? "OK  " : "FAIL"} ${label}`);
  if (!ok) failures.push(label);
};
// サービス層の [Cache ...] ・エラーの通知は出さない（結果は check で見る）
console.log = console.error = console.warn = () => {};

const fake = setFakeSupabase(
  createFakeSupabase({}, { scramble: true, project: true }),
);
// サービス層のキャッシュは localStorage にも書く。Node には無いので、中身を見られる物を置く（メモリのキャッシュは clearCache で消す）
const store = installLocalStorage({ inspectable: true });
// 時計を進められるようにする（キャッシュの期限・「今日」が変わる日をまたぐ振る舞いを見る）
const RealDate = Date;
const clock = { offsetMs: 0 };
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + clock.offsetMs);
    else super(...args);
  }
  static now() {
    return RealDate.now() + clock.offsetMs;
  }
};

const { getTodayJST } = await import("../../src/utils/dateUtils.js");
const core = await import("../../src/services/core.js");
const motor1 = await import("../../src/services/motorQueries.js");
const motor2 = await import("../../src/services/motorQueries2.js");
const motor3 = await import("../../src/services/motorQueries3.js");
const motor4 = await import("../../src/services/motorQueries4.js");
const motor5 = await import("../../src/services/motorQueries5.js");
const motor6 = await import("../../src/services/motorQueries6.js");
const { clearCache, isPastRace } = core;
const { motorWindowStart, fetchMotorDailySeries, getRacesForVenueSince } =
  motor1;
const { getMotorPowerIndex, getMotorUsageHistory } = motor2;
const { getRaceMotorBreakdown, getVenueMotorStats, getVenueMotorSnapshot } =
  motor3;
const { getVenueMotorRanking } = motor4;
const { getMotorWakuStats, getMotorRacerWakuStats, getMotorConditionTrend } =
  motor5;
const { getMotorPartsHistory } = motor6;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const near = (a, b) => typeof a === "number" && Math.abs(a - b) < 1e-9;
const addDays = (ymd, n) =>
  new RealDate(new RealDate(`${ymd}T00:00:00Z`).getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
const T = getTodayJST();
const day = (n) => addDays(T, n); // 今日から n 日後（負は前）
const rid = (n, no, venue = V) =>
  `${day(n)}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const run = async (tables, fn) => {
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  clock.offsetMs = 0;
  fake.reset(tables);
  return fn();
};
const seed = (key, data) =>
  localStorage.setItem(
    `boatai:${key}`,
    JSON.stringify({ data, timestamp: Date.now() }),
  );
const tablesAsked = () => fake.calls.map((c) => c.table);
const askedAbout = (table) => fake.calls.filter((c) => c.table === table);
const hasFilter = (call, op, col, val) =>
  call.filters.some(([o, c, v]) => o === op && c === col && v === val);

const slice0 = (text, beginMarker, endMarker) => {
  const begin = text.indexOf(beginMarker);
  const end = text.indexOf(endMarker, begin);
  return begin === -1 || end === -1 ? "" : text.slice(begin, end);
};

const ctx = {
  M,
  V,
  askedAbout,
  check,
  clearCache,
  clock,
  core,
  day,
  ent,
  fake,
  fetchMotorDailySeries,
  formatGenerationDate,
  getMotorConditionTrend,
  getMotorPartsHistory,
  getMotorPowerIndex,
  getMotorRacerWakuStats,
  getMotorUsageHistory,
  getMotorWakuStats,
  getRaceMotorBreakdown,
  getRacesForVenueSince,
  getVenueMotorRanking,
  getVenueMotorSnapshot,
  getVenueMotorStats,
  hasFilter,
  isClippedByGeneration,
  isPastRace,
  makeBreakdownWorld,
  makeWorld,
  motor1,
  motor2,
  motor3,
  motor4,
  motor5,
  motor6,
  motorGenerationStartAsOf,
  motorWindowFrom,
  motorWindowStart,
  near,
  race,
  read,
  resultOf,
  rid,
  run,
  same,
  seed,
  slice0,
  startRows,
  store,
  tablesAsked,
};
await section1(ctx);
await section2(ctx);
await section3(ctx);
await section4(ctx);
await section5(ctx);
await section6(ctx);
await section7(ctx);
await section8(ctx);
await section9(ctx);
await section10(ctx);
await section11(ctx);
await section12(ctx);
await section13(ctx);
await section14(ctx);
await section15(ctx);
await section16(ctx);
await section17(ctx);
await section18(ctx);
await section19(ctx);

if (failures.length > 0) {
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
