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
import {
  meetDaysOf,
  meetPageState,
  pickMeetAnchor,
  buildQualifiers,
  pickShobugake,
  isOutOfScopeMeetTitle,
  officialAsOfDate,
  borderTieOf,
} from "../../src/utils/meetPageModel.js";

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
check(
  "準優の日の夜（12R の series_day が null でも日の値で判定）",
  anchor("2026-10-02", doneThrough(id("2026-10-02", 12))),
  { raceId: "2026-10-02-16-99", useOfficial: true },
);
check(
  "優勝戦の前は最終日12R、後は架空ID（キャッシュのキーが分かれる）",
  [
    anchor("2026-10-03", doneThrough(id("2026-10-03", 11))).raceId,
    anchor("2026-10-03", doneThrough(id("2026-10-03", 12))).raceId,
  ],
  [id("2026-10-03", 12), "2026-10-03-16-99"],
);
check(
  "節の後日は最終日の架空ID",
  anchor("2026-10-10", doneThrough(id("2026-10-03", 12))),
  { raceId: "2026-10-03-16-99", useOfficial: true },
);
check("開幕前は基準なし", anchor("2026-09-27", new Set()), null);

// --- 予選中は公式の表（前夜の時点）を出す（ユーザー決定 2026-10-06、ファン評価1周目 P0・P1） ---
const anchorOfficial = (today, done, officialAsOf) =>
  pickMeetAnchor({
    today,
    meetDays,
    raceIds,
    doneRaceIds: done,
    venueCode: 16,
    conditions: window,
    officialAsOf,
  });
check(
  "公式の表が前夜（2日目）のとき、3日目の昼は3日目の1Rを基準に公式値を使う（当日の結果は混ぜない）",
  anchorOfficial("2026-09-30", doneThrough(id("2026-09-30", 8)), "2026-09-29"),
  { raceId: id("2026-09-30", 1), useOfficial: true },
);
check(
  "予選最終日の朝は、その日の1Rを基準にする（その日の予選の全レースが残りになる）",
  anchorOfficial("2026-10-01", doneThrough(id("2026-09-30", 12)), "2026-09-30"),
  { raceId: id("2026-10-01", 1), useOfficial: true },
);
check(
  "その日の夜に表が更新され、翌日の出走表がまだ無いときは、その日の架空ID",
  pickMeetAnchor({
    today: "2026-09-30",
    meetDays: meetDays.filter((d) => d <= "2026-09-30"),
    raceIds: raceIds.filter((r) => r < "2026-10-01"),
    doneRaceIds: doneThrough(id("2026-09-30", 12)),
    venueCode: 16,
    conditions: window,
    officialAsOf: "2026-09-30",
  }),
  { raceId: "2026-09-30-16-99", useOfficial: true },
);
check(
  "表の時点が今日より後なら使わない（自社計算の基準に戻る）",
  anchorOfficial("2026-09-28", new Set(), "2026-10-01"),
  { raceId: id("2026-09-28", 1), useOfficial: undefined },
);
check(
  "取得時刻から表の時点の日付を出す（22:00 はその日、翌 01:30 は前日）",
  [
    officialAsOfDate("2026-10-05T13:00:39.922+00:00"),
    officialAsOfDate("2026-10-05T16:30:00Z"),
    officialAsOfDate(null),
  ],
  ["2026-10-05", "2026-10-05", null],
);

