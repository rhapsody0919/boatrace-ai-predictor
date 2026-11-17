#!/usr/bin/env node
/** JST 日付関数の現在の挙動を固定する（BOA-1113）。DB・通信・実時刻は使わない。 */
import assert from "node:assert/strict";
import * as B from "../lib/dateUtils.js";
import * as F from "../../src/utils/dateUtils.js";
import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";

registerFakeServiceSupabase();

const RealDate = globalThis.Date;
let passed = 0;
function check(name, actual, expected) {
  assert.deepStrictEqual(actual, expected, name);
  passed += 1;
}

function withFixedTime(instant, run) {
  const fixedMs = RealDate.parse(instant);
  class FixedDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedMs] : args));
    }
    static now() {
      return fixedMs;
    }
  }
  const previous = globalThis.Date;
  try {
    globalThis.Date = FixedDate;
    check("時計: new Date()", new Date().getTime(), fixedMs);
    check("時計: Date.now()", Date.now(), fixedMs);
    run();
  } finally {
    globalThis.Date = previous;
  }
}

// 期待値は計算で作らず、依頼の表の値をそのまま置く。
const CLOCK_CASES = [
  {
    instant: "2026-10-24T15:00:00Z",
    today: "2026-10-25",
    yesterday: "2026-10-24",
    weekAgo: "2026-10-18",
    hhmm: "00:00",
    wallClock: "2026-10-25T00:00:00.000Z",
    dates: ["2026-10-25", "2026-10-24", "2026-10-23"],
  },
  {
    instant: "2026-10-24T14:59:59.999Z",
    today: "2026-10-24",
    yesterday: "2026-10-23",
    weekAgo: "2026-10-17",
    hhmm: "23:59",
    wallClock: "2026-10-24T23:59:59.999Z",
    dates: ["2026-10-24", "2026-10-23", "2026-10-22"],
  },
  {
    instant: "2026-10-25T00:30:00+09:00",
    today: "2026-10-25",
    yesterday: "2026-10-24",
    weekAgo: "2026-10-18",
    hhmm: "00:30",
    wallClock: "2026-10-25T00:30:00.000Z",
    dates: ["2026-10-25", "2026-10-24", "2026-10-23"],
  },
  {
    instant: "2026-10-24T23:59:59.999+09:00",
    today: "2026-10-24",
    yesterday: "2026-10-23",
    weekAgo: "2026-10-17",
    hhmm: "23:59",
    wallClock: "2026-10-24T23:59:59.999Z",
    dates: ["2026-10-24", "2026-10-23", "2026-10-22"],
  },
  {
    instant: "2026-03-01T08:59:59+09:00",
    today: "2026-03-01",
    yesterday: "2026-02-28",
    weekAgo: "2026-02-22",
    hhmm: "08:59",
    wallClock: "2026-03-01T08:59:59.000Z",
    dates: ["2026-03-01", "2026-02-28", "2026-02-27"],
  },
  {
    instant: "2024-03-01T00:00:00+09:00",
    today: "2024-03-01",
    yesterday: "2024-02-29",
    weekAgo: "2024-02-23",
    hhmm: "00:00",
    wallClock: "2024-03-01T00:00:00.000Z",
    dates: ["2024-03-01", "2024-02-29", "2024-02-28"],
  },
  {
    instant: "2026-01-01T00:00:00+09:00",
    today: "2026-01-01",
    yesterday: "2025-12-31",
    weekAgo: "2025-12-25",
    hhmm: "00:00",
    wallClock: "2026-01-01T00:00:00.000Z",
    dates: ["2026-01-01", "2025-12-31", "2025-12-30"],
  },
];

