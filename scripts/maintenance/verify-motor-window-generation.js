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
  formatGenerationDate,
  isClippedByGeneration,
  motorGenerationStartAsOf,
} from "../../src/utils/motorGeneration.js";
import { motorWindowFrom } from "../../src/utils/motorPowerIndex.js";

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
let clockOffsetMs = 0;
globalThis.Date = class extends RealDate {
  constructor(...args) {
    if (args.length === 0) super(RealDate.now() + clockOffsetMs);
    else super(...args);
  }
  static now() {
    return RealDate.now() + clockOffsetMs;
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
const V = 15;
const M = 24;
const rid = (n, no, venue = V) =>
  `${day(n)}-${String(venue).padStart(2, "0")}-${String(no).padStart(2, "0")}`;
const race = (race_id) => ({
  race_id,
  race_date: race_id.slice(0, 10),
  venue_code: Number(race_id.slice(11, 13)),
});
// レースの艇（出走表）の行。列は本体が読む名前
const ent = (race_id, boat_number, racer_id, extra = {}) => ({
  race_id,
  boat_number,
  racer_id,
  player_name: `選手${racer_id}`,
  grade: "A1",
  motor_number: M,
  global_2rate: 50,
  motor_2rate: 40,
  motor_3rate: 60,
  ...extra,
});
// order に並べた艇番が 1着, 2着, ...（rank1〜rank6）
const resultOf = (race_id, order, extra = {}) => ({
  race_id,
  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6].map((n) => [`rank${n}`, order[n - 1] ?? null]),
  ),
  race_status: null,
  ...extra,
});
const startRows = (venue, ...dates) =>
  dates.map((start_date) => ({ venue_code: venue, start_date }));
