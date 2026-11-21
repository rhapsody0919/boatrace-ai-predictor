/**
 * verify-meet-page-model.js の後半の場面。verify ではない。
 * 判定と期待値は分ける前の verify-meet-page-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  pickMeetAnchor,
  officialAsOfDate,
  buildQualifiers,
  pickShobugake,
  borderTieOf,
  isOutOfScopeMeetTitle,
} from "../../../src/utils/meetPageModel.js";

let check, id, window, meetDays, raceIds, doneThrough, anchor;
let semiEntries, q, shobu;

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

// --- borderTieOf（ファン評価2周目: 18位が同率5人で線の上が22人になる） ---
const ranks = (list) => list.map((rank) => ({ rank }));

function scene1() {
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
  semiEntries = [
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
  q = buildQualifiers(window, semiEntries, [
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
}

function scene2() {
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
  shobu = pickShobugake(ranking, 5.5, 18, remaining, {
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
  check(
    "18位が同率5人なら、同率5人・入れるのは1人",
    borderTieOf(
      ranks([
        ...Array.from({ length: 17 }, (_, i) => i + 1),
        18,
        18,
        18,
        18,
        18,
        23,
      ]),
      18,
    ),
    { rank: 18, tied: 5, seats: 1 },
  );
  check(
    "17位が同率3人（17・18位にまたがる）なら、入れるのは2人",
    borderTieOf(
      ranks([...Array.from({ length: 16 }, (_, i) => i + 1), 17, 17, 17, 20]),
      18,
    ),
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・id・window・meetDays・raceIds・doneThrough・anchor） */
export function runMeetPageModelScenes1(env) {
  ({ check, id, window, meetDays, raceIds, doneThrough, anchor } = env);
  scene1();
  scene2();
}
