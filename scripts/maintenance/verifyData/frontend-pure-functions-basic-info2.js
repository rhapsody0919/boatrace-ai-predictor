/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-basic-info2.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { r2, rec } from "./frontend-pure-functions-common.js";

export function suiteBasicInfoStatsPart5(m, check) {
  check(
    "computeExhibitionTopRates: 展示単独最速の走だけで率を出す（同着最速=null は除く）",
    m.computeExhibitionTopRates([
      rec({
        raceId: "2026-09-10-04-01",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: true,
      }),
      rec({
        raceId: "2026-09-10-04-02",
        boatNumber: 1,
        ranks: [2, 1, 3],
        isFastestExhibition: true,
      }),
      rec({
        raceId: "2026-09-10-04-03",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: null,
      }),
      rec({
        raceId: "2026-09-10-04-04",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: false,
      }),
    ]).winRate,
    50,
  );

  // --- lastStartTiming（BOA-597）: 前走のST。直前が F・L ならその記号で、飛ばさない
  const stOf = { valueOf: (r) => r.st, markOf: (r) => r.mark ?? null };
  check(
    "lastStartTiming: 直前が F・L ならその記号、欠場（ST無し・記号無し）は飛ばす、何も無ければ null",
    [
      m.lastStartTiming([{ st: 0.09 }, { st: null, mark: "F" }], stOf),
      m.lastStartTiming([{ st: 0.09 }, { st: null, mark: "L" }], stOf),
      m.lastStartTiming([{ st: 0.12 }, { st: null }], stOf),
      m.lastStartTiming([{ st: null, mark: "F" }, { st: 0.15 }], stOf),
      m.lastStartTiming([{ st: null }], stOf),
      m.lastStartTiming(null, stOf),
    ],
    [
      { mark: "F", value: null },
      { mark: "L", value: null },
      { mark: null, value: 0.12 },
      { mark: null, value: 0.15 },
      null,
      null,
    ],
  );

  // --- periodDiff（BOA-439）: 前期と出走表の値の差。どちらも公式値
  check(
    "periodDiff: 出走表の値と、符号つきの差（勝率は小数2桁・2連対率は1桁）",
    [
      m.periodDiff(4.5, "4.12", 2),
      m.periodDiff(25.6, 31.25, 1),
      m.periodDiff(4.5, 4.5, 2),
    ],
    [
      { current: "4.12", diff: "−0.38", sign: -1 },
      { current: "31.3", diff: "+5.7", sign: 1 },
      { current: "4.50", diff: "±0.00", sign: 0 },
    ],
  );
  check(
    "periodDiffShownFrom: 期の初めから3か月後の1日から差を出す（年をまたぐ期も）",
    [
      m.periodDiffShownFrom("2026-04-30"),
      m.periodDiffShownFrom("2025-10-31"),
      m.periodDiffShownFrom(null),
      m.periodDiffShownFrom("2026/04/30"),
    ],
    ["2026-08-01", "2026-02-01", null, null],
  );
  check(
    "periodDiff: どちらかが無ければ null（出走0の新人・出走表の値が無いとき）",
    [
      m.periodDiff(null, 4.1, 2),
      m.periodDiff(4.5, null, 2),
      m.periodDiff(4.5, "", 2),
      m.periodDiff(4.5, "abc", 2),
    ],
    [null, null, null, null],
  );
}

export function suiteBasicInfoStatsPart6(m, check) {
  check(
    "getRecentRaces: 進入は本番STの進入（当日も入る）を先に、無ければ Kファイル。ST順位と F を渡す（BOA-623）",
    m
      .getRecentRaces(
        [
          {
            raceId: "2026-10-01-16-04",
            boatNumber: 5,
            entryCourse: 6,
            actualCourse: null,
            rank1: 5,
            stRank: 2,
            isFlying: false,
          },
          {
            raceId: "2026-09-29-16-10",
            boatNumber: 5,
            actualCourse: 4,
            rank2: 5,
            stRank: 3,
          },
          {
            raceId: "2026-09-29-16-11",
            boatNumber: 2,
            entryCourse: null,
            actualCourse: null,
            isFlying: true,
          },
        ],
        10,
      )
      .map((x) => [x.entryCourse, x.startTimingRank, x.isFlying]),
    [
      [6, 2, false],
      [4, 3, false],
      [null, null, true],
    ],
  );
}

