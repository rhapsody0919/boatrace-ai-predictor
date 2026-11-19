/**
 * verify-series-points-stage-rules.js の一部の場面。大きさの関所のため、本文を字のまま移した。verify ではない。
 * check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

/** verify の元の 379〜606 行（3つに割った） */
export async function absentScenesEarly({ createFakeSupabase, installLocalStorage, registerFakeServiceSupabase, setFakeSupabase, computeSeriesScore, listSeriesFinishes, buildMeetRanking, listAbsentOnlyRacers, FINISH_ABSENT, isAbsentStartRow, check }) {
  const { base, withPrelim } = absentScenesEarlyPart1({ computeSeriesScore, listSeriesFinishes, FINISH_ABSENT, check });
  const { board, RA } = absentScenesEarlyPart2({ buildMeetRanking, listAbsentOnlyRacers, FINISH_ABSENT, isAbsentStartRow, check, base });
  const { RB } = await absentScenesEarlyPart3({ createFakeSupabase, installLocalStorage, registerFakeServiceSupabase, setFakeSupabase, check, RA });
  return { base, withPrelim, board, RA, RB };
}

function absentScenesEarlyPart1({ computeSeriesScore, listSeriesFinishes, FINISH_ABSENT, check }) {
  const base = {
    raceStage: "予選",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: null, // 6艇目が着順に載っていない（失格・落水 or 欠場）
  };
  const withPrelim = { prelimEndRaceId: "2026-09-25-20-12" };
  // 走ったが着順が付かない（STの記録がある）: 0点・1走
  const disqualified = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: true }],
    withPrelim,
  );
  check("失格・落水は0点だが1走に数える", disqualified, {
    points: 0,
    runs: 1,
    rate: 0,
  });
  // 走っていない（STの記録が無い）: 走数にも入れない
  const absent = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: false }],
    withPrelim,
  );
  check("欠場は走数にも入れない", absent, { points: 0, runs: 0, rate: null });
  // 並びには「欠」として残す。外すと欠場したこと自体が画面から消える（BOA-504）
  check(
    "欠場は着順の並びに FINISH_ABSENT で出す（失格とは区別）",
    listSeriesFinishes(
      [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: false }],
      withPrelim,
    ),
    [FINISH_ABSENT],
  );
  check(
    "失格・落水は着順の並びに null で出す",
    listSeriesFinishes(
      [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6, started: true }],
      withPrelim,
    ),
    [null],
  );
  // `started` が付いていない行は従来どおり数える（旧来の呼び出し・ST未取得）
  const unknown = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 6 }],
    withPrelim,
  );
  check("started が無い行は従来どおり1走に数える", unknown.runs, 1);
  // 着順が付いている走は `started` を見ない（着順に載る＝走っている）
  const finished = computeSeriesScore(
    [{ ...base, raceId: "2026-09-23-20-01", boatNumber: 1, started: false }],
    withPrelim,
  );
  check("着順が付いていれば started=false でも数える", finished, {
    points: 10,
    runs: 1,
    rate: 10,
  });

  return { base, withPrelim };
}

