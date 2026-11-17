/**
 * verify-motor-window-generation.js の検査の続き（motor-window-generation-sections1.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section1(ctx) {
  const {
    check,
    day,
    makeWorld,
    motorGenerationStartAsOf,
    motorWindowFrom,
    rid,
  } = ctx;
  // BOA-1019: レース日以前で最新の使用開始日。当日は新しい世代に含める。
  const generationRows = [
    { start_date: "2025-10-20" },
    { start_date: "2026-10-06" },
  ];
  for (const rows of [generationRows, [...generationRows].reverse()]) {
    for (const [date, expected] of [
      ["2025-11-11", "2025-10-20"],
      ["2026-10-06", "2026-10-06"],
      ["2026-10-05", "2025-10-20"],
      ["2025-10-19", null],
    ]) {
      for (const input of [date, `${date}-08-07`]) {
        check(
          `motorGenerationStartAsOf: ${input} → ${expected}（先頭 ${rows[0].start_date}）`,
          motorGenerationStartAsOf(rows, input) === expected,
        );
      }
    }
  }
  for (const rows of [[], null]) {
    check(
      `motorGenerationStartAsOf: 履歴 ${JSON.stringify(rows)} は null`,
      motorGenerationStartAsOf(rows, "2026-10-06") === null,
    );
  }
  // 期間の計算は純関数 motorWindowFrom（BOA-1245。龍神ボート番付と共有）。サービス側の使い方は下で見る
  check(
    "motorWindowFrom: 使用開始日が基準日−days より後なら使用開始日で切り詰める（max）",
    JSON.stringify(motorWindowFrom("2026-10-01", 90, "2026-11-04")) ===
      JSON.stringify({
        since: "2026-10-01",
        generationStart: "2026-10-01",
        clippedByGeneration: true,
      }) &&
      JSON.stringify(motorWindowFrom("2026-01-01", 90, "2026-11-04")) ===
        JSON.stringify({
          since: "2026-08-06",
          generationStart: "2026-01-01",
          clippedByGeneration: false,
        }) &&
      motorWindowFrom("2026-08-06", 90, "2026-11-04").clippedByGeneration ===
        false,
  );
  check(
    "motorWindowFrom: 使用開始日が不明なら since: null（集計しない）",
    JSON.stringify(motorWindowFrom(null, 90, "2026-11-04")) ===
      JSON.stringify({
        since: null,
        generationStart: null,
        clippedByGeneration: false,
      }),
  );
  // ---- 世界（偽の DB）。使用開始日は今日の40日前。90日の窓は使用開始日で切り詰められ、30日の窓は切られない ----
  const { G, ID, world, noStart } = makeWorld(day, rid);
  Object.assign(ctx, { G, ID, noStart, world });
}

export async function section2(ctx) {
  const {
    G,
    M,
    V,
    askedAbout,
    check,
    core,
    day,
    getMotorPowerIndex,
    hasFilter,
    motor1,
    motor2,
    motor3,
    motor4,
    motor5,
    motor6,
    motorWindowStart,
    near,
    noStart,
    rid,
    run,
    same,
    world,
  } = ctx;
  // ---- 1. 期間の開始日（motorWindowStart。計算の本体 motorWindowFrom は純関数で上で見た） ----
  {
    const results = await run(world(), () =>
      Promise.all([
        motorWindowStart(V, 90),
        motorWindowStart(V, 30),
        motorWindowStart(V, 20, rid(-10, 3)),
        motorWindowStart(V, 90, rid(-10, 3)),
      ]),
    );
    check(
      "motorWindowStart: 使用開始日（他会場の行は無視）で切り詰め、基準日は今日（beforeRaceId があればそのレースの日）",
      same(results[0], {
        since: G,
        generationStart: G,
        clippedByGeneration: true,
      }) &&
        same(results[1], {
          since: day(-30),
          generationStart: G,
          clippedByGeneration: false,
        }) &&
        same(results[2], {
          since: day(-30),
          generationStart: G,
          clippedByGeneration: false,
        }) &&
        same(results[3], {
          since: G,
          generationStart: G,
          clippedByGeneration: true,
        }),
    );
    const unknown = await run(noStart(), () => motorWindowStart(V, 90));
    check(
      "motorWindowStart: 使用開始日が不明なら since: null（集計しない）",
      same(unknown, {
        since: null,
        generationStart: null,
        clippedByGeneration: false,
      }),
    );
  }
  // ---- 2. 各集計が、世代で切り詰めた窓（使用開始日以降）のレースだけを集める ----
  check(
    "日数だけの窓 getRacesForVenue が残っていない（データ層のどこからも公開されない）",
    ![core, motor1, motor2, motor3, motor4, motor5, motor6].some(
      (m) => "getRacesForVenue" in m,
    ),
  );
  // 機力指数: 使用開始日以降の5走（前日・他会場・別モーター・結果なしは数えない）
  const idx = await run(world(), () => getMotorPowerIndex(V, M, 90));
  check(
    "機力指数（getMotorPowerIndex）: 使用開始日以降の走だけで、結果の出た走の「2着以内−選手の全国2連率」を平均し、切り詰めを知らせる",
    idx.sample_count === 5 &&
      near(idx.power_index, -12) &&
      near(idx.actual_rate2, 40) &&
      near(idx.actual_rate3, 60) &&
      near(idx.avg_baseline_rate2, 52) &&
      idx.clipped_by_generation === true &&
      idx.generation_unknown === false,
  );
  const raceQuery = askedAbout("races")[0];
  check(
    "機力指数: レースは使用開始日以降（当日を含む）を会場で絞って読む",
    askedAbout("races").length === 1 &&
      hasFilter(raceQuery, "gte", "race_date", G) &&
      hasFilter(raceQuery, "eq", "venue_code", V),
  );
  const short = await run(world(), () => getMotorPowerIndex(V, M, 30));
  Object.assign(ctx, { short });
}

export async function section3(ctx) {
  const {
    ID,
    M,
    V,
    askedAbout,
    check,
    clearCache,
    day,
    fake,
    fetchMotorDailySeries,
    getMotorPowerIndex,
    hasFilter,
    near,
    noStart,
    run,
    short,
    tablesAsked,
    world,
  } = ctx;
  check(
    "機力指数: 使用開始日より新しい「今日−days」が開始日になる（30日は3走・切り詰めなし）",
    short.sample_count === 3 &&
      near(short.power_index, -20) &&
      short.clipped_by_generation === false,
  );
  const unknown = await run(noStart(), () => getMotorPowerIndex(V, M, 90));
  check(
    "機力指数: 使用開始日が不明なら集計せず generation_unknown: true（レースを引かない）",
    unknown.generation_unknown === true &&
      unknown.sample_count === 0 &&
      unknown.power_index === null &&
      !tablesAsked().includes("races"),
  );
  // 上限（beforeRaceId）: そのレースより前（<）に限り、渡さない呼び出しのキャッシュを読まない
  clearCache();
  fake.reset(world());
  const all = await getMotorPowerIndex(V, M, 90);
  const before = await getMotorPowerIndex(V, M, 90, ID.b);
  check(
    "機力指数: beforeRaceId のレースより前の4走だけを数え、渡さない呼び出しのキャッシュを読まない",
    all.sample_count === 5 &&
      before.sample_count === 4 &&
      near(before.power_index, -5) &&
      near(before.actual_rate2, 50),
  );
  check(
    "機力指数: beforeRaceId の日付までのレースだけを読む（その日より後は引かない）",
    askedAbout("races").some((c) => hasFilter(c, "lte", "race_date", day(-5))),
  );
  // 日次系列（推移・部品交換の元）
  const { window, series } = await run(world(), () =>
    fetchMotorDailySeries(V, M, 90),
  );
  Object.assign(ctx, { all, series, window });
}

export async function section4(ctx) {
  const {
    G,
    ID,
    M,
    V,
    check,
    clearCache,
    day,
    fake,
    fetchMotorDailySeries,
    noStart,
    run,
    same,
    series,
    tablesAsked,
    window,
    world,
  } = ctx;
  check(
    "日次系列（fetchMotorDailySeries）: 使用開始日以降だけを日付ごとにまとめ（同日は先頭のレースの値）、部品交換が記録されたレース番号を添える",
    same(window, { since: G, generationStart: G, clippedByGeneration: true }) &&
      same(
        series.map((d) => d.date),
        [G, day(-39), day(-20), day(-5), day(-3)],
      ) &&
      series[0].motor_2rate === 40 &&
      series[0].exhibitionTime === 6.8 &&
      series[2].motor_2rate === 42 &&
      series[2].exhibitionTime === 6.7 &&
      same(series[2].parts, ["ピストン"]) &&
      series[2].propellerChanged === false &&
      same(series[2].eventRaceNos, [5]) &&
      series[4].propellerChanged === true &&
      same(series[4].eventRaceNos, [1]) &&
      same(series[0].eventRaceNos, []),
  );
  const unknown = await run(noStart(), () => fetchMotorDailySeries(V, M, 90));
  check(
    "日次系列: 使用開始日が不明なら集計しない（series: []・レースを引かない）",
    unknown.window.since === null &&
      same(unknown.series, []) &&
      !tablesAsked().includes("races"),
  );
  // 上限と includeTarget
  clearCache();
  fake.reset(world());
  const plain = await fetchMotorDailySeries(V, M, 90, ID.c);
  const incl = await fetchMotorDailySeries(V, M, 90, ID.c, {
    includeTarget: true,
  });
  const all = await fetchMotorDailySeries(V, M, 90);
  Object.assign(ctx, { all, incl, plain });
}

export async function section5(ctx) {
  const {
    G,
    M,
    V,
    all,
    check,
    day,
    getMotorConditionTrend,
    incl,
    noStart,
    plain,
    run,
    same,
    world,
  } = ctx;
  check(
    "日次系列: beforeRaceId のレースは既定で含めず、includeTarget: true でだけ含める（キャッシュのキーも分ける）",
    same(
      plain.series.map((d) => d.date),
      [G, day(-39), day(-20), day(-5)],
    ) &&
      same(
        incl.series.map((d) => d.date),
        [G, day(-39), day(-20), day(-5), day(-3)],
      ) &&
      all.series.length === 5,
  );
  // 推移（getMotorConditionTrend）
  const trend = await run(world(), () => getMotorConditionTrend(V, M, 90));
  check(
    "推移（getMotorConditionTrend）: 日次系列を {date, motor_2rate, motor_3rate, exhibition_time} にして返し、切り詰めを知らせる",
    trend.generationUnknown === false &&
      trend.clippedByGeneration === true &&
      same(trend.trend[0], {
        date: G,
        motor_2rate: 40,
        motor_3rate: 60,
        exhibition_time: 6.8,
      }) &&
      trend.trend.length === 5,
  );
  const trendUnknown = await run(noStart(), () =>
    getMotorConditionTrend(V, M, 90),
  );
  check(
    "推移: 使用開始日が不明なら generationUnknown: true・trend: []",
    trendUnknown.generationUnknown === true && same(trendUnknown.trend, []),
  );
}
