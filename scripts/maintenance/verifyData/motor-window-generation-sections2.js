/**
 * verify-motor-window-generation.js の検査の続き（motor-window-generation-sections2.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section6(ctx) {
  const {
    ID,
    M,
    V,
    check,
    clearCache,
    day,
    fake,
    getMotorPartsHistory,
    getMotorUsageHistory,
    noStart,
    run,
    same,
    world,
  } = ctx;
  {
    // 部品交換
    const parts = await run(world(), () => getMotorPartsHistory(V, M, 90));
    check(
      "部品交換（getMotorPartsHistory）: 使用開始日以降の交換を、記録されたレース番号と前後の展示タイム平均の比べ（improved）つきで返す",
      parts.events.length === 2 &&
        parts.events[0].date === day(-20) &&
        same(parts.events[0].raceNos, [5]) &&
        same(parts.events[0].parts, ["ピストン"]) &&
        parts.events[0].propellerChanged === false &&
        parts.events[0].interpretation === "improved" &&
        parts.events[1].date === day(-3) &&
        parts.events[1].propellerChanged === true &&
        same(parts.events[1].raceNos, [1]),
    );
    clearCache();
    fake.reset(world());
    const plain = await getMotorPartsHistory(V, M, 90, ID.c);
    const incl = await getMotorPartsHistory(V, M, 90, ID.c, {
      includeTarget: true,
    });
    check(
      "部品交換: beforeRaceId のレースの交換は既定で含めず、includeTarget: true でだけ含める（キャッシュのキーも分ける）",
      plain.events.length === 1 &&
        incl.events.length === 2 &&
        incl.events[1].date === day(-3),
    );
    const unknown = await run(noStart(), () => getMotorPartsHistory(V, M, 90));
    check(
      "部品交換: 使用開始日が不明なら events: []",
      same(unknown.events, []),
    );
  }
  // 使用履歴
  const usage = await run(world(), () => getMotorUsageHistory(V, M));
  const [m3, m2, m1] = usage;
  Object.assign(ctx, { m1, m2, m3, usage });
}

export async function section7(ctx) {
  const { G, check, day, m1, m2, m3, same, usage } = ctx;
  check(
    "使用履歴（getMotorUsageHistory）: 使用開始日以降を選手ごとの節（同じ選手が2日以内の間隔）にまとめ、新しい節から返す",
    usage.length === 3 &&
      same([m1.racerId, m2.racerId, m3.racerId], [11, 12, 13]) &&
      m1.firstDate === G &&
      m1.lastDate === day(-39) &&
      m2.firstDate === day(-20) &&
      m2.lastDate === day(-20) &&
      m3.firstDate === day(-5) &&
      m3.lastDate === day(-3),
  );
}

export async function section8(ctx) {
  const {
    ID,
    M,
    V,
    check,
    clearCache,
    fake,
    getMotorUsageHistory,
    m1,
    m2,
    m3,
    near,
    noStart,
    run,
    same,
    tablesAsked,
    world,
  } = ctx;
  check(
    "使用履歴: 着順の付かなかった走も、結果の出たレースなら分母に数える（不成立・結果なしは数えない）",
    // 節1: 艇1が1着・艇3が着順なし（成立）・不成立の走 → 2走で2連率50
    m1.sampleCount === 2 &&
      near(m1.rate2, 50) &&
      near(m1.rate3, 50) &&
      // 節2: 6着と2着 → 2走で2連率50・3連率50
      m2.sampleCount === 2 &&
      near(m2.rate2, 50) &&
      near(m2.rate3, 50) &&
      // 節3: 3着の走と結果なしの走 → 1走で2連率0・3連率100
      m3.sampleCount === 1 &&
      near(m3.rate2, 0) &&
      near(m3.rate3, 100) &&
      same(
        m3.races.map((r) => r.rank),
        [3, null],
      ) &&
      same(
        m1.races.map((r) => r.rank),
        [1, null, null],
      ),
  );
  const unknown = await run(noStart(), () => getMotorUsageHistory(V, M));
  check(
    "使用履歴: 使用開始日が不明なら空（レースを引かない）",
    same(unknown, []) && !tablesAsked().includes("races"),
  );
  clearCache();
  fake.reset(world());
  const plain = await getMotorUsageHistory(V, M, ID.c);
  const incl = await getMotorUsageHistory(V, M, ID.c, { includeTarget: true });
  const earlier = await getMotorUsageHistory(V, M, ID.b);
  check(
    "使用履歴: beforeRaceId のレースの出走は既定で含めず、includeTarget: true でだけ含める（結果が無ければ rank: null で n には数えない。キャッシュのキーも分ける）",
    same(
      plain[0].races.map((r) => r.rank),
      [3],
    ) &&
      same(
        incl[0].races.map((r) => r.rank),
        [3, null],
      ) &&
      incl[0].sampleCount === 1 &&
      earlier.length === 2,
  );
}

export async function section9(ctx) {
  const {
    G,
    ID,
    M,
    V,
    check,
    clearCache,
    fake,
    fetchMotorDailySeries,
    getMotorConditionTrend,
    getMotorPartsHistory,
    getMotorPowerIndex,
    getMotorRacerWakuStats,
    getMotorUsageHistory,
    getMotorWakuStats,
    run,
    same,
    seed,
    world,
  } = ctx;
  {
    // 枠番別成績・選手×枠成績: 上限（beforeRaceId）を通す
    clearCache();
    fake.reset(world());
    const sum = (stats) => stats.rows.reduce((n, r) => n + r.raceCount, 0);
    const waku = await getMotorWakuStats(V, M);
    const wakuBefore = await getMotorWakuStats(V, M, ID.b);
    const racer = await getMotorRacerWakuStats(V, M);
    const racerBefore = await getMotorRacerWakuStats(V, M, ID.b);
    check(
      "枠番別成績: 使用開始日以降の結果の出た走だけを数え、beforeRaceId のレースより前に限る（キャッシュのキーも分ける）",
      waku.generationStart === G && sum(waku) === 5 && sum(wakuBefore) === 4,
    );
    check(
      "選手×枠成績: 使用開始日以降の結果の出た走だけを数え、beforeRaceId のレースより前に限る（キャッシュのキーも分ける）",
      sum(racer) === 5 && sum(racerBefore) === 4,
    );
  }
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
}

export async function section10(ctx) {
  const {
    M,
    V,
    check,
    day,
    getRaceMotorBreakdown,
    makeBreakdownWorld,
    rid,
    run,
    tablesAsked,
  } = ctx;
  // ---- 4. 一覧表（getRaceMotorBreakdown） ----
  // 使用開始日が1年以上前（入れ替え直後の特例が働かない）の会場。公式の2連率は全艇 0 より大きい
  const breakdownWorld = makeBreakdownWorld(day, rid);
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
  Object.assign(ctx, { breakdownWorld, r1, r2 });
}

export async function section11(ctx) {
  const {
    V,
    askedAbout,
    breakdownWorld,
    check,
    clearCache,
    day,
    fake,
    getRaceMotorBreakdown,
    hasFilter,
    r1,
    r2,
    store,
  } = ctx;
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
  // 当日のレース: 2連率・3連率を機力指数の期間の値に差し替える。機力指数は「このレースの直前まで」
  const { tt, tables } = breakdownWorld();
  clearCache();
  Object.keys(store).forEach((k) => delete store[k]);
  fake.reset(tables);
  const today = await getRaceMotorBreakdown(tt, V, 90);
  Object.assign(ctx, { today, tt });
}

export async function section12(ctx) {
  const { V, check, clock, getRaceMotorBreakdown, near, today, tt } = ctx;
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
  Object.assign(ctx, { nextDay });
}