function absentScenesEarlyPart2({ buildMeetRanking, listAbsentOnlyRacers, FINISH_ABSENT, isAbsentStartRow, check, base }) {
  // ---- 3c. 全走欠場の選手が比較表から消えない（BOA-504） ----
  // 2026-06-13 浜名湖12Rの2号艇（中岡正彦）は今節の走が全て欠場で、走数0の
  // ため順位表に載らず、6艇の比較表から黙って消えていた
  const board = {
    prelimEndRaceId: "2026-09-25-20-12",
    entries: [
      // 走った選手（1着）
      {
        ...base,
        raceId: "2026-09-23-20-01",
        boatNumber: 1,
        racerId: 1001,
        playerName: "走者",
        started: true,
      },
      // 全走欠場の選手（2走とも欠場）
      {
        ...base,
        raceId: "2026-09-23-20-01",
        boatNumber: 6,
        racerId: 2002,
        playerName: "欠場者",
        started: false,
      },
      {
        ...base,
        raceId: "2026-09-23-20-05",
        boatNumber: 6,
        racerId: 2002,
        playerName: "欠場者",
        started: false,
      },
      // 1走は欠場・1走は走った選手（全走欠場ではない）
      {
        ...base,
        raceId: "2026-09-23-20-02",
        boatNumber: 6,
        racerId: 3003,
        playerName: "混在",
        started: false,
      },
      {
        ...base,
        raceId: "2026-09-23-20-06",
        boatNumber: 1,
        racerId: 3003,
        playerName: "混在",
        started: true,
      },
      // まだ結果が無い走しかない選手（欠場ではない）
      {
        raceStage: "予選",
        raceId: "2026-09-23-20-12",
        boatNumber: 6,
        racerId: 4004,
        playerName: "未走",
        rank1: null,
        started: false,
      },
    ],
  };
  check(
    "全走欠場の選手だけを返す（走った選手・一部欠場・未走は含めない）",
    listAbsentOnlyRacers(board).map((r) => [r.racerId, r.finishes]),
    [[2002, [FINISH_ABSENT, FINISH_ABSENT]]],
  );
  check(
    "全走欠場の選手は順位表には載らない（走数0で得点率が出ない）",
    buildMeetRanking(board)
      .map((r) => r.racerId)
      .sort(),
    [1001, 3003],
  );
  check(
    "一部欠場の選手の並びは欠場の位置も残す",
    buildMeetRanking(board).find((r) => r.racerId === 3003).finishes,
    [FINISH_ABSENT, 1],
  );
  // 本番STの行は欠場の艇にもあり、finish_mark が「欠」（2026-06-05 芦屋7R の
  // 久永祥平・2026-06-20 尼崎12R の谷津幸宏で、一部欠場が「失」・分母入りになっていた）
  check(
    "本番STの行が「欠」なら欠場、出遅れ「L」やST付きの行は出走",
    [
      isAbsentStartRow({ start_timing: null, finish_mark: "欠" }),
      isAbsentStartRow({ start_timing: null, finish_mark: "L" }),
      isAbsentStartRow({ start_timing: 0.15, finish_mark: null }),
      isAbsentStartRow(null),
    ],
    [true, false, false, false],
  );
  // 下の2つの塊で使う race_id（1つの塊が関数の大きさの線を越えるので2つに割った）
  const RA = "2026-10-01-04-01"; // 本番ST の行がある。3号艇だけ「欠」
  return { board, RA };
}

async function absentScenesEarlyPart3({ createFakeSupabase, installLocalStorage, registerFakeServiceSupabase, setFakeSupabase, check, RA }) {
  const RB = "2026-10-01-04-02"; // 本番ST の行が1つも無い（取得漏れの疑い）
  {
    // 今節の出走判定（getMeetScoreboard の entries の started）を、偽の supabase（メモリ上の表）の上で見る
    registerFakeServiceSupabase();
    installLocalStorage();
    const { getMeetScoreboard } =
      await import("../../../src/services/meetQueries2.js");
    const { clearCache } = await import("../../../src/services/core.js");
    const DISPLAY = "2026-10-02-04-01";
    const ents = [RA, RB, DISPLAY].flatMap((race_id) =>
      [1, 2, 3].map((boat_number) => ({
        race_id,
        boat_number,
        racer_id: 7000 + boat_number,
        player_name: `選手${boat_number}`,
        motor_number: boat_number,
      })),
    );
    clearCache();
    const stRow = (boat_number, start_timing, finish_mark = null) => ({
      race_id: RA,
      boat_number,
      start_timing,
      is_flying: false,
      finish_mark,
    });
    const fake = setFakeSupabase(
      createFakeSupabase(
        {
          race_entries: ents,
          race_conditions: [RA, RB, DISPLAY].map((race_id, i) => ({
            race_id,
            race_stage: "予選",
            series_day: i < 2 ? 1 : 2,
            is_final_day: false,
          })),
          race_start_timings: [
            stRow(1, 0.12),
            stRow(2, 0.15),
            stRow(3, null, "欠"),
          ],
        },
        { sortByOrder: false },
      ),
    );
    const board = await getMeetScoreboard(DISPLAY, 4);
    check(
      "今節の出走判定は、本番STの「欠」の行を出走に数えない（行が1つも無いレースは取得漏れとして全艇を出走扱い）",
      board.entries.map((e) => [
        e.raceId,
        e.boatNumber,
        e.started,
        e.finishMark,
      ]),
      [
        [RA, 1, true, null],
        [RA, 2, true, null],
        [RA, 3, false, "欠"],
        [RB, 1, true, null],
        [RB, 2, true, null],
        [RB, 3, true, null],
      ],
    );
    const stq = fake.calls.find((q) => q.table === "race_start_timings");
    check(
      "今節の本番STは節の頭から表示中のレースの直前まで、finish_mark を含む列で取る",
      [stq.select, stq.filters.filter(([op]) => op !== "like")],
      [
        "race_id, boat_number, start_timing, is_flying, finish_mark",
        [
          ["gte", "race_id", RA.slice(0, 10)],
          ["lt", "race_id", DISPLAY],
        ],
      ],
    );
  }
  return { RB };
}