const run = async (tables, fn) => {
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  clockOffsetMs = 0;
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

// BOA-1019: レース日以前で最新の使用開始日。当日は新しい世代に含める。
const generationRows = [
  { start_date: "2025-10-20" },
  { start_date: "2026-10-06" },
];
for (const rows of [generationRows, [...generationRows].reverse()]) {
  for (const [date, expected] of [
    ["2025-11-11", "2025-10-20"],
    ["2026-10-06", "2026-10-06"],
    ["2026-10-05", "2025-10-20"],
    ["2025-10-19", null],
  ]) {
    for (const input of [date, `${date}-08-07`]) {
      check(
        `motorGenerationStartAsOf: ${input} → ${expected}（先頭 ${rows[0].start_date}）`,
        motorGenerationStartAsOf(rows, input) === expected,
      );
    }
  }
}
for (const rows of [[], null]) {
  check(
    `motorGenerationStartAsOf: 履歴 ${JSON.stringify(rows)} は null`,
    motorGenerationStartAsOf(rows, "2026-10-06") === null,
  );
}

// 期間の計算は純関数 motorWindowFrom（BOA-1245。龍神ボート番付と共有）。サービス側の使い方は下で見る
check(
  "motorWindowFrom: 使用開始日が基準日−days より後なら使用開始日で切り詰める（max）",
  JSON.stringify(motorWindowFrom("2026-10-01", 90, "2026-11-04")) ===
    JSON.stringify({
      since: "2026-10-01",
      generationStart: "2026-10-01",
      clippedByGeneration: true,
    }) &&
    JSON.stringify(motorWindowFrom("2026-01-01", 90, "2026-11-04")) ===
      JSON.stringify({
        since: "2026-08-06",
        generationStart: "2026-01-01",
        clippedByGeneration: false,
      }) &&
    motorWindowFrom("2026-08-06", 90, "2026-11-04").clippedByGeneration ===
      false,
);
check(
  "motorWindowFrom: 使用開始日が不明なら since: null（集計しない）",
  JSON.stringify(motorWindowFrom(null, 90, "2026-11-04")) ===
    JSON.stringify({
      since: null,
      generationStart: null,
      clippedByGeneration: false,
    }),
);

// ---- 世界（偽の DB）。使用開始日は今日の40日前。90日の窓は使用開始日で切り詰められ、30日の窓は切られない ----
const G = day(-40);
const ID = {
  pre: rid(-50, 1), // 使用開始日の前（入れ替え前の別モーター）
  g0: rid(-40, 1), // 使用開始日の当日
  g1: rid(-39, 2),
  g1b: rid(-39, 3), // 不成立（no_race）。艇6は着順なし
  a: rid(-20, 1),
  a2: rid(-20, 5), // a と同じ日。部品交換が記録される
  b: rid(-5, 1),
  c: rid(-3, 1), // 結果がまだ無い（未確定）。プロペラ交換が記録される
  other: rid(-20, 1, 16), // 他の会場
};
const world = () => ({
  venue_motor_start_dates: [
    ...startRows(V, G, day(-300)),
    ...startRows(16, day(-1)), // 他会場の行（会場で絞らないと世代が変わる）
  ],
  races: Object.values(ID).map(race),
  race_entries: [
    ent(ID.pre, 1, 11, { global_2rate: 50, motor_2rate: 70, motor_3rate: 80 }),
    ent(ID.g0, 1, 11, { global_2rate: 50, motor_2rate: 40, motor_3rate: 60 }),
    ent(ID.g1, 3, 11, { global_2rate: 50, motor_2rate: 41, motor_3rate: 61 }),
    ent(ID.g1b, 6, 11, {
      global_2rate: null,
      motor_2rate: 41,
      motor_3rate: 61,
    }),
    ent(ID.a, 2, 12, { global_2rate: 60, motor_2rate: 42, motor_3rate: 62 }),
    ent(ID.a, 1, 77, { motor_number: 25, global_2rate: 80 }), // 別のモーター番号
    ent(ID.a2, 4, 12, { global_2rate: 60, motor_2rate: 42, motor_3rate: 62 }),
    ent(ID.b, 3, 13, { global_2rate: 40, motor_2rate: 44, motor_3rate: 64 }),
    ent(ID.c, 5, 13, { global_2rate: 40, motor_2rate: 44, motor_3rate: 64 }),
    ent(ID.other, 1, 99, { global_2rate: 50 }),
  ],
  race_results: [
    resultOf(ID.pre, [1, 2, 3, 4, 5, 6]),
    resultOf(ID.g0, [1, 2, 3, 4, 5, 6]), // 艇1が1着
    resultOf(ID.g1, [4, 2, 1, 5, 6]), // 艇3が着順なし（失格等）。結果は成立している
    resultOf(ID.g1b, [1, 2, 3, 4, 5], { race_status: "no_race" }), // 不成立
    resultOf(ID.a, [1, 3, 4, 5, 6, 2]), // 艇2が6着
    resultOf(ID.a2, [2, 4, 1, 3, 5, 6]), // 艇4が2着
    resultOf(ID.b, [1, 2, 3, 4, 5, 6]), // 艇3が3着
    resultOf(ID.other, [1, 2, 3, 4, 5, 6]),
  ],
  exhibition_data: [
    {
      race_id: ID.g0,
      boat_number: 1,
      exhibition_time: 6.8,
      propeller_change: false,
      parts_changed: null,
    },
    {
      race_id: ID.a,
      boat_number: 2,
      exhibition_time: 6.7,
      propeller_change: false,
      parts_changed: null,
    },
    {
      race_id: ID.a2,
      boat_number: 4,
      exhibition_time: 6.65,
      propeller_change: false,
      parts_changed: ["ピストン"],
    },
    {
      race_id: ID.b,
      boat_number: 3,
      exhibition_time: 6.6,
      propeller_change: false,
      parts_changed: null,
    },
    {
      race_id: ID.c,
      boat_number: 5,
      exhibition_time: null,
      propeller_change: true,
      parts_changed: null,
    },
  ],
});
const noStart = () => ({
  ...world(),
  venue_motor_start_dates: startRows(16, day(-1)),
});

// ---- 1. 期間の開始日（motorWindowStart。計算の本体 motorWindowFrom は純関数で上で見た） ----
{
  const results = await run(world(), () =>
    Promise.all([
      motorWindowStart(V, 90),
      motorWindowStart(V, 30),
      motorWindowStart(V, 20, rid(-10, 3)),
      motorWindowStart(V, 90, rid(-10, 3)),
    ]),
  );
  check(
    "motorWindowStart: 使用開始日（他会場の行は無視）で切り詰め、基準日は今日（beforeRaceId があればそのレースの日）",
    same(results[0], {
      since: G,
      generationStart: G,
      clippedByGeneration: true,
    }) &&
      same(results[1], {
        since: day(-30),
        generationStart: G,
        clippedByGeneration: false,
      }) &&
      same(results[2], {
        since: day(-30),
        generationStart: G,
        clippedByGeneration: false,
      }) &&
      same(results[3], {
        since: G,
        generationStart: G,
        clippedByGeneration: true,
      }),
  );
  const unknown = await run(noStart(), () => motorWindowStart(V, 90));
  check(
    "motorWindowStart: 使用開始日が不明なら since: null（集計しない）",
    same(unknown, {
      since: null,
      generationStart: null,
      clippedByGeneration: false,
    }),
  );
}

// ---- 2. 各集計が、世代で切り詰めた窓（使用開始日以降）のレースだけを集める ----
check(
  "日数だけの窓 getRacesForVenue が残っていない（データ層のどこからも公開されない）",
  ![core, motor1, motor2, motor3, motor4, motor5, motor6].some(
    (m) => "getRacesForVenue" in m,
  ),
);
{
  // 機力指数: 使用開始日以降の5走（前日・他会場・別モーター・結果なしは数えない）
  const idx = await run(world(), () => getMotorPowerIndex(V, M, 90));
  check(
    "機力指数（getMotorPowerIndex）: 使用開始日以降の走だけで、結果の出た走の「2着以内−選手の全国2連率」を平均し、切り詰めを知らせる",
    idx.sample_count === 5 &&
      near(idx.power_index, -12) &&
      near(idx.actual_rate2, 40) &&
      near(idx.actual_rate3, 60) &&
      near(idx.avg_baseline_rate2, 52) &&
      idx.clipped_by_generation === true &&
      idx.generation_unknown === false,
  );
  const raceQuery = askedAbout("races")[0];
  check(
    "機力指数: レースは使用開始日以降（当日を含む）を会場で絞って読む",
    askedAbout("races").length === 1 &&
      hasFilter(raceQuery, "gte", "race_date", G) &&
      hasFilter(raceQuery, "eq", "venue_code", V),
  );
  const short = await run(world(), () => getMotorPowerIndex(V, M, 30));
  check(
    "機力指数: 使用開始日より新しい「今日−days」が開始日になる（30日は3走・切り詰めなし）",
    short.sample_count === 3 &&
      near(short.power_index, -20) &&
      short.clipped_by_generation === false,
  );
  const unknown = await run(noStart(), () => getMotorPowerIndex(V, M, 90));
  check(
    "機力指数: 使用開始日が不明なら集計せず generation_unknown: true（レースを引かない）",
    unknown.generation_unknown === true &&
      unknown.sample_count === 0 &&
      unknown.power_index === null &&
      !tablesAsked().includes("races"),
  );
  // 上限（beforeRaceId）: そのレースより前（<）に限り、渡さない呼び出しのキャッシュを読まない
  clearCache();
  fake.reset(world());
  const all = await getMotorPowerIndex(V, M, 90);
  const before = await getMotorPowerIndex(V, M, 90, ID.b);
  check(
    "機力指数: beforeRaceId のレースより前の4走だけを数え、渡さない呼び出しのキャッシュを読まない",
    all.sample_count === 5 &&
      before.sample_count === 4 &&
      near(before.power_index, -5) &&
      near(before.actual_rate2, 50),
  );
  check(
    "機力指数: beforeRaceId の日付までのレースだけを読む（その日より後は引かない）",
    askedAbout("races").some((c) => hasFilter(c, "lte", "race_date", day(-5))),
  );
}
{
  // 日次系列（推移・部品交換の元）
  const { window, series } = await run(world(), () =>
    fetchMotorDailySeries(V, M, 90),
  );
  check(
    "日次系列（fetchMotorDailySeries）: 使用開始日以降だけを日付ごとにまとめ（同日は先頭のレースの値）、部品交換が記録されたレース番号を添える",
    same(window, { since: G, generationStart: G, clippedByGeneration: true }) &&
      same(
        series.map((d) => d.date),
        [G, day(-39), day(-20), day(-5), day(-3)],
      ) &&
      series[0].motor_2rate === 40 &&
      series[0].exhibitionTime === 6.8 &&
      series[2].motor_2rate === 42 &&
      series[2].exhibitionTime === 6.7 &&
      same(series[2].parts, ["ピストン"]) &&
      series[2].propellerChanged === false &&
      same(series[2].eventRaceNos, [5]) &&
      series[4].propellerChanged === true &&
      same(series[4].eventRaceNos, [1]) &&
      same(series[0].eventRaceNos, []),
  );
  const unknown = await run(noStart(), () => fetchMotorDailySeries(V, M, 90));
  check(
    "日次系列: 使用開始日が不明なら集計しない（series: []・レースを引かない）",
    unknown.window.since === null &&
      same(unknown.series, []) &&
      !tablesAsked().includes("races"),
  );
  // 上限と includeTarget
  clearCache();
  fake.reset(world());
  const plain = await fetchMotorDailySeries(V, M, 90, ID.c);
  const incl = await fetchMotorDailySeries(V, M, 90, ID.c, {
    includeTarget: true,
  });
  const all = await fetchMotorDailySeries(V, M, 90);
  check(
    "日次系列: beforeRaceId のレースは既定で含めず、includeTarget: true でだけ含める（キャッシュのキーも分ける）",
    same(
      plain.series.map((d) => d.date),
      [G, day(-39), day(-20), day(-5)],
    ) &&
      same(
        incl.series.map((d) => d.date),
        [G, day(-39), day(-20), day(-5), day(-3)],
      ) &&
      all.series.length === 5,
  );
  // 推移（getMotorConditionTrend）
  const trend = await run(world(), () => getMotorConditionTrend(V, M, 90));
  check(
    "推移（getMotorConditionTrend）: 日次系列を {date, motor_2rate, motor_3rate, exhibition_time} にして返し、切り詰めを知らせる",
    trend.generationUnknown === false &&
      trend.clippedByGeneration === true &&
      same(trend.trend[0], {
        date: G,
        motor_2rate: 40,
        motor_3rate: 60,
        exhibition_time: 6.8,
      }) &&
      trend.trend.length === 5,
  );
  const trendUnknown = await run(noStart(), () =>
    getMotorConditionTrend(V, M, 90),
  );
  check(
    "推移: 使用開始日が不明なら generationUnknown: true・trend: []",
    trendUnknown.generationUnknown === true && same(trendUnknown.trend, []),
  );
}
{
  // 部品交換
  const parts = await run(world(), () => getMotorPartsHistory(V, M, 90));
  check(
    "部品交換（getMotorPartsHistory）: 使用開始日以降の交換を、記録されたレース番号と前後の展示タイム平均の比べ（improved）つきで返す",
    parts.events.length === 2 &&
      parts.events[0].date === day(-20) &&
      same(parts.events[0].raceNos, [5]) &&
      same(parts.events[0].parts, ["ピストン"]) &&
      parts.events[0].propellerChanged === false &&
      parts.events[0].interpretation === "improved" &&
      parts.events[1].date === day(-3) &&
      parts.events[1].propellerChanged === true &&
      same(parts.events[1].raceNos, [1]),
  );
  clearCache();
  fake.reset(world());
  const plain = await getMotorPartsHistory(V, M, 90, ID.c);
  const incl = await getMotorPartsHistory(V, M, 90, ID.c, {
    includeTarget: true,
  });
  check(
    "部品交換: beforeRaceId のレースの交換は既定で含めず、includeTarget: true でだけ含める（キャッシュのキーも分ける）",
    plain.events.length === 1 &&
      incl.events.length === 2 &&
      incl.events[1].date === day(-3),
  );
  const unknown = await run(noStart(), () => getMotorPartsHistory(V, M, 90));
  check("部品交換: 使用開始日が不明なら events: []", same(unknown.events, []));
}
{
  // 使用履歴
  const usage = await run(world(), () => getMotorUsageHistory(V, M));
  const [m3, m2, m1] = usage;
  check(
    "使用履歴（getMotorUsageHistory）: 使用開始日以降を選手ごとの節（同じ選手が2日以内の間隔）にまとめ、新しい節から返す",
    usage.length === 3 &&
      same([m1.racerId, m2.racerId, m3.racerId], [11, 12, 13]) &&
      m1.firstDate === G &&
      m1.lastDate === day(-39) &&
      m2.firstDate === day(-20) &&
      m2.lastDate === day(-20) &&
      m3.firstDate === day(-5) &&
      m3.lastDate === day(-3),
  );
  check(
    "使用履歴: 着順の付かなかった走も、結果の出たレースなら分母に数える（不成立・結果なしは数えない）",
    // 節1: 艇1が1着・艇3が着順なし（成立）・不成立の走 → 2走で2連率50
    m1.sampleCount === 2 &&
      near(m1.rate2, 50) &&
      near(m1.rate3, 50) &&
      // 節2: 6着と2着 → 2走で2連率50・3連率50
      m2.sampleCount === 2 &&
      near(m2.rate2, 50) &&
      near(m2.rate3, 50) &&
      // 節3: 3着の走と結果なしの走 → 1走で2連率0・3連率100
      m3.sampleCount === 1 &&
      near(m3.rate2, 0) &&
      near(m3.rate3, 100) &&
      same(
        m3.races.map((r) => r.rank),
        [3, null],
      ) &&
      same(
        m1.races.map((r) => r.rank),
        [1, null, null],
      ),
  );
  const unknown = await run(noStart(), () => getMotorUsageHistory(V, M));
  check(
    "使用履歴: 使用開始日が不明なら空（レースを引かない）",
    same(unknown, []) && !tablesAsked().includes("races"),
  );
  clearCache();
  fake.reset(world());
  const plain = await getMotorUsageHistory(V, M, ID.c);
  const incl = await getMotorUsageHistory(V, M, ID.c, { includeTarget: true });
  const earlier = await getMotorUsageHistory(V, M, ID.b);
  check(
    "使用履歴: beforeRaceId のレースの出走は既定で含めず、includeTarget: true でだけ含める（結果が無ければ rank: null で n には数えない。キャッシュのキーも分ける）",
    same(
      plain[0].races.map((r) => r.rank),
      [3],
    ) &&
      same(
        incl[0].races.map((r) => r.rank),
        [3, null],
      ) &&
      incl[0].sampleCount === 1 &&
      earlier.length === 2,
  );
}
{
  // 枠番別成績・選手×枠成績: 上限（beforeRaceId）を通す
  clearCache();
  fake.reset(world());
  const sum = (stats) => stats.rows.reduce((n, r) => n + r.raceCount, 0);
  const waku = await getMotorWakuStats(V, M);
  const wakuBefore = await getMotorWakuStats(V, M, ID.b);
  const racer = await getMotorRacerWakuStats(V, M);
  const racerBefore = await getMotorRacerWakuStats(V, M, ID.b);
  check(
    "枠番別成績: 使用開始日以降の結果の出た走だけを数え、beforeRaceId のレースより前に限る（キャッシュのキーも分ける）",
    waku.generationStart === G && sum(waku) === 5 && sum(wakuBefore) === 4,
  );
  check(
    "選手×枠成績: 使用開始日以降の結果の出た走だけを数え、beforeRaceId のレースより前に限る（キャッシュのキーも分ける）",
    sum(racer) === 5 && sum(racerBefore) === 4,
  );
}

// ---- 3. 戻り値の形を変えた関数は、localStorage に残る旧版のキャッシュを読まない ----
{
  const stale = { sample_count: 999 };
  const pi = await run(world(), async () => {
    seed(`motor-power-index-v2-${V}-${M}-90`, stale);
    return getMotorPowerIndex(V, M, 90);
  });
  check("機力指数: 旧版（v2）のキャッシュを読まない", pi.sample_count === 5);
  const ds = await run(world(), async () => {
    seed(`motor-daily-series-${V}-${M}-90`, [{ date: "旧" }]); // 配列だった頃のキー
    seed(`motor-daily-series-v2-${V}-${M}-90`, {
      window: null,
      series: [{ date: "v2" }],
    }); // レース番号が無かった頃
    return fetchMotorDailySeries(V, M, 90);
  });
  check(
    "日次系列: 旧版（配列・v2）のキャッシュを読まない（部品交換のレース番号 eventRaceNos が付く）",
    ds.series.length === 5 && same(ds.series[2].eventRaceNos, [5]),
  );
  const tr = await run(world(), async () => {
    seed(`motor-condition-v2-${V}-${M}-90`, { trend: [{ date: "旧" }] });
    return getMotorConditionTrend(V, M, 90);
  });
  check("推移: 旧版（v2）のキャッシュを読まない", tr.trend.length === 5);
  const ph = await run(world(), async () => {
    seed(`motor-parts-history-${V}-${M}-90`, { events: [] });
    seed(`motor-parts-history-v2-${V}-${M}-90`, { events: [{ date: "v2" }] }); // レース番号が無かった頃
    return getMotorPartsHistory(V, M, 90);
  });
  check(
    "部品交換: 旧版（v1・v2）のキャッシュを読まない（レース番号 raceNos が付く）",
    ph.events.length === 2 && same(ph.events[0].raceNos, [5]),
  );
  const uh = await run(world(), async () => {
    seed(`motor-usage-history-${V}-${M}`, [{ racerId: 0 }]);
    seed(`motor-usage-history-v3-${V}-${M}`, [{ racerId: 0, sampleCount: 1 }]); // 着順の付かない走を分母に数えなかった頃
    return getMotorUsageHistory(V, M);
  });
  check(
    "使用履歴: 旧版（v1・v3）のキャッシュを読まない",
    uh.length === 3 && uh[2].racerId === 11,
  );
  const wk = await run(world(), async () => {
    seed(`motor-waku-stats-${V}-${M}`, [{ course: 1, raceCount: 999 }]);
    return getMotorWakuStats(V, M);
  });
  check(
    "枠番別成績: 旧形式（配列）のキャッシュを読まない",
    wk.generationStart === G && wk.rows.length === 6,
  );
}

// ---- 4. 一覧表（getRaceMotorBreakdown） ----
// 使用開始日が1年以上前（入れ替え直後の特例が働かない）の会場。公式の2連率は全艇 0 より大きい
const breakdownWorld = () => {
  const tt = rid(0, 3); // 表示する当日のレース
  return {
    tt,
    tables: {
      venue_motor_start_dates: startRows(V, day(-400)),
      races: [rid(-20, 1), rid(-5, 1), rid(0, 2), tt, rid(0, 5)].map(race),
      race_entries: [
        // 過去レース（-20日）の出走表。艇1は別のモーター番号（スナップショットが無い）
        ent(rid(-20, 1), 1, 77, {
          motor_number: 25,
          motor_2rate: 30,
          motor_3rate: 50,
          global_2rate: 80,
        }),
        ent(rid(-20, 1), 2, 12, {
          motor_2rate: 42,
          motor_3rate: 62,
          global_2rate: 60,
        }),
        ent(rid(-5, 1), 3, 13, {
          motor_2rate: 44,
          motor_3rate: 64,
          global_2rate: 40,
        }),
        ent(rid(0, 2), 1, 11, {
          motor_2rate: 41,
          motor_3rate: 61,
          global_2rate: 50,
        }),
        // 表示する当日のレース
        ent(tt, 1, 11, {
          motor_2rate: 41.2,
          motor_3rate: 61.5,
          global_2rate: 50,
        }),
        ent(tt, 2, 12, {
          motor_number: 26,
          motor_2rate: 30,
          motor_3rate: 50,
          global_2rate: 60,
        }),
        // 同じ日の後のレース（直前までに入れない）
        ent(rid(0, 5), 1, 11, {
          motor_2rate: 41,
          motor_3rate: 61,
          global_2rate: 50,
        }),
      ],
      race_results: [
        resultOf(rid(-20, 1), [1, 3, 4, 5, 6, 2]),
        resultOf(rid(-5, 1), [1, 2, 3, 4, 5, 6]),
        resultOf(rid(0, 2), [1, 2, 3, 4, 5, 6]),
        resultOf(rid(0, 5), [1, 2, 3, 4, 5, 6]),
      ],
      venue_motor_stats: [
        {
          venue_code: V,
          motor_number: M,
          scraped_date: day(-30),
          final_count: 3,
          championship_count: 1,
          first_place_count: 10,
          race_count: 50,
        },
        {
          venue_code: V,
          motor_number: M,
          scraped_date: day(-10),
          final_count: 5,
          championship_count: 2,
          first_place_count: 14,
          race_count: 70,
        },
        {
          venue_code: V,
          motor_number: 25,
          scraped_date: day(-10),
          final_count: 7,
          championship_count: 0,
          first_place_count: 2,
          race_count: 20,
        },
        {
          venue_code: V,
          motor_number: 26,
          scraped_date: day(-10),
          final_count: 1,
          championship_count: 0,
          first_place_count: 2,
          race_count: 20,
        },
        {
          venue_code: 16,
          motor_number: M,
          scraped_date: day(-30),
          final_count: 99,
          championship_count: 99,
          first_place_count: 99,
          race_count: 99,
        },
      ],
      motor_pretest_stats: [],
    },
  };
};
{
  // 過去レース: 再計算せず出走表時点の公式値。優出・優勝・1着率はレース日以前で最新のスナップショット
  const past = rid(-20, 1);
  const { tables } = breakdownWorld();
  const got = await run(tables, () => getRaceMotorBreakdown(past, V, 90));
  const [r1, r2] = got.rows;
  check(
    "一覧表（過去）: 機力指数を再計算せず（power_index: null）、2連率・3連率は出走表の公式値のまま、rate_source は official",
    got.rows.length === 2 &&
      [r1, r2].every(
        (r) => r.rate_source === "official" && r.power_index === null,
      ) &&
      r1.motor_number === 25 &&
      r1.motor_2rate === 30 &&
      r1.motor_3rate === 50 &&
      r2.motor_number === M &&
      r2.motor_2rate === 42 &&
      r2.motor_3rate === 62 &&
      r2.official_2rate === 42 &&
      r2.official_3rate === 62 &&
      !tablesAsked().includes("races") &&
      !tablesAsked().includes("race_results"),
  );
  check(
    "一覧表（過去）: 優出・優勝・1着率・出走数はレース日以前で最新のスナップショット（レース後のものは使わない。無ければ null）",
    r2.final_count === 3 &&
      r2.championship_count === 1 &&
      r2.first_place_count === 10 &&
      r2.race_count === 50 &&
      r1.final_count === null &&
      r1.race_count === null &&
      r2.venue_stats_failed === false,
  );
  check(
    "一覧表（過去）: 会場公式の成績は asOfDate = レースの日以前を、会場・モーター番号で絞って読む",
    askedAbout("venue_motor_stats").length === 2 &&
      askedAbout("venue_motor_stats").every(
        (c) =>
          hasFilter(c, "lte", "scraped_date", day(-20)) &&
          hasFilter(c, "eq", "venue_code", V),
      ),
  );
}
{
  // 当日のレース: 2連率・3連率を機力指数の期間の値に差し替える。機力指数は「このレースの直前まで」
  const { tt, tables } = breakdownWorld();
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  fake.reset(tables);
  const today = await getRaceMotorBreakdown(tt, V, 90);
  const [r1, r2] = today.rows;
  check(
    "一覧表（当日）: 機力指数（このレースの直前まで。同日の後のレース・このレース自身は入れない）で2連率・3連率を差し替え、rate_source は recalc",
    r1.rate_source === "recalc" &&
      r1.sample_count === 3 &&
      near(r1.power_index, -50 / 3) &&
      near(r1.motor_2rate, 100 / 3) &&
      near(r1.motor_3rate, 200 / 3) &&
      r1.official_2rate === 41.2 &&
      r1.official_3rate === 61.5 &&
      // 走りの無いモーターは公式値のまま
      r2.sample_count === 0 &&
      r2.power_index === null &&
      r2.motor_2rate === 30 &&
      r2.motor_3rate === 50,
  );
  check(
    "一覧表（当日）: 優出・優勝・1着率は最新のスナップショット",
    r1.final_count === 5 &&
      r1.championship_count === 2 &&
      r1.first_place_count === 14 &&
      r1.race_count === 70 &&
      r2.final_count === 1,
  );
  // 日付が変わって過去レースになったら、当日に保存した再計算の値を読まず、公式値で出す
  clockOffsetMs = 86400000;
  const nextDay = await getRaceMotorBreakdown(tt, V, 90);
  check(
    "一覧表: 日付が変わって過去レース扱いになったら、当日に保存した再計算の値を読まず、公式値（official）で出す",
    nextDay.rows.every(
      (r) => r.rate_source === "official" && r.power_index === null,
    ) &&
      nextDay.rows[0].motor_2rate === 41.2 &&
      nextDay.rows[0].motor_3rate === 61.5,
  );
  clockOffsetMs = 0;
}
check(
  "isPastRace: レースの日付が今日（JST）より前なら過去（当日・先の日は過去でない）",
  isPastRace(rid(-1, 1)) === true &&
    isPastRace(rid(0, 1)) === false &&
    isPastRace(rid(1, 1)) === false,
);
{
  // 会場公式の成績: asOfDate 以前で最新のスナップショット。キャッシュのキーを分ける
  const { tables } = breakdownWorld();
  clearCache();
  fake.reset({
    ...tables,
    venue_motor_stats: [
      ...tables.venue_motor_stats,
      {
        venue_code: V,
        motor_number: M,
        scraped_date: day(-2),
        final_count: 8,
        championship_count: 3,
        first_place_count: 20,
        race_count: 90,
      },
    ],
  });
  const asOf = await getVenueMotorStats(V, M, day(-20));
  const latest = await getVenueMotorStats(V, M);
  const asOfAgain = await getVenueMotorStats(V, M, day(-20));
  const none = await getVenueMotorStats(V, M, day(-40));
  check(
    "getVenueMotorStats: asOfDate 以前で最新のスナップショットを返し（無ければ null）、asOfDate なしの呼び出しとキャッシュを分ける",
    asOf.scrapedDate === day(-30) &&
      asOf.finalCount === 3 &&
      asOf.raceCount === 50 &&
      latest.scrapedDate === day(-2) &&
      latest.finalCount === 8 &&
      same(asOfAgain, asOf) &&
      none === null,
  );
}
{
  // 会場内順位: asOfDate 以前のスナップショット（過去レースのドリルダウン）。同値は同順位。出走数 0 は外す
  const row = (
    motor_number,
    scraped_date,
    top2_rate,
    accident_rate,
    race_count = 10,
  ) => ({
    venue_code: V,
    motor_number,
    scraped_date,
    top2_rate,
    win_rate: top2_rate,
    top3_rate: top2_rate,
    accident_rate,
    final_count: 0,
    championship_count: 0,
    race_count,
    stats_period_end: null,
  });
  const tables = {
    venue_motor_stats: [
      row(24, day(-30), 50, 0.1),
      row(25, day(-30), 60, 0.1),
      row(26, day(-30), 50, 0.1),
      row(27, day(-30), null, null),
      row(28, day(-30), 99, 0.1, 0),
      row(24, day(-10), 70, 0.2),
      row(25, day(-10), 60, 0.1),
      row(26, day(-10), 50, 0.2),
      row(27, day(-10), null, null),
      row(28, day(-10), 99, 0.1, 0),
      { ...row(24, day(-10), 70, 0.2), venue_code: 16 },
    ],
  };
  clearCache();
  fake.reset(tables);
  const old = await getVenueMotorRanking(V, M, "top2Rate", day(-20));
  const latest = await getVenueMotorRanking(V, M, "top2Rate");
  const accident = await getVenueMotorRanking(V, M, "accidentRate");
  const snapshot = await getVenueMotorSnapshot(V, day(-20));
  check(
    "会場内順位: asOfDate 以前のスナップショットで、同じ値は同じ順位（2位タイ）・値なしと出走数 0 は母数に入れない",
    same(old, {
      rank: 2,
      tied: 2,
      total: 3,
      metric: "top2Rate",
      value: 50,
      scrapedDate: day(-30),
    }),
  );
  check(
    "会場内順位: asOfDate なしは最新のスナップショット、事故率は低いほど上位（24号機は 0.2 で2位タイ）",
    same(latest, {
      rank: 1,
      tied: 1,
      total: 3,
      metric: "top2Rate",
      value: 70,
      scrapedDate: day(-10),
    }) &&
      accident.rank === 2 &&
      accident.tied === 2 &&
      accident.metric === "accidentRate",
  );
  check(
    "会場スナップショット（getVenueMotorSnapshot）: asOfDate 以前で最新の scraped_date の全モーターを返す",
    snapshot.state === "ok" &&
      snapshot.scrapedDate === day(-30) &&
      snapshot.rows.length === 5,
  );
  const stale = await run(tables, async () => {
    seed(`venue-motor-ranking-v2-${V}-${M}-top2Rate`, { rank: 99 });
    return getVenueMotorRanking(V, M, "top2Rate");
  });
  check("会場内順位: 旧版（v2）のキャッシュを読まない", stale.rank === 1);
}

// ---- 5. getRacesForVenueSince: beforeRaceId より前（<）に限り、includeTarget でだけ対象を含める ----
{
  const tables = {
    races: [
      rid(-9, 1),
      rid(-9, 2),
      rid(-9, 3),
      rid(-8, 1),
      rid(-30, 1),
      rid(-9, 2).replace("-15-", "-16-"),
    ].map(race),
  };
  const target = rid(-9, 2);
  clearCache();
  fake.reset(tables);
  const ids = (rows) => rows.map((r) => r.race_id);
  const plain = await getRacesForVenueSince(V, day(-20), target);
  const incl = await getRacesForVenueSince(V, day(-20), target, {
    includeTarget: true,
  });
  const all = await getRacesForVenueSince(V, day(-20));
  check(
    "getRacesForVenueSince: 既定は対象のレースを除き（race_id <）、includeTarget は対象まで含む（race_id <=）。後のレース・開始日より前・他会場は入らず、キャッシュのキーを分ける",
    same(ids(plain), [rid(-9, 1)]) &&
      same(ids(incl), [rid(-9, 1), target]) &&
      same(ids(all), [rid(-9, 1), target, rid(-9, 3), rid(-8, 1)]),
  );
  const raceQueries = askedAbout("races");
  check(
    "getRacesForVenueSince: 開始日（当日を含む）から beforeRaceId の日付まで、会場で絞って読む",
    hasFilter(raceQueries[0], "gte", "race_date", day(-20)) &&
      hasFilter(raceQueries[0], "lte", "race_date", day(-9)) &&
      hasFilter(raceQueries[0], "eq", "venue_code", V),
  );
  // 過去レースの上限は長い期限で保存する（キーの末尾が race_id のまま。2時間後に開いても取り直さない）
  const callsBefore = fake.calls.length;
  clockOffsetMs = 2 * 3600 * 1000;
  await getRacesForVenueSince(V, day(-20), target);
  await getRacesForVenueSince(V, day(-20), target, { includeTarget: true });
  check(
    "getRacesForVenueSince: 過去レースが上限の結果は、includeTarget の有無によらず2時間後も取り直さない（キャッシュのキーの末尾が race_id のまま）",
    fake.calls.length === callsBefore,
  );
  clockOffsetMs = 0;
}

{
  // 優勝履歴: 過去レースではそのレースより前の優勝に限る（現行世代の絞りは verify-motor-championship-generation.js が見る）
  const f1 = rid(-30, 12);
  const f2 = rid(-6, 12);
  const stage = (race_id) => ({
    race_id,
    race_stage: "優勝戦",
    races: { venue_code: V },
  });
  const tables = {
    venue_motor_start_dates: startRows(V, G),
    race_conditions: [stage(f1), stage(f2)],
    race_entries: [ent(f1, 1, 11), ent(f2, 2, 12)],
    race_results: [resultOf(f1, [1]), resultOf(f2, [2])],
  };
  clearCache();
  fake.reset(tables);
  const { getVenueMotorChampionshipHistory } = motor3;
  const all = await getVenueMotorChampionshipHistory(V, M);
  const before = await getVenueMotorChampionshipHistory(V, M, f2);
  check(
    "優勝履歴: beforeRaceId を渡すとそのレースより前（<）の優勝に限り、渡さない呼び出しのキャッシュを読まない",
    same(
      all.wins.map((w) => w.raceId),
      [f2, f1],
    ) &&
      same(
        before.wins.map((w) => w.raceId),
        [f1],
      ),
  );
}

// 純関数の行の組み立て（過去レースは公式値のまま）。ソースを検査する
// 行の組み立ては src/pure/raceMotorBreakdown.js の pastMotorRows に移した（開発効率の計画 段3）
const pastRowsFn = slice0(
  read("src/pure/raceMotorBreakdown.js"),
  "export function pastMotorRows(",
  "\n}\n",
);
check(
  '一覧表（過去）: rate_source: "official"・power_index: null',
  pastRowsFn.includes('rate_source: "official"') &&
    pastRowsFn.includes("power_index: null"),
);
check(
  "一覧表（過去）: motor_2rate / motor_3rate を差し替えない（行の組み立て側）",
  !/motor_2rate:/.test(pastRowsFn) &&
    !/motor_3rate:/.test(pastRowsFn) &&
    !pastRowsFn.includes("actual_rate"),
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
// 選手ページの今節のモーター（RA40 BOA-1673 で racerService.js から移した）
const racer = read("src/services/motorQueries7.js");
check(
  "選手ページ: 直近出走が入れ替え前なら機力指数・公式成績を出さない",
  racer.includes("date < generationStart") &&
    // 領域の Queries の名前つき import（殻 supabaseDataService は RA40 で消えた）
    /preGeneration\s*\?\s*null\s*:\s*getMotorPowerIndex\(/.test(racer),
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
  {
    // 動きの確認: 同じ filter 式を実データの形に当てる（既定は対象を除き、includeTarget は含む）
    const rows = [
      "2026-11-04-01-01",
      "2026-11-04-01-02",
      "2026-11-04-01-03",
    ].map((race_id) => ({ race_id }));
    const target = "2026-11-04-01-02";
    const excl = rows.filter((r) => r.race_id < target).map((r) => r.race_id);
    const incl = rows.filter((r) => r.race_id <= target).map((r) => r.race_id);
    check(
      "getRacesForVenueSince: 既定は対象を除き、includeTarget は対象まで含む（後のレースは入らない）",
      excl.join() === "2026-11-04-01-01" &&
        incl.join() === "2026-11-04-01-01,2026-11-04-01-02",
    );
  }
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
  // 領域の Queries の名前つき import（殻 supabaseDataService は RA40 で消えた）
  /let venueGenerationStart = null;\s*try \{\s*venueGenerationStart =\s*await getMotorGenerationStart\(/.test(
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
  sayErr(`\n${failures.length}件失敗`);
  process.exit(1);
}
say("\nすべて成功");
