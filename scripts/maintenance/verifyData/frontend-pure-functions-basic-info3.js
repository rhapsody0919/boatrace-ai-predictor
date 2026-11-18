/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-basic-info3.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { r2, rec } from "./frontend-pure-functions-common.js";

export function suiteBasicInfoStatsPart9(m, check, condRecords, byKey, winRows) {
  // 初日・最終日も、他行と母数が違うので baseN（日目を判定できた走数）を返す。
  // race_conditions は 2026-02 以降しか無く、この2行だけ期間が短い（BOA-499）
  const partialDay = [
    ...condRecords,
    rec({
      raceId: "2025-11-10-04-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.12,
      seriesDay: null,
      isFinalDay: null,
      waveHeight: null,
      fCount: null,
    }),
  ];
  const dayRows = byKey(
    m.buildConditionRows(partialDay, { venueCode: 4, metric: "winRate" }),
  );
  check(
    "buildConditionRows: 初日・最終日は baseN を返し、日目が無い走は入れない（BOA-499）",
    [
      winRows.firstDay.baseN,
      winRows.finalDay.baseN,
      dayRows.firstDay.baseN,
      dayRows.finalDay.baseN,
      dayRows.national.n,
    ],
    [3, 3, 3, 3, 4],
  );
  check(
    "buildConditionRows: F数が取れていない走（null）は F持ち時にも F無し時にも入れない",
    [winRows.fHolding.n, winRows.fClean.n, winRows.fHolding.baseN],
    [1, 1, 2],
  );
  check(
    "buildConditionRows: F持ち時・F無し時は指標に関わらず平均STも返す",
    [r2(winRows.fHolding.avgSt), winRows.fClean.avgSt, winRows.fClean.avgStN],
    [0.1, null, 0],
  );
  const unfetched = condRecords.map(
    ({ seriesDay, isFinalDay, waveHeight, ...rest }) => rest,
  );
  const unfetchedRows = byKey(
    m.buildConditionRows(unfetched, { venueCode: 4, metric: "winRate" }),
  );
  check(
    "buildConditionRows: race_conditions の取得失敗（全件 undefined）は n=0 ではなく unavailable",
    [
      unfetchedRows.firstDay.unavailable,
      unfetchedRows.finalDay.unavailable,
      unfetchedRows.wave5.unavailable,
    ],
    [true, true, true],
  );
  const missingRows = byKey(
    m.buildConditionRows(
      condRecords.map((r) => ({
        ...r,
        seriesDay: null,
        isFinalDay: null,
        waveHeight: null,
      })),
      { venueCode: 4, metric: "winRate" },
    ),
  );
  check(
    "buildConditionRows: 欠測（null）は取得失敗ではない（unavailable=false、n=0、値は null）",
    [
      missingRows.firstDay.unavailable,
      missingRows.firstDay.n,
      missingRows.firstDay.value,
    ],
    [false, 0, null],
  );
  check(
    "buildConditionRows: records が配列でなくても落ちない",
    m.buildConditionRows(null, { venueCode: 4, metric: "winRate" }).length,
    m.CONDITION_ROWS.length,
  );
}

