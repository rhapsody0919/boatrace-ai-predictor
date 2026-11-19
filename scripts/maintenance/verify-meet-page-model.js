#!/usr/bin/env node
/**
 * src/utils/meetPageModel.js（節ページの日程・段階・基準のレース・勝ち上がり・勝負駆け）を
 * 固定の入力で検証する（BOA-682、docs/design/meet-page/plan.md §2）。
 *
 * 崩れると、節ページが前後の節を混ぜる・夜に予選の最後のレースの結果を落とす・
 * 予選最終日の夜に公式の得点率を使わない・勝負駆けを誤る。
 *
 * 入力は児島 2026-09-28〜10-03 の G1（種別・series_day は本番の race_conditions、
 * 2026-10-02 取得）。10/3 の種別はこの時点で未取得のため、通常の番組（12R 優勝戦）を置いた。
 */
import { meetDaysOf, meetPageState, pickMeetAnchor } from "../../src/utils/meetPageModel.js";

import {
  createFakeSupabase,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./verifyData/fakeServiceSupabase.js";
import { createMeetPageHarness } from "./verifyData/meet-page-model.js";
import { runMeetPageModelScenes1 } from "./verifyData/meet-page-model-scenes.js";

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const VV = "16";
const id = (d, r) => `${d}-${VV}-${String(r).padStart(2, "0")}`;
const day = (
  d,
  seriesDay,
  stageOf,
  { finalDay = false, nullLast = false } = {},
) =>
  Array.from({ length: 12 }, (_, i) => ({
    race_id: id(d, i + 1),
    race_stage: stageOf(i + 1),
    series_day: nullLast && i === 11 ? null : seriesDay,
    is_final_day: finalDay,
  }));

// 前の節（一般戦、9/20〜9/22 の3日開催に縮めた架空の節）と児島G1（9/28〜10/3）
const conditions = [
  ...day("2026-09-20", 1, () => "予選"),
  ...day("2026-09-21", 2, (r) => (r >= 10 ? "準優勝戦" : "一般")),
  ...day("2026-09-22", 3, (r) => (r === 12 ? "優勝戦" : "一般"), {
    finalDay: true,
  }),
  ...day("2026-09-28", 1, (r) => (r === 12 ? "キングドリーム" : "予選")),
  ...day("2026-09-29", 2, (r) => (r === 12 ? "ガァ〜コＤＲ" : "予選")),
  ...day("2026-09-30", 3, () => "予選"),
  ...day("2026-10-01", 4, () => "予選"),
  ...day("2026-10-02", 5, (r) => (r >= 10 ? "準優勝戦" : "一般"), {
    nullLast: true,
  }),
  ...day("2026-10-03", 6, (r) => (r === 12 ? "優勝戦" : "一般"), {
    finalDay: true,
  }),
];
const START = "2026-09-28";
const window = conditions.filter((c) => c.race_id >= START);
const entries = window.map((c) => ({ race_id: c.race_id }));
const meetDays = meetDaysOf(START, window, entries);
const raceIds = window.map((c) => c.race_id);
const doneThrough = (lastDone) => new Set(raceIds.filter((r) => r <= lastDone));

// --- meetDaysOf ---
check("児島の節は6日", meetDays, [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
]);
check(
  "前の節の初日（9/20）を渡すと前の節の日だけ",
  meetDaysOf("2026-09-20", conditions, []),
  ["2026-09-20", "2026-09-21", "2026-09-22"],
);
check(
  "節の途中の日（9/30）を初日として渡すと空",
  meetDaysOf(
    "2026-09-30",
    window.filter((c) => c.race_id >= "2026-09-30"),
    [],
  ),
  [],
);
check(
  "次の節が続けて始まっても混ぜない（10/4 から series_day=1）",
  meetDaysOf(START, [...window, ...day("2026-10-04", 1, () => "予選")], [])
    .length,
  6,
);

// --- meetPageState ---
const base = {
  startDate: START,
  meetDays,
  hasEntries: true,
  grade: "G1",
  title: "児島キングカップ開設７４周年記念競走",
  conditions: window,
  raceIds,
};
const state = (today, done) =>
  meetPageState({ ...base, today, doneRaceIds: done });
check(
  "開幕前（出走表なし・今日<初日）",
  meetPageState({
    ...base,
    hasEntries: false,
    meetDays: [],
    today: "2026-09-20",
    doneRaceIds: new Set(),
  }),
  "preOpen",
);
check(
  "初日の朝（出走表投入前）も開幕前",
  meetPageState({
    ...base,
    hasEntries: false,
    meetDays: [],
    today: START,
    doneRaceIds: new Set(),
  }),
  "preOpen",
);
check(
  "初日を過ぎて何も無い節は見つからない",
  meetPageState({
    ...base,
    hasEntries: false,
    meetDays: [],
    today: "2026-09-29",
    doneRaceIds: new Set(),
  }),
  "notFound",
);
check(
  "節の途中の日（2日目）を初日として開くと、今日がその日でも見つからない",
  meetPageState({
    ...base,
    meetDays: [],
    hasEntries: false,
    windowHasRaces: true,
    startDate: "2026-09-29",
    today: "2026-09-29",
    doneRaceIds: new Set(),
  }),
  "notFound",
);
check(
  "一般戦は対象外",
  meetPageState({
    ...base,
    grade: "ippan",
    today: START,
    doneRaceIds: new Set(),
  }),
  "outOfScope",
);
check(
  "G3は対象外",
  meetPageState({ ...base, grade: "G3", today: START, doneRaceIds: new Set() }),
  "outOfScope",
);
check(
  "グランプリは対象外",
  meetPageState({
    ...base,
    grade: "SG",
    title: "第４０回グランプリ／グランプリシリーズ",
    today: START,
    doneRaceIds: new Set(),
  }),
  "outOfScope",
);
check(
  "2日目の昼は予選中",
  state("2026-09-29", doneThrough(id("2026-09-29", 5))),
  "prelim",
);
check(
  "3日目の夜も予選中（勝負駆けは出さない）",
  state("2026-09-30", doneThrough(id("2026-09-30", 12))),
  "prelim",
);
check(
  "4日目の昼は予選最終日",
  state("2026-10-01", doneThrough(id("2026-10-01", 8))),
  "prelimFinalDay",
);
check(
  "4日目の夜は予選終了",
  state("2026-10-01", doneThrough(id("2026-10-01", 12))),
  "prelimDone",
);
check(
  "5日目は準優勝戦の日",
  state("2026-10-02", doneThrough(id("2026-10-02", 9))),
  "semifinalDay",
);
check(
  "6日目は優勝戦の日",
  state("2026-10-03", doneThrough(id("2026-10-03", 11))),
  "finalDay",
);
check(
  "優勝戦の結果が出たら節終了",
  state("2026-10-03", doneThrough(id("2026-10-03", 12))),
  "finished",
);
check(
  "節の後日に開いても節終了",
  state("2026-10-10", doneThrough(id("2026-10-03", 12))),
  "finished",
);

// BOA-780: 初日でない URL でも、指定日の既知の対象外グレードは案内する。
const middleStart = "2026-09-29";
const middleDays = meetDaysOf(middleStart, window, entries);
for (const grade of ["ippan", "G3", "SG", "G1", "G2", null, ""]) {
  check(
    `途中日 URL・指定日のグレード ${JSON.stringify(grade)}`,
    meetPageState({
      ...base,
      startDate: middleStart,
      today: middleStart,
      meetDays: middleDays,
      hasEntries: false,
      grade: null,
      startDateGrade: grade,
      windowHasRaces: true,
      doneRaceIds: new Set(),
    }),
    ["ippan", "G3"].includes(grade) ? "outOfScope" : "notFound",
  );
}
for (const [today, expected] of [
  ["2026-09-27", "preOpen"],
  [START, "preOpen"],
  ["2026-09-29", "notFound"],
]) {
  check(
    `指定日のレースが無い・${today}（別の日の一般戦を使わない）`,
    meetPageState({
      ...base,
      today,
      grade: "ippan",
      startDateGrade: null,
      meetDays: [],
      hasEntries: false,
      doneRaceIds: new Set(),
    }),
    expected,
  );
}
check(
  "race_series・種別・出走表が無く指定日の races だけある一般戦も対象外",
  meetPageState({
    ...base,
    today: START,
    grade: null,
    startDateGrade: "ippan",
    meetDays: [],
    hasEntries: false,
    doneRaceIds: new Set(),
  }),
  "outOfScope",
);

// 取得関数（src/services/meetQueries3.js の getMeetPage）を、偽の supabase（メモリ上の表）の上で呼ぶ。
// 指定日のグレードの受け渡し（状態の決まり方）と、並列取得の失敗の伝わり方を見る。
registerFakeServiceSupabase();
// 失敗は fake.fail(表, 例外) で入れる（await でも maybeSingle でも reject）
const fake = setFakeSupabase(createFakeSupabase());
const { getMeetPage } = await import("../../src/services/meetQueries3.js");

for (const [label, races, expected] of [
  [
    "指定日の一般戦",
    [{ race_id: id(middleStart, 1), race_grade: "ippan" }],
    "outOfScope",
  ],
  [
    "指定日のSG",
    [{ race_id: id(middleStart, 1), race_grade: "SG" }],
    "notFound",
  ],
  [
    "翌日の一般戦だけ",
    [{ race_id: id("2026-09-30", 1), race_grade: "ippan" }],
    "notFound",
  ],
]) {
  fake.reset({
    race_conditions: day(middleStart, 2, () => "予選"),
    races,
  });
  const page = await getMeetPage(16, middleStart, middleStart);
  check(`getMeetPage・race_seriesなし・${label}`, page.state, expected);
  check(
    `getMeetPage・${label}は board・qualifiers を持たない`,
    [page.board, page.qualifiers],
    [null, null],
  );
}

// BOA-1187: 並列取得のどのクエリも失敗を notFound に変換しない。
for (const table of [
  "race_series",
  "race_conditions",
  "races",
  "race_results",
  "race_entries",
  "racer_series_points",
]) {
  const error = new Error(`local failure: ${table}`);
  fake.reset({}, { [table]: error });
  let caught;
  try {
    await getMeetPage(16, START, "2026-09-27");
  } catch (err) {
    caught = err;
  }
  check(`getMeetPage・${table} の失敗は同じ例外で伝播`, caught === error, true);
}

// 実ページの取得 effect・状態導出・本文分岐を実行する。依存はローカルの hook/JSX
// スタブに置換する（DOM 描画は E2E の担当）。本番への取得はしない。
const ui = createMeetPageHarness(START);
const pageKey = `16-${START}`;
const rejected = {
  getMeetPage: () => Promise.reject(new Error("local fetch failure")),
};
check(
  "取得待ちは LoadingScreen",
  ui.render(rejected).body.type,
  "LoadingScreen",
);
check("取得待ちは noindex にしない", ui.robots, false);
ui.effects[0]();
// effect の then→catch と state 更新を完了させる。
await new Promise((resolve) => setImmediate(resolve));
check("例外で failedKey が対象の節になる", ui.stored[1], pageKey);
check(
  "取得失敗は DataFetchError",
  ui.render(rejected).body.type,
  "DataFetchError",
);
check("取得失敗は noindex にしない", ui.robots, false);
for (const [state, knownMeet, expected] of [
  ["preOpen", true, true],
  ["preOpen", false, true],
  ["notFound", false, true],
  ["outOfScope", true, true],
  ["prelim", true, false],
  ["finished", true, false],
]) {
  ui.stored = [{ key: pageKey, page: { state, knownMeet } }, null];
  ui.render(rejected);
  check(
    `MeetPage・${state}・knownMeet=${knownMeet} の noindex`,
    ui.robots,
    expected,
  );
}

// --- pickMeetAnchor ---
const anchor = (today, done) =>
  pickMeetAnchor({
    today,
    meetDays,
    raceIds,
    doneRaceIds: done,
    venueCode: 16,
    conditions: window,
  });
check(
  "昼は今日のまだ済んでいない最初のレース",
  anchor("2026-09-30", doneThrough(id("2026-09-30", 6))),
  { raceId: id("2026-09-30", 7), useOfficial: undefined },
);
check(
  "ドリーム戦の日の夜は架空ID -99（12Rの結果を落とさない）・予選は終わっていない",
  anchor("2026-09-28", doneThrough(id("2026-09-28", 12))),
  { raceId: "2026-09-28-16-99", useOfficial: false },
);
check(
  "予選中の日の夜",
  anchor("2026-09-30", doneThrough(id("2026-09-30", 12))),
  { raceId: "2026-09-30-16-99", useOfficial: false },
);
check(
  "予選最終日の昼は実在のレース",
  anchor("2026-10-01", doneThrough(id("2026-10-01", 3))),
  { raceId: id("2026-10-01", 4), useOfficial: undefined },
);
check(
  "予選最終日の夜は架空IDで公式値を使う",
  anchor("2026-10-01", doneThrough(id("2026-10-01", 12))),
  { raceId: "2026-10-01-16-99", useOfficial: true },
);

// ---- 後半の場面（verifyData/meet-page-model-scenes.js） ----
runMeetPageModelScenes1({ check, id, window, meetDays, raceIds, doneThrough, anchor });

if (failures.length > 0) {
  console.error(
    `❌ verify-meet-page-model: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-meet-page-model: ${checked} 件すべて一致`);