// --- buildQualifiers（10/2 準優の実データ、着順は架空） ---
const semiEntries = [
  [10, [4960, 4928, 3783, 4266, 4370, 4980]],
  [11, [4762, 4584, 4787, 4497, 4503, 4371]],
  [12, [4320, 4831, 4397, 4205, 4812, 4851]],
].flatMap(([r, ids]) =>
  ids.map((racerId, i) => ({
    race_id: id("2026-10-02", r),
    boat_number: i + 1,
    racer_id: racerId,
    player_name: `p${racerId}`,
  })),
);
const q = buildQualifiers(window, semiEntries, [
  {
    race_id: id("2026-10-02", 10),
    rank1: 2,
    rank2: 1,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
  },
]);
check(
  "準優は3レース",
  q.semifinals.map((r) => r.raceNumber),
  [10, 11, 12],
);
check("準優は18人", q.semifinals.flatMap((r) => r.boats).length, 18);
check(
  "結果のある準優は着順が入る（2号艇が1着）",
  q.semifinals[0].boats.map((b) => b.finish),
  [2, 1, 3, 4, 5, 6],
);
check(
  "結果の無い準優は着順なし",
  q.semifinals[1].boats.every((b) => b.finish === null),
  true,
);
check(
  "優勝戦は1レース（準優を優勝戦に数えない）",
  q.finals.map((r) => r.raceId),
  [id("2026-10-03", 12)],
);
check(
  "準優進出戦は準優勝戦に数えない",
  buildQualifiers(
    [{ race_id: id("2026-10-02", 9), race_stage: "準優進出戦" }],
    [],
    [],
  ).semifinals.length,
  0,
);

// --- pickShobugake ---
const ranking = [
  { racerId: 1, rank: 1, points: 50, runs: 6, rate: 8.33 },
  { racerId: 2, rank: 18, points: 33, runs: 6, rate: 5.5 },
  { racerId: 3, rank: 19, points: 31, runs: 6, rate: 5.17 },
  { racerId: 4, rank: 30, points: 18, runs: 6, rate: 3.0 },
  { racerId: 5, rank: 20, points: 30, runs: 6, rate: 5.0 },
  { racerId: 6, rank: null, points: 40, runs: 6, rate: 6.67, withdrawn: true },
];
const remaining = { 1: 1, 2: 1, 3: 1, 4: 1, 6: 1 };
const shobu = pickShobugake(ranking, 5.5, 18, remaining, {
  1: 10,
  2: 10,
  3: 10,
  4: 10,
  6: 10,
});
check(
  "勝負駆け: 6着で落ちうる枠内(2)・1着で届く枠外(3)。安泰(1)・届かない(4)・残り0(5)・順位外(6)は外す",
  [...shobu].sort(),
  [2, 3],
);
check(
  "ボーダーが無ければ空",
  pickShobugake(ranking, null, 18, remaining, {}).size,
  0,
);

// --- borderTieOf（ファン評価2周目: 18位が同率5人で線の上が22人になる） ---
const ranks = (list) => list.map((rank) => ({ rank }));
check(
  "18位が同率5人なら、同率5人・入れるのは1人",
  borderTieOf(ranks([...Array.from({ length: 17 }, (_, i) => i + 1), 18, 18, 18, 18, 18, 23]), 18),
  { rank: 18, tied: 5, seats: 1 },
);
check(
  "17位が同率3人（17・18位にまたがる）なら、入れるのは2人",
  borderTieOf(ranks([...Array.from({ length: 16 }, (_, i) => i + 1), 17, 17, 17, 20]), 18),
  { rank: 17, tied: 3, seats: 2 },
);
check(
  "線の位置で割れていなければ null",
  borderTieOf(ranks([...Array.from({ length: 18 }, (_, i) => i + 1), 19]), 18),
  null,
);
check("18人に満たなければ null", borderTieOf(ranks([1, 2, 3]), 18), null);

// --- isOutOfScopeMeetTitle ---
check(
  "対象外のタイトル",
  [
    "第４０回グランプリ／グランプリシリーズ",
    "第１４回クイーンズクライマックス",
    "第７回ＢＢＣトーナメント",
    "第７３回ボートレースダービー",
    null,
  ].map(isOutOfScopeMeetTitle),
  [true, true, true, false, false],
);

if (failures.length > 0) {
  console.error(
    `❌ verify-meet-page-model: ${failures.length}/${checked} 件失敗`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-meet-page-model: ${checked} 件すべて一致`);