export function suiteBasicInfoStatsPart10(m, check) {
  // --- buildMeetResults: 同じ日の後のレースを「今節のこれまで」に入れない（2026-09-20 桐生5R）
  const meetRecords = [
    rec({ raceId: "2026-09-12-01-03", boatNumber: 1 }), // 前節（間が空いている）
    rec({ raceId: "2026-09-18-01-02", boatNumber: 1 }), // 今節1日目
    rec({ raceId: "2026-09-19-01-08", boatNumber: 1 }), // 今節2日目
    rec({ raceId: "2026-09-19-02-04", boatNumber: 1 }), // 別会場（地続き）
    rec({ raceId: "2026-09-20-01-01", boatNumber: 1 }), // 今節3日目・表示中より前のレース
    rec({ raceId: "2026-09-20-01-09", boatNumber: 1 }), // 今節3日目・表示中より後のレース
  ];
  check(
    "buildMeetResults: 表示中のレース(5R)より前だけ。同じ日の9Rは入れない（桐生5Rで発生）",
    m
      .buildMeetResults(meetRecords, {
        raceId: "2026-09-20-01-05",
        venueCode: 1,
      })
      .map((r) => r.raceId),
    ["2026-09-18-01-02", "2026-09-19-01-08", "2026-09-20-01-01"],
  );
  check(
    "buildMeetResults: 過去のレースを開いたとき、それより後の節を今節にしない",
    m
      .buildMeetResults(meetRecords, {
        raceId: "2026-09-12-01-05",
        venueCode: 1,
      })
      .map((r) => r.raceId),
    ["2026-09-12-01-03"],
  );
  check(
    "buildMeetResults: 初日の朝（今節の結果が1走も無い）に前節を今節として出さない",
    m.buildMeetResults(meetRecords, {
      raceId: "2026-09-26-01-01",
      venueCode: 1,
    }),
    [],
  );
  check(
    "buildMeetResults: 会場コードが無ければ空",
    m.buildMeetResults(meetRecords, {
      raceId: "2026-09-20-01-05",
      venueCode: null,
    }),
    [],
  );

  // --- buildMeetTrend: 差は画面に出す桁で取る（0.1325 − 0.1475 → 表示 0.13 と 0.15 なら −0.02）
  const meetRows = [
    rec({
      raceId: "2026-09-19-01-01",
      boatNumber: 1,
      startTiming: 0.13,
      exhibitionRank: 4,
      exhibitionTime: 6.8,
    }),
    rec({
      raceId: "2026-09-20-01-01",
      boatNumber: 1,
      startTiming: 0.135,
      exhibitionRank: 2,
      exhibitionTime: 6.7,
    }),
  ];
  return { meetRows };
}

export function suiteBasicInfoStatsPart11(m, check, meetRows) {
  const baseRows = [
    rec({ raceId: "2026-09-01-02-01", boatNumber: 1, startTiming: 0.145 }),
    rec({ raceId: "2026-09-02-02-01", boatNumber: 1, startTiming: 0.15 }),
  ];
  const trend = m.buildMeetTrend(meetRows, [...baseRows, ...meetRows]);
  check(
    "buildMeetTrend: ST差は表示桁（小数2桁）に丸めてから引く（0.13 vs 0.15 → −0.02）",
    [trend.st.meetAvg, trend.st.baseAvg, trend.st.diff],
    [0.13, 0.15, -0.02],
  );
  check(
    "buildMeetTrend: 通常値の母数から今節の走を除く",
    [trend.st.meetN, trend.st.baseN],
    [2, 2],
  );
  check(
    "buildMeetTrend: 展示は順位の推移。負なら上向き",
    [
      trend.exhibition.first,
      trend.exhibition.last,
      trend.exhibition.diff,
      trend.exhibition.n,
    ],
    [4, 2, -2, 2],
  );
  check(
    "buildMeetTrend: 展示が1走だけなら推移ではないので差は null",
    m.buildMeetTrend([meetRows[0]], meetRows).exhibition.diff,
    null,
  );
  check(
    "buildMeetTrend: 今節0走でも落ちない（差は null）",
    [
      m.buildMeetTrend([], baseRows).st.diff,
      m.buildMeetTrend(null, null).exhibition.n,
    ],
    [null, 0],
  );

  // --- periodsEndedBefore（BOA-326）
  check(
    "periodsEndedBefore: 5〜10月のレースの前期は (Y,2)、そこから4期さかのぼる",
    m.periodsEndedBefore("2026-09-29", 4),
    [
      {
        periodYear: 2026,
        periodNo: 2,
        calcFrom: "2025-11-01",
        calcTo: "2026-04-30",
      },
      {
        periodYear: 2026,
        periodNo: 1,
        calcFrom: "2025-05-01",
        calcTo: "2025-10-31",
      },
      {
        periodYear: 2025,
        periodNo: 2,
        calcFrom: "2024-11-01",
        calcTo: "2025-04-30",
      },
      {
        periodYear: 2025,
        periodNo: 1,
        calcFrom: "2024-05-01",
        calcTo: "2024-10-31",
      },
    ],
  );
  check(
    "periodsEndedBefore: 期の境目（4/30・5/1・10/31・11/1・1月）",
    ["2026-04-30", "2026-05-01", "2026-10-31", "2026-11-01", "2027-01-15"].map(
      (d) => {
        const [p] = m.periodsEndedBefore(d, 1);
        return `${p.periodYear}-${p.periodNo}`;
      },
    ),
    ["2026-1", "2026-2", "2026-2", "2027-1", "2027-1"],
  );
  check(
    "periodsEndedBefore: 日付が無い・壊れていれば空",
    [m.periodsEndedBefore("", 4), m.periodsEndedBefore(null, 4)],
    [[], []],
  );
}