for (const c of CLOCK_CASES) {
  withFixedTime(c.instant, () => {
    const eq = (name, actual, expected) =>
      check(`${name} @ ${c.instant}`, actual, expected);
    eq("B.getTodayDateJST", B.getTodayDateJST(), c.today);
    eq("F.getTodayJST", F.getTodayJST(), c.today);
    eq("B.getYesterdayDateJST", B.getYesterdayDateJST(), c.yesterday);
    eq("F.getYesterdayJST", F.getYesterdayJST(), c.yesterday);
    eq("F.getDaysAgoJST(7)", F.getDaysAgoJST(7), c.weekAgo);
    eq("F.getDaysAgoJST(0)", F.getDaysAgoJST(0), c.today);
    eq("B.getDateDaysAgo(7)", B.getDateDaysAgo(7), c.weekAgo);
    eq("B.getDateDaysAgo(0)", B.getDateDaysAgo(0), c.today);
    eq("F.getNowHHMMJST", F.getNowHHMMJST(), c.hhmm);
    eq("F.getDateListJST(3)", F.getDateListJST(3), c.dates);
    eq("F.getDateListJST(0)", F.getDateListJST(0), []);
    eq("F.getJSTDateInfo", F.getJSTDateInfo(), {
      todayStr: c.today,
      yesterdayStr: c.yesterday,
    });
    eq("F.isToday(今日)", F.isToday(c.today), true);
    eq("F.isToday(昨日)", F.isToday(c.yesterday), false);
    eq("B.getJSTNow", B.getJSTNow().toISOString(), c.wallClock);
  });
  check("時計の復元", globalThis.Date, RealDate);
}
// 失敗した場合も finally で時計を戻すことを確かめる。
const sentinel = new Error("時計の復元の確認用");
try {
  withFixedTime(CLOCK_CASES[0].instant, () => {
    throw sentinel;
  });
} catch (error) {
  check("時計: 例外の伝播", error, sentinel);
}
check("時計: 例外後の復元", globalThis.Date, RealDate);

check("B.formatDateForUrl", B.formatDateForUrl("2026-10-25"), "20261025");
check(
  "B.parseDateArg(日付あり)",
  B.parseDateArg(["--date=2026-10-01", "x"]),
  "2026-10-01",
);
check("B.parseDateArg(日付なし)", B.parseDateArg(["x"]), null);
check("B.parseDateArg(空配列)", B.parseDateArg([]), null);
for (const [name, module] of [
  ["B", B],
  ["F", F],
]) {
  check(`${name}.parseDateInfo`, module.parseDateInfo("2026-10-05"), {
    year: 2026,
    month: 10,
    day: 5,
  });
}
check(
  "B.extractDateFromRaceId",
  B.extractDateFromRaceId("2026-10-25-04-12"),
  "2026-10-25",
);
check(
  "B.extractVenueCodeFromRaceId(04)",
  B.extractVenueCodeFromRaceId("2026-10-25-04-12"),
  4,
);
check(
  "B.extractVenueCodeFromRaceId(24)",
  B.extractVenueCodeFromRaceId("2026-10-25-24-01"),
  24,
);
for (const [date, days, expected] of [
  ["2026-10-25", 1, "2026-10-26"],
  ["2026-10-31", 1, "2026-11-01"],
  ["2026-12-31", 1, "2027-01-01"],
  ["2024-02-28", 1, "2024-02-29"],
  ["2025-02-28", 1, "2025-03-01"],
  ["2024-03-01", -1, "2024-02-29"],
  ["2026-10-25", 0, "2026-10-25"],
  ["2026-10-25", -30, "2026-09-25"],
  ["2026-10-25", 365, "2027-10-25"],
]) {
  check(
    `B.addDaysToDateString(${date}, ${days})`,
    B.addDaysToDateString(date, days),
    expected,
  );
}

