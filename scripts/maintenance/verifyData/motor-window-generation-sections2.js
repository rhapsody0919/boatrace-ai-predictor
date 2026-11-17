/**
 * verify-motor-window-generation.js の検査の続き（大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない）。
 * 共通の道具・場面は ctx で受け取る。前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section7(ctx) {
  const {
    G,
    M,
    V,
    check,
    day,
    fetchMotorDailySeries,
    getMotorConditionTrend,
    getMotorPartsHistory,
    getMotorPowerIndex,
    getMotorUsageHistory,
    getMotorWakuStats,
    makeBreakdownWorld,
    rid,
    run,
    same,
    seed,
    world,
  } = ctx;
  // ---- 3. 戻り値の形を変えた関数は、localStorage に残る旧版のキャッシュを読まない ----
  {
    const stale = { sample_count: 999 };
    const pi = await run(world(), async () => {
      seed(`motor-power-index-v2-${V}-${M}-90`, stale);
      return getMotorPowerIndex(V, M, 90);
    });
    check("機力指数: 旧版（v2）のキャッシュを読まない", pi.sample_count === 5);
    const ds = await run(world(), async () => {
      seed(`motor-daily-series-${V}-${M}-90`, [{ date: "旧" }]); // 配列だった頃のキー
      seed(`motor-daily-series-v2-${V}-${M}-90`, {
        window: null,
        series: [{ date: "v2" }],
      }); // レース番号が無かった頃
      return fetchMotorDailySeries(V, M, 90);
    });
    check(
      "日次系列: 旧版（配列・v2）のキャッシュを読まない（部品交換のレース番号 eventRaceNos が付く）",
      ds.series.length === 5 && same(ds.series[2].eventRaceNos, [5]),
    );
    const tr = await run(world(), async () => {
      seed(`motor-condition-v2-${V}-${M}-90`, { trend: [{ date: "旧" }] });
      return getMotorConditionTrend(V, M, 90);
    });
    check("推移: 旧版（v2）のキャッシュを読まない", tr.trend.length === 5);
    const ph = await run(world(), async () => {
      seed(`motor-parts-history-${V}-${M}-90`, { events: [] });
      seed(`motor-parts-history-v2-${V}-${M}-90`, { events: [{ date: "v2" }] }); // レース番号が無かった頃
      return getMotorPartsHistory(V, M, 90);
    });
    check(
      "部品交換: 旧版（v1・v2）のキャッシュを読まない（レース番号 raceNos が付く）",
      ph.events.length === 2 && same(ph.events[0].raceNos, [5]),
    );
    const uh = await run(world(), async () => {
      seed(`motor-usage-history-${V}-${M}`, [{ racerId: 0 }]);
      seed(`motor-usage-history-v3-${V}-${M}`, [
        { racerId: 0, sampleCount: 1 },
      ]); // 着順の付かない走を分母に数えなかった頃
      return getMotorUsageHistory(V, M);
    });
    check(
      "使用履歴: 旧版（v1・v3）のキャッシュを読まない",
      uh.length === 3 && uh[2].racerId === 11,
    );
    const wk = await run(world(), async () => {
      seed(`motor-waku-stats-${V}-${M}`, [{ course: 1, raceCount: 999 }]);
      return getMotorWakuStats(V, M);
    });
    check(
      "枠番別成績: 旧形式（配列）のキャッシュを読まない",
      wk.generationStart === G && wk.rows.length === 6,
    );
  }
  // ---- 4. 一覧表（getRaceMotorBreakdown） ----
  // 使用開始日が1年以上前（入れ替え直後の特例が働かない）の会場。公式の2連率は全艇 0 より大きい
  const breakdownWorld = makeBreakdownWorld(day, rid);
  Object.assign(ctx, { breakdownWorld });
}

export async function section8(ctx) {
  const {
    M,
    V,
    askedAbout,
    breakdownWorld,
    check,
    clearCache,
    clock,
    day,
    fake,
    getRaceMotorBreakdown,
    hasFilter,
    near,
    rid,
    run,
    store,
    tablesAsked,
  } = ctx;
  {
    // 過去レース: 再計算せず出走表時点の公式値。優出・優勝・1着率はレース日以前で最新のスナップショット
    const past = rid(-20, 1);
    const { tables } = breakdownWorld();
    const got = await run(tables, () => getRaceMotorBreakdown(past, V, 90));
    const [r1, r2] = got.rows;
    check(
      "一覧表（過去）: 機力指数を再計算せず（power_index: null）、2連率・3連率は出走表の公式値のまま、rate_source は official",
      got.rows.length === 2 &&
        [r1, r2].every(
          (r) => r.rate_source === "official" && r.power_index === null,
        ) &&
        r1.motor_number === 25 &&
        r1.motor_2rate === 30 &&
        r1.motor_3rate === 50 &&
        r2.motor_number === M &&
        r2.motor_2rate === 42 &&
        r2.motor_3rate === 62 &&
        r2.official_2rate === 42 &&
        r2.official_3rate === 62 &&
        !tablesAsked().includes("races") &&
        !tablesAsked().includes("race_results"),
    );
    check(
      "一覧表（過去）: 優出・優勝・1着率・出走数はレース日以前で最新のスナップショット（レース後のものは使わない。無ければ null）",
      r2.final_count === 3 &&
        r2.championship_count === 1 &&
        r2.first_place_count === 10 &&
        r2.race_count === 50 &&
        r1.final_count === null &&
        r1.race_count === null &&
        r2.venue_stats_failed === false,
    );
    check(
      "一覧表（過去）: 会場公式の成績は asOfDate = レースの日以前を、会場・モーター番号で絞って読む",
      askedAbout("venue_motor_stats").length === 2 &&
        askedAbout("venue_motor_stats").every(
          (c) =>
            hasFilter(c, "lte", "scraped_date", day(-20)) &&
            hasFilter(c, "eq", "venue_code", V),
        ),
    );
  }
  {
    // 当日のレース: 2連率・3連率を機力指数の期間の値に差し替える。機力指数は「このレースの直前まで」
    const { tt, tables } = breakdownWorld();
    clearCache();
    Object.keys(store).forEach((k) => delete store[k]);
    fake.reset(tables);
    const today = await getRaceMotorBreakdown(tt, V, 90);
    const [r1, r2] = today.rows;
    check(
      "一覧表（当日）: 機力指数（このレースの直前まで。同日の後のレース・このレース自身は入れない）で2連率・3連率を差し替え、rate_source は recalc",
      r1.rate_source === "recalc" &&
        r1.sample_count === 3 &&
        near(r1.power_index, -50 / 3) &&
        near(r1.motor_2rate, 100 / 3) &&
        near(r1.motor_3rate, 200 / 3) &&
        r1.official_2rate === 41.2 &&
        r1.official_3rate === 61.5 &&
        // 走りの無いモーターは公式値のまま
        r2.sample_count === 0 &&
        r2.power_index === null &&
        r2.motor_2rate === 30 &&
        r2.motor_3rate === 50,
    );
    check(
      "一覧表（当日）: 優出・優勝・1着率は最新のスナップショット",
      r1.final_count === 5 &&
        r1.championship_count === 2 &&
        r1.first_place_count === 14 &&
        r1.race_count === 70 &&
        r2.final_count === 1,
    );
    // 日付が変わって過去レースになったら、当日に保存した再計算の値を読まず、公式値で出す
    clock.offsetMs = 86400000;
    const nextDay = await getRaceMotorBreakdown(tt, V, 90);
    check(
      "一覧表: 日付が変わって過去レース扱いになったら、当日に保存した再計算の値を読まず、公式値（official）で出す",
      nextDay.rows.every(
        (r) => r.rate_source === "official" && r.power_index === null,
      ) &&
        nextDay.rows[0].motor_2rate === 41.2 &&
        nextDay.rows[0].motor_3rate === 61.5,
    );
    clock.offsetMs = 0;
  }
}

export async function section9(ctx) {
  const {
    M,
    V,
    breakdownWorld,
    check,
    clearCache,
    day,
    fake,
    getVenueMotorStats,
    isPastRace,
    rid,
    same,
  } = ctx;
  check(
    "isPastRace: レースの日付が今日（JST）より前なら過去（当日・先の日は過去でない）",
    isPastRace(rid(-1, 1)) === true &&
      isPastRace(rid(0, 1)) === false &&
      isPastRace(rid(1, 1)) === false,
  );
  {
    // 会場公式の成績: asOfDate 以前で最新のスナップショット。キャッシュのキーを分ける
    const { tables } = breakdownWorld();
    clearCache();
    fake.reset({
      ...tables,
      venue_motor_stats: [
        ...tables.venue_motor_stats,
        {
          venue_code: V,
          motor_number: M,
          scraped_date: day(-2),
          final_count: 8,
          championship_count: 3,
          first_place_count: 20,
          race_count: 90,
        },
      ],
    });
    const asOf = await getVenueMotorStats(V, M, day(-20));
    const latest = await getVenueMotorStats(V, M);
    const asOfAgain = await getVenueMotorStats(V, M, day(-20));
    const none = await getVenueMotorStats(V, M, day(-40));
    check(
      "getVenueMotorStats: asOfDate 以前で最新のスナップショットを返し（無ければ null）、asOfDate なしの呼び出しとキャッシュを分ける",
      asOf.scrapedDate === day(-30) &&
        asOf.finalCount === 3 &&
        asOf.raceCount === 50 &&
        latest.scrapedDate === day(-2) &&
        latest.finalCount === 8 &&
        same(asOfAgain, asOf) &&
        none === null,
    );
  }
}

export async function section10(ctx) {
  const {
    M,
    V,
    check,
    clearCache,
    day,
    fake,
    getVenueMotorRanking,
    getVenueMotorSnapshot,
    run,
    same,
    seed,
  } = ctx;
  {
    // 会場内順位: asOfDate 以前のスナップショット（過去レースのドリルダウン）。同値は同順位。出走数 0 は外す
    const row = (
      motor_number,
      scraped_date,
      top2_rate,
      accident_rate,
      race_count = 10,
    ) => ({
      venue_code: V,
      motor_number,
      scraped_date,
      top2_rate,
      win_rate: top2_rate,
      top3_rate: top2_rate,
      accident_rate,
      final_count: 0,
      championship_count: 0,
      race_count,
      stats_period_end: null,
    });
    const tables = {
      venue_motor_stats: [
        row(24, day(-30), 50, 0.1),
        row(25, day(-30), 60, 0.1),
        row(26, day(-30), 50, 0.1),
        row(27, day(-30), null, null),
        row(28, day(-30), 99, 0.1, 0),
        row(24, day(-10), 70, 0.2),
        row(25, day(-10), 60, 0.1),
        row(26, day(-10), 50, 0.2),
        row(27, day(-10), null, null),
        row(28, day(-10), 99, 0.1, 0),
        { ...row(24, day(-10), 70, 0.2), venue_code: 16 },
      ],
    };
    clearCache();
    fake.reset(tables);
    const old = await getVenueMotorRanking(V, M, "top2Rate", day(-20));
    const latest = await getVenueMotorRanking(V, M, "top2Rate");
    const accident = await getVenueMotorRanking(V, M, "accidentRate");
    const snapshot = await getVenueMotorSnapshot(V, day(-20));
    check(
      "会場内順位: asOfDate 以前のスナップショットで、同じ値は同じ順位（2位タイ）・値なしと出走数 0 は母数に入れない",
      same(old, {
        rank: 2,
        tied: 2,
        total: 3,
        metric: "top2Rate",
        value: 50,
        scrapedDate: day(-30),
      }),
    );
    check(
      "会場内順位: asOfDate なしは最新のスナップショット、事故率は低いほど上位（24号機は 0.2 で2位タイ）",
      same(latest, {
        rank: 1,
        tied: 1,
        total: 3,
        metric: "top2Rate",
        value: 70,
        scrapedDate: day(-10),
      }) &&
        accident.rank === 2 &&
        accident.tied === 2 &&
        accident.metric === "accidentRate",
    );
    check(
      "会場スナップショット（getVenueMotorSnapshot）: asOfDate 以前で最新の scraped_date の全モーターを返す",
      snapshot.state === "ok" &&
        snapshot.scrapedDate === day(-30) &&
        snapshot.rows.length === 5,
    );
    const stale = await run(tables, async () => {
      seed(`venue-motor-ranking-v2-${V}-${M}-top2Rate`, { rank: 99 });
      return getVenueMotorRanking(V, M, "top2Rate");
    });
    check("会場内順位: 旧版（v2）のキャッシュを読まない", stale.rank === 1);
  }
}

export async function section11(ctx) {
  const {
    G,
    M,
    V,
    askedAbout,
    check,
    clearCache,
    clock,
    day,
    ent,
    fake,
    getRacesForVenueSince,
    hasFilter,
    motor3,
    race,
    read,
    resultOf,
    rid,
    same,
    slice0,
    startRows,
  } = ctx;
  // ---- 5. getRacesForVenueSince: beforeRaceId より前（<）に限り、includeTarget でだけ対象を含める ----
  {
    const tables = {
      races: [
        rid(-9, 1),
        rid(-9, 2),
        rid(-9, 3),
        rid(-8, 1),
        rid(-30, 1),
        rid(-9, 2).replace("-15-", "-16-"),
      ].map(race),
    };
    const target = rid(-9, 2);
    clearCache();
    fake.reset(tables);
    const ids = (rows) => rows.map((r) => r.race_id);
    const plain = await getRacesForVenueSince(V, day(-20), target);
    const incl = await getRacesForVenueSince(V, day(-20), target, {
      includeTarget: true,
    });
    const all = await getRacesForVenueSince(V, day(-20));
    check(
      "getRacesForVenueSince: 既定は対象のレースを除き（race_id <）、includeTarget は対象まで含む（race_id <=）。後のレース・開始日より前・他会場は入らず、キャッシュのキーを分ける",
      same(ids(plain), [rid(-9, 1)]) &&
        same(ids(incl), [rid(-9, 1), target]) &&
        same(ids(all), [rid(-9, 1), target, rid(-9, 3), rid(-8, 1)]),
    );
    const raceQueries = askedAbout("races");
    check(
      "getRacesForVenueSince: 開始日（当日を含む）から beforeRaceId の日付まで、会場で絞って読む",
      hasFilter(raceQueries[0], "gte", "race_date", day(-20)) &&
        hasFilter(raceQueries[0], "lte", "race_date", day(-9)) &&
        hasFilter(raceQueries[0], "eq", "venue_code", V),
    );
    // 過去レースの上限は長い期限で保存する（キーの末尾が race_id のまま。2時間後に開いても取り直さない）
    const callsBefore = fake.calls.length;
    clock.offsetMs = 2 * 3600 * 1000;
    await getRacesForVenueSince(V, day(-20), target);
    await getRacesForVenueSince(V, day(-20), target, { includeTarget: true });
    check(
      "getRacesForVenueSince: 過去レースが上限の結果は、includeTarget の有無によらず2時間後も取り直さない（キャッシュのキーの末尾が race_id のまま）",
      fake.calls.length === callsBefore,
    );
    clock.offsetMs = 0;
  }
  {
    // 優勝履歴: 過去レースではそのレースより前の優勝に限る（現行世代の絞りは verify-motor-championship-generation.js が見る）
    const f1 = rid(-30, 12);
    const f2 = rid(-6, 12);
    const stage = (race_id) => ({
      race_id,
      race_stage: "優勝戦",
      races: { venue_code: V },
    });
    const tables = {
      venue_motor_start_dates: startRows(V, G),
      race_conditions: [stage(f1), stage(f2)],
      race_entries: [ent(f1, 1, 11), ent(f2, 2, 12)],
      race_results: [resultOf(f1, [1]), resultOf(f2, [2])],
    };
    clearCache();
    fake.reset(tables);
    const { getVenueMotorChampionshipHistory } = motor3;
    const all = await getVenueMotorChampionshipHistory(V, M);
    const before = await getVenueMotorChampionshipHistory(V, M, f2);
    check(
      "優勝履歴: beforeRaceId を渡すとそのレースより前（<）の優勝に限り、渡さない呼び出しのキャッシュを読まない",
      same(
        all.wins.map((w) => w.raceId),
        [f2, f1],
      ) &&
        same(
          before.wins.map((w) => w.raceId),
          [f1],
        ),
    );
  }
  // 純関数の行の組み立て（過去レースは公式値のまま）。ソースを検査する
  // 行の組み立ては src/pure/raceMotorBreakdown.js の pastMotorRows に移した（開発効率の計画 段3）
  const pastRowsFn = slice0(
    read("src/pure/raceMotorBreakdown.js"),
    "export function pastMotorRows(",
    "\n}\n",
  );
  check(
    '一覧表（過去）: rate_source: "official"・power_index: null',
    pastRowsFn.includes('rate_source: "official"') &&
      pastRowsFn.includes("power_index: null"),
  );
  Object.assign(ctx, { pastRowsFn });
}
