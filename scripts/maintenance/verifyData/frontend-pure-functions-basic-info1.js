/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-basic-info1.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { daysAgo, r2, rec } from "./frontend-pure-functions-common.js";
import { finishPositionOf as pureFinishPositionOf } from "../../../src/pure/finishPosition.js";
import { suiteBasicInfoStatsPart10, suiteBasicInfoStatsPart11, suiteBasicInfoStatsPart12, suiteBasicInfoStatsPart9 } from "./frontend-pure-functions-basic-info3.js";
import { suiteBasicInfoStatsPart13, suiteBasicInfoStatsPart14 } from "./frontend-pure-functions-basic-info4.js";
import { suiteBasicInfoStatsPart5, suiteBasicInfoStatsPart6, suiteBasicInfoStatsPart7, suiteBasicInfoStatsPart8 } from "./frontend-pure-functions-basic-info2.js";

// ---------------------------------------------------------------------------
// 1. basicInfoStats.js
// ---------------------------------------------------------------------------
export function suiteBasicInfoStats(m, check) {
  suiteBasicInfoStatsPart1(m, check);
  suiteBasicInfoStatsPart2(m, check);
  suiteBasicInfoStatsPart3(m, check);
  suiteBasicInfoStatsPart4(m, check);
  suiteBasicInfoStatsPart5(m, check);
  suiteBasicInfoStatsPart6(m, check);
  suiteBasicInfoStatsPart7(m, check);
  const { condRecords, byKey, winRows } = suiteBasicInfoStatsPart8(m, check);
  suiteBasicInfoStatsPart9(m, check, condRecords, byKey, winRows);
  const { meetRows } = suiteBasicInfoStatsPart10(m, check);
  suiteBasicInfoStatsPart11(m, check, meetRows);
  suiteBasicInfoStatsPart12(m, check);
  const { RD, ok } = suiteBasicInfoStatsPart13(m, check);
  suiteBasicInfoStatsPart14(m, check, RD, ok);
}

export function suiteBasicInfoStatsPart1(m, check) {
  // --- getRecentRaces: 枠番は生の艇番（2e91aa0b → 57a9b159 で往復したバグ）
  // 2e91aa0b 以前は actualCourse ?? boatNumber を「枠番」に出しており、欠場で
  // actualCourse=null のとき艇番を実在コースとして誤表示した。57a9b159 で
  // courseWithFallback（実進入コース）を渡したために、同じ行の「枠番」と
  // 着順判定の艇番が食い違った。現在は boatNumber=生の艇番、entryCourse=実進入コース
  const recent = m.getRecentRaces(
    [
      rec({
        raceId: "2026-09-10-04-05",
        boatNumber: 3,
        actualCourse: 5,
        courseWithFallback: 5,
        ranks: [3, 1, 2, 4, 5, 6],
      }),
      rec({
        raceId: "2026-09-11-04-07",
        boatNumber: 4,
        actualCourse: null, // 欠場
        courseWithFallback: null,
        ranks: [1, 2, 3, 5, 6, null],
      }),
    ],
    5,
  );
  check(
    "getRecentRaces: 枠番(boatNumber)は実進入コースではなく当該レースの艇番（57a9b159）",
    recent.map((r) => r.boatNumber),
    [3, 4],
  );
  check(
    "getRecentRaces: 実進入コースは entryCourse に分けて持つ。欠場は null（2e91aa0b）",
    recent.map((r) => r.entryCourse),
    [5, null],
  );
  check(
    "getRecentRaces: 枠番で着順を判定する（3号艇が1着なら1着）",
    recent[0].finishRank,
    1,
  );
  check(
    "getRecentRaces: 欠場（どの着にも艇番が無い）は着順 null",
    recent[1].finishRank,
    null,
  );
  check(
    "getRecentRaces: レース番号は race_id から導出する",
    recent.map((r) => r.raceNo),
    [5, 7],
  );

  // --- getRecentRaces: レース名・種別・決まり手・単勝配当を透過する（6a126cb8）
  // 以前は4列とも null 固定で「直近5走」が常に「-」表示だった
  const passthrough = m.getRecentRaces([
    rec({
      raceId: "2026-09-12-04-12",
      boatNumber: 1,
      ranks: [1, 2, 3, 4, 5, 6],
      raceTitle: "G1 全日本王者決定戦",
      raceStage: "優勝戦",
      winningTechnique: "逃げ",
      payoutWin: 0, // 0円は「データなし」ではない（927d46d1 #6）
    }),
  ])[0];
  check(
    "getRecentRaces: raceTitle/raceStage/winningTechnique/payoutWin を透過する（6a126cb8）",
    [
      passthrough.raceTitle,
      passthrough.raceStage,
      passthrough.winningTechnique,
      passthrough.payoutWin,
    ],
    ["G1 全日本王者決定戦", "優勝戦", "逃げ", 0],
  );
  check(
    "getRecentRaces: 末尾（新しい方）から count 件",
    m
      .getRecentRaces(
        [1, 2, 3, 4, 5, 6, 7].map((i) =>
          rec({ raceId: `2026-09-0${i}-04-01`, boatNumber: 1 }),
        ),
        5,
      )
      .map((r) => r.date),
    ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"],
  );
  check("getRecentRaces: null は空配列", m.getRecentRaces(null), []);
}