export function suiteBasicInfoStatsPart12(m, check) {
  // --- officialPeriodOf（BOA-815）: 公式の出走表の平均ST・勝率の期。公式の出走表と本番DBで照合した
  //     5レースの日付（各6艇が一致）と、periodsEndedBefore と食い違う5〜6月・11〜12月
  check(
    "officialPeriodOf: 1〜6月は (Y,1)、7〜12月は (Y,2)（公式の出走表と照合した日付）",
    ["2025-12-20", "2026-05-20", "2026-06-20", "2026-07-03", "2026-10-09"].map(
      (d) => {
        const p = m.officialPeriodOf(d);
        return `${p.periodYear}-${p.periodNo}`;
      },
    ),
    ["2025-2", "2026-1", "2026-1", "2026-2", "2026-2"],
  );
  check(
    "officialPeriodOf: 期の境目（6/30・7/1・12/31・1/1）と成績の期間",
    [
      m.officialPeriodOf("2026-06-30"),
      m.officialPeriodOf("2026-07-01"),
      m.officialPeriodOf("2026-12-31"),
      m.officialPeriodOf("2027-01-01"),
    ],
    [
      {
        periodYear: 2026,
        periodNo: 1,
        calcFrom: "2025-05-01",
        calcTo: "2025-10-31",
      },
      {
        periodYear: 2026,
        periodNo: 2,
        calcFrom: "2025-11-01",
        calcTo: "2026-04-30",
      },
      {
        periodYear: 2026,
        periodNo: 2,
        calcFrom: "2025-11-01",
        calcTo: "2026-04-30",
      },
      {
        periodYear: 2027,
        periodNo: 1,
        calcFrom: "2026-05-01",
        calcTo: "2026-10-31",
      },
    ],
  );
  check(
    "officialPeriodOf: 直前に終わった期（periodsEndedBefore）と5〜6月・11〜12月で食い違う",
    ["2026-05-20", "2026-11-20"].map((d) => {
      const o = m.officialPeriodOf(d);
      const [e] = m.periodsEndedBefore(d, 1);
      return `${o.periodYear}-${o.periodNo}/${e.periodYear}-${e.periodNo}`;
    }),
    ["2026-1/2026-2", "2026-2/2027-1"],
  );
  check(
    "officialPeriodOf: 節の初日で決める（6/27〜7/1 の節の 7/1 は旧期。戸田 2026-07-01 8R で公式と照合）",
    [m.officialPeriodOf("2026-06-27"), m.officialPeriodOf("2025-12-28")].map(
      (p) => `${p.periodYear}-${p.periodNo}`,
    ),
    ["2026-1", "2025-2"],
  );
  check(
    "officialPeriodOf: 日付が無い・壊れていれば null",
    [m.officialPeriodOf(""), m.officialPeriodOf(null)],
    [null, null],
  );

  // --- currentTermStart・filterRecords の term（BOA-775）: 基本情報タブの「今期」は本当の今期
  check(
    "currentTermStart: 5/1〜10/31 は5/1、11/1〜4/30 は11/1（年をまたぐ）",
    ["2026-05-01", "2026-10-31", "2026-11-01", "2027-04-30", "2027-01-15"].map(
      m.currentTermStart,
    ),
    ["2026-05-01", "2026-05-01", "2026-11-01", "2026-11-01", "2026-11-01"],
  );
}