export function suiteBasicInfoStatsPart7(m, check) {
  // --- groupRunsByMeet（BOA-623）: 直近10走・レース一覧を節の見出し行でまとめる
  {
    const r = (raceId, venueCode, raceTitle, raceGrade = "G1") => ({
      raceId,
      venueCode,
      raceTitle,
      raceGrade,
    });
    const asc = [
      r("2026-09-14-18-07", 18, "ダイヤモンドカップ"),
      r("2026-09-15-18-02", 18, "ダイヤモンドカップ"),
      r("2026-09-17-18-09", 18, "ダイヤモンドカップ"),
      r("2026-09-28-16-05", 16, "児島キングカップ"),
      r("2026-09-29-16-10", 16, "児島キングカップ"),
    ];
    const summary = (gs) =>
      gs.map((g) => [g.venueCode, g.firstDate, g.lastDate, g.rows.length]);
    check(
      "groupRunsByMeet: 同じ会場・同じレース名・2日以内で続く行を1つの節にまとめる。古い順・新しい順のどちらでも期間は古い→新しい",
      [
        summary(m.groupRunsByMeet(asc)),
        summary(m.groupRunsByMeet([...asc].reverse())),
      ],
      [
        [
          [18, "2026-09-14", "2026-09-17", 3],
          [16, "2026-09-28", "2026-09-29", 2],
        ],
        [
          [16, "2026-09-28", "2026-09-29", 2],
          [18, "2026-09-14", "2026-09-17", 3],
        ],
      ],
    );
    check(
      "groupRunsByMeet: 同じ会場・同じ名前でも3日以上空けば別の節。会場が変われば同じ日でも別。空は空",
      [
        summary(
          m.groupRunsByMeet([
            r("2026-08-01-18-01", 18, "一般戦"),
            r("2026-08-05-18-01", 18, "一般戦"),
            r("2026-08-05-16-01", 16, "一般戦"),
          ]),
        ),
        m.groupRunsByMeet([]),
        m.groupRunsByMeet(null),
      ],
      [
        [
          [18, "2026-08-01", "2026-08-01", 1],
          [18, "2026-08-05", "2026-08-05", 1],
          [16, "2026-08-05", "2026-08-05", 1],
        ],
        [],
        [],
      ],
    );
  }

  // --- recordsBeforeRace（BOA-603）: 表示中のレースより前の走だけ
  check(
    "recordsBeforeRace: 表示中のレース自身と後日の走を外す。取得前・失敗・raceId無しはそのまま",
    [
      m
        .recordsBeforeRace(
          [
            { raceId: "2026-09-25-09-03" },
            { raceId: "2026-09-26-09-04" },
            { raceId: "2026-09-26-09-05" },
            { raceId: "2026-09-26-09-11" },
            { raceId: "2026-09-28-09-11" },
          ],
          "2026-09-26-09-05",
        )
        .map((r) => r.raceId),
      m.recordsBeforeRace(undefined, "2026-09-26-09-05"),
      m.recordsBeforeRace(null, "2026-09-26-09-05"),
      m.recordsBeforeRace([{ raceId: "2026-09-28-09-11" }], null).length,
    ],
    [["2026-09-25-09-03", "2026-09-26-09-04"], undefined, null, 1],
  );
}

export function suiteBasicInfoStatsPart8(m, check) {
  // --- buildConditionRows（phase a FR-2）
  const condRecords = [
    rec({
      raceId: "2026-09-10-04-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.1,
      seriesDay: 1,
      isFinalDay: false,
      waveHeight: 5,
      fCount: 1,
    }),
    rec({
      raceId: "2026-09-11-04-01",
      boatNumber: 1,
      ranks: [2, 1, 3],
      startTiming: null,
      seriesDay: 2,
      isFinalDay: false,
      waveHeight: 4,
      fCount: 0,
    }),
    rec({
      raceId: "2026-09-12-04-01",
      boatNumber: 1,
      ranks: [2, 3, 4],
      startTiming: 0.2,
      seriesDay: 3,
      isFinalDay: true,
      waveHeight: null,
      fCount: null,
    }),
  ];
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
  const winRows = byKey(
    m.buildConditionRows(condRecords, { venueCode: 4, metric: "winRate" }),
  );
  const stRows = byKey(
    m.buildConditionRows(condRecords, { venueCode: 4, metric: "avgSt" }),
  );
  check(
    "buildConditionRows: 平均STの n は ST を計測できた走数（avgStN）。全走数と混ぜない",
    [stRows.national.n, r2(stRows.national.value), winRows.national.n],
    [2, 0.15, 3],
  );
  check(
    "buildConditionRows: 波は 5cm 以上（>=）を荒れとする。波高が取れない走は baseN に入れない",
    [winRows.wave5.n, winRows.wave5.baseN, winRows.wave5.value],
    [1, 2, 100],
  );
  // 江戸川（03）は波高を5cm刻みで記録し、最小が5cm。全走が「5cm以上」になるので、
  // 波の行の分子・母数の両方から外し、外した数を返す（BOA-584）
  const withEdogawa = byKey(
    m.buildConditionRows(
      [
        ...condRecords,
        rec({
          raceId: "2026-09-13-03-01",
          boatNumber: 1,
          ranks: [1, 2, 3],
          waveHeight: 5,
          fCount: 0,
        }),
      ],
      { venueCode: 4, metric: "winRate" },
    ),
  );
  check(
    "buildConditionRows: 波の行は江戸川の走を分子・母数から外し、外した数を excludedN で返す",
    [
      withEdogawa.wave5.n,
      withEdogawa.wave5.baseN,
      withEdogawa.wave5.excludedN,
      winRows.wave5.excludedN,
    ],
    [1, 2, 1, 0],
  );
  check(
    "buildConditionRows: 初日（seriesDay=1）・最終日（isFinalDay=true）",
    [winRows.firstDay.n, winRows.finalDay.n, winRows.finalDay.value],
    [1, 1, 0],
  );
  return { condRecords, byKey, winRows };
}
