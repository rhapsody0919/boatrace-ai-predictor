/**
 * verify-motor-window-generation.js の検査の続き（motor-window-generation-sections3.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

import { withMotorChartPure } from "./motorChartSource.js";

export async function section13(ctx) {
  const {
    M,
    V,
    breakdownWorld,
    check,
    clearCache,
    clock,
    day,
    fake,
    getVenueMotorStats,
    isPastRace,
    nextDay,
    rid,
    same,
  } = ctx;
  check(
    "一覧表: 日付が変わって過去レース扱いになったら、当日に保存した再計算の値を読まず、公式値（official）で出す",
    nextDay.rows.every(
      (r) => r.rate_source === "official" && r.power_index === null,
    ) &&
      nextDay.rows[0].motor_2rate === 41.2 &&
      nextDay.rows[0].motor_3rate === 61.5,
  );
  clock.offsetMs = 0;
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

export async function section14(ctx) {
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

export async function section15(ctx) {
  const {
    V,
    askedAbout,
    check,
    clearCache,
    clock,
    day,
    fake,
    getRacesForVenueSince,
    hasFilter,
    race,
    rid,
    same,
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
}

export async function section16(ctx) {
  const {
    G,
    M,
    V,
    check,
    clearCache,
    ent,
    fake,
    motor3,
    read,
    resultOf,
    rid,
    same,
    slice0,
    startRows,
  } = ctx;
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
  check(
    "一覧表（過去）: motor_2rate / motor_3rate を差し替えない（行の組み立て側）",
    !/motor_2rate:/.test(pastRowsFn) &&
      !/motor_3rate:/.test(pastRowsFn) &&
      !pastRowsFn.includes("actual_rate"),
  );
  // 5. 画面
  const chart = withMotorChartPure(
    read("src/components/analysis/MotorConditionChart.jsx"),
  );
  check(
    "画面: 過去レース（rate_source: official）では期間の切り替えを出さず注記に置き換える",
    chart.includes('breakdown.some((r) => r.rate_source === "official")') &&
      /drillDownMotor === null\s*\?\s*!officialMode/.test(chart) &&
      chart.includes("analysis.motor.periodOfficialNote"),
  );
  check(
    "画面: 過去レースでは「公式2連率（節時点）」の列を畳む（見出しとセルの両方）",
    (chart.match(/\{!officialMode && \(/g) ?? []).length >= 2,
  );
  check(
    "画面: 入れ替え前のモーターはドリルダウンの中身を出さない",
    chart.includes("raceDate < generationStart") &&
      chart.includes("setDrillPreGeneration(true)") &&
      chart.includes("analysis.motor.drillPreGeneration"),
  );
  check(
    "画面: 期間を使用開始日で切り詰めたら注記を出す",
    chart.includes("analysis.motor.periodClippedNote"),
  );
  check(
    "画面: 切り詰めたときは機力指数の要約に「過去90日」と書かない",
    chart.includes("period: powerIndex.clipped_by_generation") &&
      chart.includes("analysis.motor.periodSinceGeneration"),
  );
  Object.assign(ctx, { chart });
}
