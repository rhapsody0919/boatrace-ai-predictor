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
 * 画面（一覧・ドリルダウン・枠番別成績・選手ページのカード・推移グラフ）は ja の訳で描いて、描いた結果を見る
 * （verifyData/motor-tab-readability-render.js・-scenes.js）。取得は偽の DB の上のサービス層。訳（locales）は字で見る。
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
  partsScene,
  racerStatusScene,
  rankingTables,
  todayScene,
  usageTables,
} from "./verifyData/motor-tab-readability.js";
import * as scenes from "./verifyData/motor-tab-readability-scenes.js";
import {
  runDrillLoad,
  tJa,
} from "./verifyData/motor-tab-readability-render.js";
import { recalcMotorRows } from "../../src/pure/raceMotorBreakdown.js";
import {
  formatPowerIndex,
  formatRateOrCount,
  powerIndexTone,
} from "../../src/utils/smallSampleRate.js";
import { officialTallyState } from "../../src/utils/motorGeneration.js";
import {
  exhibitionTimeAxis,
  exhibitionSparklineY,
} from "../../src/utils/chartDomain.js";
import { competitionRank } from "../../src/utils/competitionRank.js";
import {
  section1,
  section2,
  section3,
} from "./verifyData/motor-tab-readability-sections1.js";
import {
  section4,
  section5,
  section5b,
} from "./verifyData/motor-tab-readability-sections3.js";
import {
  section6,
  section7,
  section8,
} from "./verifyData/motor-tab-readability-sections2.js";

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
const { clearCache } = await import("../../src/services/core.js");
const { fetchMotorDailySeries } =
  await import("../../src/services/motorQueries.js");
const { getMotorPowerIndex, getMotorUsageHistory } =
  await import("../../src/services/motorQueries2.js");
const { getRaceMotorBreakdown } =
  await import("../../src/services/motorQueries3.js");
const { getVenueMotorRanking } =
  await import("../../src/services/motorQueries4.js");
const { getMotorPartsHistory } =
  await import("../../src/services/motorQueries6.js");

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

// 選手ページの今節のモーター（RA40 BOA-1673 で racerService.js から移した）を偽の DB で取り、その戻りでカードを描く。
// single は1日1走だけにした戻りで描いたカード（横軸にレース番号を付けない）、small は機力指数を小標本にした戻りで描いたカード
const { getRacerCurrentMotorStatus } =
  await import("../../src/services/motorQueries7.js");
const racerCard = async () => {
  const { racerId, tables } = racerStatusScene(day, rid);
  const status = await run(tables, () => getRacerCurrentMotorStatus(racerId));
  const card = await scenes.racerCardScene(status);
  const single = await scenes.racerCardScene({
    ...status,
    meetTrend: (status?.meetTrend ?? []).filter((_, i) => i !== 1),
  });
  // 機力指数は4走で -0.04（小標本・丸めて 0.0）にした戻りでも描く（偽の DB の場面は機力指数の走を持たない）
  const small = await scenes.racerCardScene({
    ...status,
    powerIndex: {
      power_index: -0.04,
      sample_count: 4,
      clipped_by_generation: false,
    },
  });
  return { status, card, single, small };
};

const ctx = {
  M,
  V,
  check,
  competitionRank,
  day,
  exhibitionSparklineY,
  exhibitionTimeAxis,
  fetchMotorDailySeries,
  formatPowerIndex,
  formatRateOrCount,
  getMotorPartsHistory,
  getMotorPowerIndex,
  getMotorUsageHistory,
  getRaceMotorBreakdown,
  getVenueMotorRanking,
  near,
  officialTallyState,
  partsScene,
  powerIndexTone,
  racerCard,
  rankingTables,
  read,
  recalcMotorRows,
  rid,
  run,
  runDrillLoad,
  same,
  scenes,
  seed,
  tJa,
  todayScene,
  usageTables,
};
await section1(ctx);
await section2(ctx);
await section3(ctx);
await section4(ctx);
await section5(ctx);
await section5b(ctx);
await section6(ctx);
await section7(ctx);
await section8(ctx);

if (failures.length > 0) {
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
