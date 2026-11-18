/**
 * verify-frontend-pure-functions.js の検査の続き（frontend-pure-functions-course-six.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { rec } from "./frontend-pure-functions-common.js";

// ---------------------------------------------------------------------------
// 3. courseGridStats.js
// ---------------------------------------------------------------------------
export function suiteCourseGridStats(m, check) {
  suiteCourseGridStatsPart1(m, check);
  const { records } = suiteCourseGridStatsPart2(m, check);
  suiteCourseGridStatsPart3(m, check, records);
}

export function suiteCourseGridStatsPart1(m, check) {
  // BOA-1328: 全期間の1コースの走を分母にする（負けた走だけではない）。
  const now = new Date("2026-11-05T00:00:00+09:00");
  const lossRecord = (winningTechnique, rank1 = 2, extra = {}) => ({
    date: "2026-10-01", venueCode: 4, raceGrade: "ippan",
    actualCourse: 1, boatNumber: 1, rank1, winningTechnique, ...extra,
  });
  const losses = [
    ...Array.from({ length: 5 }, () => lossRecord("まくり")),
    ...Array.from({ length: 4 }, () => lossRecord("差し")),
    lossRecord("まくり差し"), lossRecord("まくり差し"), lossRecord(null),
    ...Array.from({ length: 22 }, () => lossRecord("まくり", 1)),
  ];
  losses[0] = lossRecord("まくり", 2, { date: "2025-12-03", raceGrade: "G2" });
  losses[1] = lossRecord("まくり", 2, { date: "2026-11-04", venueCode: 24 });
  const mixed = [...losses, lossRecord("差し", 2, { actualCourse: 2 }),
    lossRecord("まくり", 2, { actualCourse: null })];
  check("buildCourse1LossBreakdown: 過去走の艇番で本人の1着を判定",
    m.buildCourse1LossBreakdown([
      lossRecord("まくり", 3, { boatNumber: 3 }),
      lossRecord("差し", 1, { boatNumber: 3 }),
    ], { now }), {
      n: 2, makurare: 0, sashi: 1, makurarePct: 0, sashiPct: 50,
      reliable: false, from: "2026-10-01", to: "2026-10-01",
    });
  const roundingRows = [lossRecord("まくり"),
    ...Array.from({ length: 200 }, () => lossRecord("逃げ", 1))];
  check("buildCourse1LossBreakdown: 1/201 は二重丸めせず0%",
    m.buildCourse1LossBreakdown(roundingRows, { now }).makurarePct, 0);
  const original = JSON.stringify(mixed);
  const breakdown = m.buildCourse1LossBreakdown(mixed, { now });
  check("buildCourse1LossBreakdown: 34走、非1着のまくり5・差し4だけを加算", breakdown, {
    n: 34, makurare: 5, sashi: 4, makurarePct: 15, sashiPct: 12,
    reliable: true, from: "2025-12-03", to: "2026-11-04",
  });
  check("buildCourse1LossBreakdown: 全期間行と母数が一致", breakdown.n,
    m.buildTodayCourseRows(mixed, { venueCode: null, course: 1, now })
      .find((row) => row.key === "current").n);
  check("buildCourse1LossBreakdown: 入力を変更しない", JSON.stringify(mixed), original);
  const small = [lossRecord("まくり"), lossRecord("まくり"), lossRecord("差し"),
    ...Array.from({ length: 15 }, () => lossRecord("逃げ", 1))];
  check("buildCourse1LossBreakdown: 18走でも割合を返す", m.buildCourse1LossBreakdown(small, { now }), {
    n: 18, makurare: 2, sashi: 1, makurarePct: 11, sashiPct: 6,
    reliable: false, from: "2026-10-01", to: "2026-10-01",
  });
  for (const n of [29, 30]) {
    const rows = Array.from({ length: n }, () => lossRecord("逃げ", 1));
    check(`buildCourse1LossBreakdown: 信頼性の境界 ${n}走`,
      m.buildCourse1LossBreakdown(rows, { now }).reliable, n >= 30);
  }
  const other = ["まくり差し", "抜き", "恵まれ", null, ""].map((t) => lossRecord(t));
  check("buildCourse1LossBreakdown: その他と欠損も分母に含む", m.buildCourse1LossBreakdown(other, { now }), {
    n: 5, makurare: 0, sashi: 0, makurarePct: 0, sashiPct: 0,
    reliable: false, from: "2026-10-01", to: "2026-10-01",
  });
  for (const rows of [[], null, undefined, {}, "invalid", [lossRecord("差し", 2, { actualCourse: 2 })]]) {
    check("buildCourse1LossBreakdown: 1コースなし・非配列", m.buildCourse1LossBreakdown(rows, { now }), {
      n: 0, makurare: 0, sashi: 0, makurarePct: null, sashiPct: null,
      reliable: false, from: null, to: null,
    });
  }
}

export function suiteCourseGridStatsPart2(m, check) {
  const records = [
    // 1号艇で2コースに入った走（艇番ではなく実進入コースで数える）
    rec({
      raceId: "2026-09-10-04-01",
      boatNumber: 1,
      actualCourse: 2,
      ranks: [1, 2, 3],
    }),
    rec({
      raceId: "2026-09-11-04-01",
      boatNumber: 2,
      actualCourse: 2,
      ranks: [1, 3, 4],
    }),
    rec({
      raceId: "2026-09-12-04-01",
      boatNumber: 3,
      actualCourse: 3,
      ranks: [3, 1, 2],
    }),
    // 実進入コースが取れていない走（2025-12-04以前・当日）
    rec({
      raceId: "2026-09-13-04-01",
      boatNumber: 1,
      actualCourse: null,
      ranks: [1, 2, 3],
    }),
    rec({
      raceId: "2026-09-14-04-01",
      boatNumber: 1,
      actualCourse: null,
      ranks: [1, 2, 3],
    }),
  ];

  // de872e51: course が数値でないときに actualCourse===null の走を「今日のコース」として数えていた
  const nullCourse = m.buildTodayCourseRows(records, {
    venueCode: 4,
    course: null,
  });
  check(
    "buildTodayCourseRows: 想定コースが null なら全行 n=0（actualCourse=null の走を数えない、de872e51）",
    nullCourse.map((r) => r.n),
    [0, 0, 0, 0, 0, 0],
  );
  check(
    "buildTodayCourseRows: 想定コースが undefined でも同じ",
    m.buildTodayCourseRows(records, { venueCode: 4, course: undefined })[0]
      .metrics,
    { winRate: null, top2Rate: null, top3Rate: null },
  );
  const today2 = m.buildTodayCourseRows(records, {
    venueCode: 4,
    course: 2,
  })[0];
  check(
    "buildTodayCourseRows: 実進入2コースの2走（艇番1と2）で3指標を同時に出す",
    [
      today2.n,
      today2.metrics.winRate,
      today2.metrics.top2Rate,
      today2.metrics.top3Rate,
    ],
    [2, 50, 50, 50],
  );

  const grid = m.buildCourseGrid(records, { venueCode: 4, metric: "winRate" });
  check(
    "buildCourseGrid: 列は艇番ではなく実進入コース。null の走はどの列にも入らない",
    grid[0].cells.map((c) => c.n),
    [0, 2, 1, 0, 0, 0],
  );
  check(
    "buildCourseGrid: n=0 のセルは value=null（0% と区別する）",
    [grid[0].cells[0].value, grid[0].cells[2].value],
    [null, 100],
  );

  check(
    "computeWakuNariRate: 実進入コースが取れた走だけを母数にする",
    m.computeWakuNariRate(records),
    { rate: (2 / 3) * 100, n: 3 },
  );
  check("computeWakuNariRate: 0件は null", m.computeWakuNariRate([]), {
    rate: null,
    n: 0,
  });
  return { records };
}

export function suiteCourseGridStatsPart3(m, check, records) {
  check(
    "getCourseRecentRuns: 実進入コースで絞り、古い順（帯の「古い→新しい」と同じ向き。BOA-601）",
    m
      .getCourseRecentRuns(records, {
        venueCode: 4,
        rowKey: "current",
        course: 2,
      })
      .map((r) => r.raceId),
    ["2026-09-10-04-01", "2026-09-11-04-01"],
  );
  // 同じ日の2走は、records が日付だけで並んでいても R の順にそろえる（ファン評価2周目）
  check(
    "getCourseRecentRuns: 同じ日の2走は R の小さい順（入力が日の中で逆順でも）",
    m
      .getCourseRecentRuns(
        [
          rec({ raceId: "2026-09-12-04-09", boatNumber: 2, actualCourse: 2 }),
          rec({ raceId: "2026-09-12-04-04", boatNumber: 2, actualCourse: 2 }),
        ],
        { venueCode: 4, rowKey: "current", course: 2 },
      )
      .map((r) => r.raceId),
    ["2026-09-12-04-04", "2026-09-12-04-09"],
  );
  // 「直近1ヶ月」の起点をレースの日にそろえる（BOA-603）。今日（2026-10-01）を
  // 起点にすると、9/5 のレースでは 8/10 の走が期間の外に落ちる
  const periodRecs = [
    rec({ raceId: "2026-08-10-04-01", boatNumber: 2, actualCourse: 2 }),
    rec({ raceId: "2026-09-03-04-01", boatNumber: 2, actualCourse: 2 }),
  ];
  check(
    "getCourseRecentRuns: 直近1ヶ月の起点に now（レースの日）を使う",
    [
      m
        .getCourseRecentRuns(periodRecs, {
          venueCode: 4,
          rowKey: "last1m",
          course: 2,
          now: new Date("2026-09-05T12:00:00+09:00"),
        })
        .map((r) => r.raceId),
      m
        .getCourseRecentRuns(periodRecs, {
          venueCode: 4,
          rowKey: "last1m",
          course: 2,
          now: new Date("2026-10-01T12:00:00+09:00"),
        })
        .map((r) => r.raceId),
    ],
    // 古い順（BOA-601。帯の左が古い）
    [["2026-08-10-04-01", "2026-09-03-04-01"], ["2026-09-03-04-01"]],
  );
}

// BOA-1291: 選手ページと同じ公式の3期を、レース日と想定コースで使う。
export function suiteSixBoatCourseStats(m, check) {
  suiteSixBoatCourseStatsPart1(m, check);
  suiteSixBoatCourseStatsPart2(m, check);
}

export function suiteSixBoatCourseStatsPart1(m, check) {
  // BOA-1338: 当地は既存の1艇ずつの表と同じ実進入コースの集計。
  const localRuns = (course, n) => Array.from({ length: n }, (_, i) => rec({
    raceId: `2026-01-01-04-${String(i + 1).padStart(2, "0")}`,
    boatNumber: 2, actualCourse: course,
    ranks: i < 7 ? [2, 1, 3, 4, 5, 6] : [1, 3, 2, 4, 5, 6],
  }));
  const localInput = {
    players: [{ number: 6, racerId: 6666 }, { number: "1", racerId: 1111 }],
    scopedByRacer: { 1111: [...localRuns(1, 12),
      ...localRuns(1, 1).map((r) => ({ ...r, venueCode: 5 })),
      ...localRuns(2, 1)], 6666: localRuns(6, 9) },
    venueCode: 4, now: new Date("2026-11-05T00:00:00Z"),
    baseline: { venue: { byCourse: { "1": { winRate: 52 } } } },
  };
  const localBefore = JSON.stringify(localInput);
  const local = m.buildSixBoatLocalRows(localInput);
  check("当地: 6行を艇番順に返す", local.map((r) => [r.boat, r.course]),
    [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
  check("当地: 別会場・別コースを除き、12走7勝の率と平均との差を丸めない", local[0], {
    boat: 1, racerId: 1111, course: 1, wins: 7, entries: 12,
    winRate: 7 / 12 * 100, top2Rate: 7 / 12 * 100, top3Rate: 100,
    avg: 52, diff: 7 / 12 * 100 - 52, reliability: "ok",
    periods: [], contiguous: true,
  });
  check("当地: 6コース9走はnoneで差なし",
    [local[5].entries, local[5].wins, local[5].reliability, local[5].diff],
    [9, 7, "none", null]);
  const noVenue = m.buildSixBoatLocalRows({ ...localInput, baseline: { venue: null } })[0];
  check("当地: 会場平均なしはavg・diffともnull", [noVenue.avg, noVenue.diff], [null, null]);
  for (const [records, reliability] of [[undefined, "loading"], [null, "error"]]) {
    const r = m.buildSixBoatLocalRows({ ...localInput, scopedByRacer: { 1111: records } })[0];
    check(`当地: ${reliability}は0走と区別し数値をnullにする`, r, {
      boat: 1, racerId: 1111, course: 1, wins: null, entries: 0,
      winRate: null, top2Rate: null, top3Rate: null, avg: null, diff: null,
      reliability, periods: [], contiguous: true,
    });
  }
  for (const [course, limit] of [[1, 10], [2, 30], [3, 30], [4, 30], [5, 42], [6, 67]]) {
    for (const n of [0, 9, 10, limit - 1, limit, limit + 1]) {
      const r = m.buildSixBoatLocalRows({ ...localInput,
        players: [{ number: course, racerId: 1111 }],
        scopedByRacer: { 1111: localRuns(course, n) },
        baseline: { venue: { byCourse: { [course]: { winRate: 0 } } } },
      })[course - 1];
      const reliability = n < 10 ? "none" : n < limit ? "warn" : "ok";
      check(`当地: ${course}コース${n}走の境界・0%の平均`,
        [r.entries, r.wins, r.reliability, r.avg, r.diff],
        [n, Math.min(n, 7), reliability, 0, reliability === "ok" ? 7 / n * 100 : null]);
      if (n === 0) check("当地: 正常な0走はnoneで率null",
        [r.winRate, r.top2Rate, r.top3Rate], [null, null, null]);
    }
  }
  check("当地: 入力を変更しない", JSON.stringify(localInput), localBefore);
}

export function suiteSixBoatCourseStatsPart2(m, check) {
  const row = (y, n, entries, wins, p2 = 0, p3 = 0, course = 1) => ({
    period_year: y, period_no: n, starts: 100,
    calc_from: n === 1 ? `${y - 1}-05-01` : `${y - 1}-11-01`,
    calc_to: n === 1 ? `${y - 1}-10-31` : `${y}-04-30`,
    [`c${course}_entries`]: entries, [`c${course}_p1`]: wins,
    [`c${course}_p2`]: p2, [`c${course}_p3`]: p3,
  });
  const rows = [row(2025, 1, 40, 30), row(2026, 2, 37, 23, 6, 4),
    row(2025, 2, 35, 20, 6, 4), row(2026, 1, 30, 20, 5, 3)];
  const baseline = { national: { "1": { winRate: 55.2 } } };
  const input = { players: [{ number: 1, racerId: 4444 }],
    periodRowsByRacer: { 4444: rows }, raceDate: "2026-11-04", baseline };
  const before = JSON.stringify(input);
  const result = m.buildSixBoatCourseRows(input);
  check("6行を艇番の順に返す", result.map((r) => [r.boat, r.course]),
    [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]);
  check("公式の新しい3期を合算し、率と差を丸めない", result[0], {
    boat: 1, racerId: 4444, course: 1, wins: 63, entries: 102,
    winRate: 63 / 102 * 100, top2Rate: 80 / 102 * 100,
    top3Rate: 91 / 102 * 100, avg: 55.2, diff: 63 / 102 * 100 - 55.2,
    reliability: "ok", periods: [
      { label: "2026年後期", range: "2025/11/01〜2026/04/30" },
      { label: "2026年前期", range: "2025/05/01〜2025/10/31" },
      { label: "2025年後期", range: "2024/11/01〜2025/04/30" },
    ], contiguous: true,
  });
  check("入力を変更しない", JSON.stringify(input), before);
  const past = m.buildSixBoatCourseRows({ ...input, raceDate: "2026-04-30" })[0];
  check("期の終了日ちょうどは除き、古い期を使う", [past.entries, past.wins], [105, 70]);
  check("絞り込みは入力順を保つ", m.periodsBefore(rows, "2026-04-30"),
    [rows[0], rows[2], rows[3]]);
  const withoutBaseline = m.buildSixBoatCourseRows({ ...input, baseline: null })[0];
  check("平均が無ければ差も出さない", [withoutBaseline.avg, withoutBaseline.diff], [null, null]);
  const missing = m.buildSixBoatCourseRows({ ...input,
    players: [{ number: 6, racerId: 9999 }, { number: 2 }] });
  check("行なし・IDなしは進入0で率なし", [missing[5], missing[1]].map((r) =>
    [r.entries, r.wins, r.winRate, r.top2Rate, r.top3Rate, r.diff, r.reliability]),
    Array(2).fill([0, 0, null, null, null, null, "none"]));
  check("件数の線", m.SIX_BOAT_WARN_ENTRIES, { 1: 10, 2: 30, 3: 30, 4: 30, 5: 42, 6: 67 });
  for (const [course, limit] of [[1, 10], [2, 30], [3, 30], [4, 30], [5, 42], [6, 67]]) {
    for (const entries of [0, 8, 9, 10, limit - 1, limit, limit + 1, 50]) {
      const r = m.buildSixBoatCourseRows({ raceDate: input.raceDate,
        players: [{ number: course, racerId: 4444 }],
        periodRowsByRacer: { 4444: [row(2026, 2, entries, entries ? 1 : 0, 0, 0, course)] },
        baseline: { national: { [String(course)]: { winRate: 0 } } },
      })[course - 1];
      const reliability = entries < 10 ? "none" : entries < limit ? "warn" : "ok";
      check(`${course}コース・${entries}進入の境界`,
        [r.entries, r.reliability, r.winRate, r.diff, r.avg],
        [entries, reliability, entries < 10 ? null : 1 / entries * 100,
          reliability === "ok" ? 1 / entries * 100 : null, 0]);
    }
  }
  const gap = m.buildSixBoatCourseRows({ ...input, periodRowsByRacer: {
    4444: [rows[1], { ...rows[3], starts: 0 }, rows[2], rows[0]],
  } })[0];
  check("出走0の期を飛ばした印と使用期", [gap.contiguous, gap.periods.map((p) => p.label)],
    [false, ["2026年後期", "2025年後期", "2025年前期"]]);
  const shuffled = m.buildSixBoatCourseRows({ ...input,
    players: [{ number: 6, racerId: 6666 }, { number: 1, racerId: 4444 }] });
  check("選手の入力順によらずIDを艇番に対応させる", [shuffled[0].racerId, shuffled[5].racerId], [4444, 6666]);
  for (const date of [null, undefined, "", "bad", "2026-02-29", "2026-13-01", "2026-04-31", "2026-1-01"]) {
    for (const run of [() => m.periodsBefore([], date),
      () => m.periodsBefore([{ calc_to: date }], input.raceDate)]) {
      let threw = false;
      try { run(); } catch (error) { threw = error instanceof Error; }
      check(`不正な日付 ${date} は Error`, threw, true);
    }
  }
  check("閏日の有効な日付を受け入れる", m.periodsBefore([{ calc_to: "2024-02-29" }], "2024-03-01"),
    [{ calc_to: "2024-02-29" }]);
}