// JSDoc に仕様が無い入力。観測値は表示するだけで assert しない。
const KNOWN_GAPS = [
  {
    input: 'B.parseDateArg(["--date="])',
    specification: "空の日付の扱いは未定義",
    current: '""（null ではない）',
    observe: () => B.parseDateArg(["--date="]),
  },
  {
    input: 'B.extractVenueCodeFromRaceId("2026-10-25")',
    specification: "会場の無い文字列の扱いは未定義",
    current: "NaN",
    observe: () => B.extractVenueCodeFromRaceId("2026-10-25"),
  },
  {
    input: 'F.parseDateInfo("2026-1-5")',
    specification: "ゼロ埋めの無い日付の扱いは未定義",
    current: "{year:2026, month:1, day:5}",
    observe: () => F.parseDateInfo("2026-1-5"),
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（assert 対象外）`);
for (const gap of KNOWN_GAPS) {
  console.log(
    `${gap.input}: ${gap.specification} / 記録値=${gap.current} / 今の値=`,
    gap.observe(),
  );
}

// 同値の式への回帰は出力比較では検出できないため、サービス層が日付の共通関数（getDaysAgoJST・getTodayJST）で
// 動くことも、時計を固定して偽の supabase クライアントの上で確かめる（BOA-1352。RA42: 本文の正規表現から置き換え）。
// order は記録だけで、表の順（RACE_DATES の昇順）のまま返す
const fake = setFakeSupabase(createFakeSupabase({}, { sortByOrder: false }));
// サービス層のキャッシュは localStorage にも書く。Node には無いので、何も残さない物を置く
installLocalStorage();
const { clearCache } = await import("../../src/services/core.js");
const { getAvailableDates, getMorningDigest } =
  await import("../../src/services/scheduleQueries.js");

/** 時計を instant に固定し、advance(ms) で進められる（キャッシュの期限を見るため）。run の後に必ず戻す */
async function withClock(instant, run) {
  let nowMs = RealDate.parse(instant);
  class ClockDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [nowMs] : args));
    }
    static now() {
      return nowMs;
    }
  }
  const previous = globalThis.Date;
  try {
    globalThis.Date = ClockDate;
    await run((ms) => {
      nowMs += ms;
    });
  } finally {
    globalThis.Date = previous;
  }
}

// getAvailableDates(days): 開始日（JST の今日から days 日前）以降のレースの日付だけを取る。日の境（JST 0 時）をまたぐ時刻でも
const RACE_DATES = [
  "2025-12-24",
  "2025-12-30",
  "2026-02-22",
  "2026-02-27",
  "2026-03-01",
  "2026-10-17",
  "2026-10-18",
  "2026-10-22",
  "2026-10-23",
  "2026-10-24",
  "2026-10-25",
];
fake.reset({ races: RACE_DATES.map((race_date) => ({ race_date })) });
for (const c of CLOCK_CASES) {
  await withClock(c.instant, async () => {
    for (const [days, since] of [
      [7, c.weekAgo],
      [0, c.today],
    ]) {
      clearCache();
      fake.calls.length = 0;
      const dates = await getAvailableDates(days);
      const gte = fake.calls
        .flatMap((q) => q.filters)
        .filter(([op]) => op === "gte");
      check(
        `getAvailableDates(${days}) の開始日 @ ${c.instant}`,
        gte.length > 0 &&
          gte.every(([, col, val]) => col === "race_date" && val === since),
        true,
      );
      check(
        `getAvailableDates(${days}) が返す日付 @ ${c.instant}`,
        dates,
        RACE_DATES.filter((d) => d >= since),
      );
    }
  });
}

// getMorningDigest(date): 今日（JST）より前の日は長期、今日は30分のキャッシュ。今日の判定は JST の日付（UTC でない）。
// 1回目の30分後（時計を進めて JST の日が変わらない時刻から始める）に、取り直したか（morning_digest_days への問い合わせ）で見る
const MIN = 60 * 1000;
const DIGEST_CASES = [
  // JST 0 時ちょうど（UTC では前日）。UTC の日付で見る実装だと 10-24 を今日として取り直してしまう
  { instant: "2026-10-24T15:00:00Z", date: "2026-10-24", refetched: false },
  { instant: "2026-10-24T15:00:00Z", date: "2026-10-25", refetched: true },
  {
    instant: "2026-10-25T00:30:00+09:00",
    date: "2026-10-24",
    refetched: false,
  },
  { instant: "2026-10-25T00:30:00+09:00", date: "2026-10-25", refetched: true },
  {
    instant: "2026-03-01T08:30:00+09:00",
    date: "2026-02-28",
    refetched: false,
  },
  { instant: "2026-03-01T08:30:00+09:00", date: "2026-03-01", refetched: true },
  {
    instant: "2024-03-01T00:00:00+09:00",
    date: "2024-02-29",
    refetched: false,
  },
  { instant: "2024-03-01T00:00:00+09:00", date: "2024-03-01", refetched: true },
];
for (const { instant, date, refetched } of DIGEST_CASES) {
  fake.reset({
    morning_digest_days: [{ digest_date: date, generated_at: "x" }],
    morning_digest_rows: [],
  });
  clearCache();
  await withClock(instant, async (advance) => {
    const dayQueries = () =>
      fake.calls.filter((q) => q.table === "morning_digest_days").length;
    await getMorningDigest(date);
    check(
      `getMorningDigest(${date}) 1回目は取る @ ${instant}`,
      dayQueries(),
      1,
    );
    advance(29 * MIN);
    await getMorningDigest(date);
    check(
      `getMorningDigest(${date}) 29分後はキャッシュ @ ${instant}`,
      dayQueries(),
      1,
    );
    advance(2 * MIN);
    await getMorningDigest(date);
    check(
      `getMorningDigest(${date}) 31分後は${refetched ? "取り直す（今日は30分）" : "キャッシュのまま（過去の日は長期）"} @ ${instant}`,
      dayQueries(),
      refetched ? 2 : 1,
    );
  });
}
check("時計の復元（サービス層）", globalThis.Date, RealDate);
console.log(`✅ JST 日付関数: ${passed} assertions passed`);