export function suiteBasicInfoStatsPart2(m, check) {
  // --- finishPositionOf: 本体は src/pure/finishPosition.js（段3 で移した。中身の検査は
  // suiteFinishPosition）。basicInfoStats の再 export が同じ関数を指すことだけを見る
  check(
    "finishPositionOf: basicInfoStats の再 export は src/pure の関数",
    m.finishPositionOf === pureFinishPositionOf,
    true,
  );

  // --- computeRates: 平均STは startTiming が取れた走だけで割る（d3817581）
  const rates = m.computeRates([
    rec({
      raceId: "2026-09-10-01-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.1,
    }),
    rec({
      raceId: "2026-09-10-01-02",
      boatNumber: 2,
      ranks: [1, 2, 3],
      startTiming: 0.2,
    }),
    rec({
      raceId: "2026-09-10-01-03",
      boatNumber: 3,
      ranks: [1, 2, 3],
      startTiming: null,
    }), // F・未計測
    rec({
      raceId: "2026-09-10-01-04",
      boatNumber: 4,
      ranks: [1, 2, 3],
      startTiming: undefined,
    }),
  ]);
  check(
    "computeRates: 1着率・2連対率・3連対率（各レコード自身の艇番で判定）",
    [rates.n, rates.winRate, rates.top2Rate, rates.top3Rate],
    [4, 25, 50, 75],
  );
  check(
    "computeRates: 平均STは null/undefined を母数に入れない（avgStN と n は別）",
    [r2(rates.avgSt), rates.avgStN],
    [0.15, 2],
  );
  check("computeRates: 0件は率を null（0% と区別する）", m.computeRates([]), {
    n: 0,
    winRate: null,
    top2Rate: null,
    top3Rate: null,
    avgSt: null,
    avgStN: 0,
  });

  // --- filterRecords: G2/G3 は「全レース」だけに含める
  const graded = ["SG", "G1", "G2", "G3", "ippan", null].map((g, i) =>
    rec({ raceId: `2026-09-1${i}-04-01`, boatNumber: 1, raceGrade: g }),
  );
  const gradesOf = (grade) =>
    m
      .filterRecords(graded, {
        venueCode: 4,
        scope: "national",
        grade,
        period: "current",
      })
      .map((r) => r.raceGrade);
  check("filterRecords: SG・G1 は SG と G1 だけ", gradesOf("sgg1"), [
    "SG",
    "G1",
  ]);
  check("filterRecords: 一般戦は ippan だけ", gradesOf("ippan"), ["ippan"]);
  check(
    "filterRecords: 全レースは G2/G3/グレード未取得も含む",
    gradesOf("all").length,
    6,
  );
}

export function suiteBasicInfoStatsPart3(m, check) {
  check(
    "filterRecords: 当地は会場コードで絞る",
    m
      .filterRecords(
        [
          rec({ raceId: "2026-09-10-04-01", boatNumber: 1 }),
          rec({ raceId: "2026-09-10-12-01", boatNumber: 1 }),
        ],
        { venueCode: 12, scope: "local", grade: "all", period: "current" },
      )
      .map((r) => r.venueCode),
    [12],
  );
  check(
    "filterRecords: 直近1ヶ月は30日より前を落とす（境界から離した日付で）",
    m
      .filterRecords(
        [
          rec({ raceId: `${daysAgo(10)}-04-01`, boatNumber: 1 }),
          rec({ raceId: `${daysAgo(60)}-04-01`, boatNumber: 1 }),
          rec({ raceId: `${daysAgo(200)}-04-01`, boatNumber: 1 }),
        ],
        { venueCode: 4, scope: "national", grade: "all", period: "last1m" },
      )
      .map((r) => r.date),
    [daysAgo(10)],
  );

  // --- filterRecords: 期間の境界は JST の日付で切る（BOA-469）
  // 以前はローカル時刻で setDate したあと toISOString()（UTC）で日付を取り出しており、
  // JST 0〜9時は UTC では前日なので境界が1日古くなり、31日前・91日前の走が混ざった。
  // 現在時刻を固定して、JST 早朝（UTC では前日）と JST 昼の両方で境界の前後を見る。
  // どちらも JST 2026-09-29 の扱い: 直近1ヶ月の境界は 08-30、直近3ヶ月は 07-01
  const boundaryRecs = [
    "2026-06-30",
    "2026-07-01",
    "2026-07-02",
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
  ].map((d) => rec({ raceId: `${d}-04-01`, boatNumber: 1 }));
  const periodDates = (period, now) =>
    m
      .filterRecords(boundaryRecs, {
        venueCode: 4,
        scope: "national",
        grade: "all",
        period,
        now,
      })
      .map((r) => r.date);
  for (const [label, iso] of [
    ["JST 03:00（UTC 前日 18:00）", "2026-09-28T18:00:00Z"],
    ["JST 12:00（UTC 同日 03:00）", "2026-09-29T03:00:00Z"],
  ]) {
    check(
      `filterRecords: ${label} の直近1ヶ月は JST 30日前(08-30)から。31日前は含めない（BOA-469）`,
      periodDates("last1m", new Date(iso)),
      ["2026-08-30", "2026-08-31"],
    );
    check(
      `filterRecords: ${label} の直近3ヶ月は JST 90日前(07-01)から。91日前は含めない（BOA-469）`,
      periodDates("last3m", new Date(iso)),
      ["2026-07-01", "2026-07-02", "2026-08-29", "2026-08-30", "2026-08-31"],
    );
  }
}

