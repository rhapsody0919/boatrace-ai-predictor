/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-basic-info4.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */

export function suiteBasicInfoStatsPart13(m, check) {
  {
    const recs = ["2026-04-30", "2026-05-01", "2026-09-30"].map((date) => ({
      date,
      venueCode: 1,
      raceGrade: "ippan",
    }));
    const now = new Date("2026-10-09T12:00:00+09:00");
    check(
      "filterRecords: term は今期（5/1 以降）だけ、current は全期間のまま（条件別の表が使う）",
      [
        m
          .filterRecords(recs, {
            venueCode: 1,
            scope: "national",
            grade: "all",
            period: "term",
            now,
          })
          .map((r) => r.date),
        m.filterRecords(recs, {
          venueCode: 1,
          scope: "national",
          grade: "all",
          period: "current",
          now,
        }).length,
      ],
      [["2026-05-01", "2026-09-30"], 3],
    );
  }

  // --- pickPeriodStats
  const RD = "2026-09-29"; // 前期 = (2026,2)、直近2年 = (2025,1)〜(2026,2)
  const ok = (rows) => ({ rows, latestImported: true });
  check(
    "pickPeriodStats: 該当選手が無い・取得結果が権限エラー（state付き）なら null",
    [
      m.pickPeriodStats(
        ok([{ racer_id: 1, period_year: 2026, period_no: 2 }]),
        2,
        RD,
      ),
      m.pickPeriodStats({ state: "forbidden", rows: [] }, 1, RD),
    ],
    [null, null],
  );
  check(
    "pickPeriodStats: 前期を取り込み済みなのにその選手の前期が無ければ、古い期があっても null（選手ごとの欠けでは前々期に切り替えない）",
    m.pickPeriodStats(
      ok([
        { racer_id: 1, period_year: 2026, period_no: 1, finals: 3, wins: 1 },
      ]),
      1,
      RD,
    ),
    null,
  );
  check(
    "pickPeriodStats: 出走0の新人（win_rate=NULL）は null のまま（0 にしない）",
    m.pickPeriodStats(
      ok([
        {
          racer_id: 4320,
          period_year: 2026,
          period_no: 2,
          win_rate: null,
          top2_rate: 0,
          starts: 0,
          finals: 0,
          wins: 0,
        },
      ]),
      4320,
      RD,
    ),
    {
      winRate: null,
      top2Rate: 0,
      avgSt: null,
      starts: 0,
      calcFrom: null,
      calcTo: null,
      finals: 0,
      wins: 0,
      recent: { finals: 0, wins: 0, from: "2024-05-01", to: "2026-04-30" },
      fallback: false,
      pending: null,
    },
  );
  return { RD, ok };
}

export function suiteBasicInfoStatsPart14(m, check, RD, ok) {
  // 2026-09-29 13場12R 1号艇 馬場貴也（4262）の本番値。前期 優出5・優勝1、直近2年 優出22・優勝6
  // （racer_period_stats の各期の値をそのまま。2026-10-02 に本番から取得）
  const baba = [
    [2026, 2, 5, 1],
    [2026, 1, 5, 3],
    [2025, 2, 6, 0],
    [2025, 1, 6, 2],
    [2024, 2, 6, 3], // 範囲外（2年より前）。足さない
  ].map(([py, pn, finals, wins]) => ({
    racer_id: 4262,
    period_year: py,
    period_no: pn,
    finals,
    wins,
  }));
  const babaPicked = m.pickPeriodStats(
    ok([
      ...baba,
      { racer_id: 9999, period_year: 2026, period_no: 2, finals: 50, wins: 50 },
    ]),
    4262,
    RD,
  );
  check(
    "pickPeriodStats: 前期の優出・優勝と、前期を含む4期の合計（範囲外の期・他の選手は足さない）",
    [
      babaPicked.finals,
      babaPicked.wins,
      babaPicked.recent,
      babaPicked.fallback,
    ],
    [
      5,
      1,
      { finals: 22, wins: 6, from: "2024-05-01", to: "2026-04-30" },
      false,
    ],
  );

  // 期替わり直後（2026-11-05）: 前期 (2027,1)=2026-05-01〜10-31 の fan がまだ公開されていない
  const RD_NOV = "2026-11-05";
  const fb = m.pickPeriodStats(
    { rows: baba, latestImported: false },
    4262,
    RD_NOV,
  );
  check(
    "pickPeriodStats: 前期を表として取り込んでいなければ、前々期と、前々期で終わる4期の合計を出し、公開待ちの期を返す",
    [fb.fallback, fb.finals, fb.wins, fb.recent, fb.pending],
    [
      true,
      5,
      1,
      // (2026,2)〜(2025,1) の4期。(2024,2) は範囲外
      { finals: 22, wins: 6, from: "2024-05-01", to: "2026-04-30" },
      { calcFrom: "2026-05-01", calcTo: "2026-10-31" },
    ],
  );
  check(
    "pickPeriodStats: 取り込み済み（latestImported=true）なら、前期の行が無い選手は前々期に切り替えず null",
    m.pickPeriodStats({ rows: baba, latestImported: true }, 4262, RD_NOV),
    null,
  );
  check(
    "pickPeriodStats: 前々期の行も無ければ null（前々々期までは遡らない）",
    m.pickPeriodStats(
      {
        rows: [
          { racer_id: 1, period_year: 2026, period_no: 1, finals: 1, wins: 0 },
        ],
        latestImported: false,
      },
      1,
      RD_NOV,
    ),
    null,
  );
}