export function suiteBasicInfoStatsPart4(m, check) {
  // --- computeVenueRanking: 指標連動・n>=5・平均STは昇順（d3817581）
  const venueRecords = [];
  // 会場4: 5走中3勝、ST 0.20
  for (let i = 0; i < 5; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-04-01`,
        boatNumber: 1,
        ranks: i < 3 ? [1, 2, 3] : [2, 3, 4],
        startTiming: 0.2,
      }),
    );
  // 会場12: 5走中1勝、ST 0.10（STは良いが勝率は低い）
  for (let i = 0; i < 5; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-12-01`,
        boatNumber: 1,
        ranks: i < 1 ? [1, 2, 3] : [2, 3, 4],
        startTiming: 0.1,
      }),
    );
  // 会場20: 6走だがSTが取れたのは2走だけ（勝率では対象、平均STでは対象外）
  for (let i = 0; i < 6; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-20-01`,
        boatNumber: 1,
        ranks: [2, 3, 4],
        startTiming: i < 2 ? 0.05 : null,
      }),
    );
  // 会場24: 4走（n<5 でどの指標でも対象外）
  for (let i = 0; i < 4; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-24-01`,
        boatNumber: 1,
        ranks: [1, 2, 3],
      }),
    );
  check(
    "computeVenueRanking: 勝率は降順、n<5 の会場は除く",
    m.computeVenueRanking(venueRecords, "winRate").map((r) => r.venueCode),
    [4, 12, 20],
  );
  check(
    "computeVenueRanking: 平均STは小さい方が良いので昇順、母数は avgStN>=5",
    m.computeVenueRanking(venueRecords, "avgSt").map((r) => r.venueCode),
    [12, 4],
  );

  // --- computeFrameEntryDistribution（BOA-485、旧 computeAvgEntryCourse の置き換え）
  // / computeExhibitionTopRates（BOA-304）
  // 旧実装は全枠のレースを混ぜて平均し、1号艇でも 3.16 のような値になった。
  // 今回と同じ枠番の走だけ・表示中のレースより前だけ・actualCourse=null は母数外、を固定する
  const frameEntryRecords = [
    rec({ raceId: "2026-09-10-04-01", boatNumber: 2, actualCourse: 2 }),
    rec({ raceId: "2026-09-10-04-02", boatNumber: 2, actualCourse: 1 }),
    rec({ raceId: "2026-09-10-04-03", boatNumber: 2, actualCourse: 3 }),
    rec({ raceId: "2026-09-10-04-04", boatNumber: 2, actualCourse: null }), // 欠場
    rec({ raceId: "2026-09-10-04-05", boatNumber: 1, actualCourse: 1 }), // 別の枠
    rec({ raceId: "2026-09-10-04-09", boatNumber: 2, actualCourse: 2 }), // 表示中より後
  ];
  check(
    "computeFrameEntryDistribution: 同じ枠番・表示中より前の走だけ、actualCourse=null は母数外（BOA-485）",
    m.computeFrameEntryDistribution(frameEntryRecords, 2, "2026-09-10-04-08"),
    {
      n: 3,
      counts: [1, 1, 1, 0, 0, 0],
      wakuRate: (1 / 3) * 100,
      inwardRate: (1 / 3) * 100,
      outwardRate: (1 / 3) * 100,
    },
  );
  check(
    "computeFrameEntryDistribution: 対象0件なら率は null（0% と区別する）",
    m.computeFrameEntryDistribution(frameEntryRecords, 6, null),
    {
      n: 0,
      counts: [0, 0, 0, 0, 0, 0],
      wakuRate: null,
      inwardRate: null,
      outwardRate: null,
    },
  );
}
