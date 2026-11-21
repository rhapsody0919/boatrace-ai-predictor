/**
 * verify-motor-tab-readability.js の検査の続き（motor-tab-readability-sections2.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

async function section6_1(ctx) {
  const {
    M,
    V,
    check,
    day,
    getMotorPowerIndex,
    getRaceMotorBreakdown,
    near,
    rid,
    run,
    runDrillLoad,
    todayScene,
  } = ctx;
  {
    const { tt, tables } = todayScene(day, rid);
    const [got, before, all] = await run(tables, async () => {
      const loaded = await runDrillLoad({
        selectedVenue: V,
        selectedRace: tt,
        drillDownMotor: M,
      });
      return [
        loaded,
        await getMotorPowerIndex(V, M, 90, tt),
        await getMotorPowerIndex(V, M, 90, null),
      ];
    });
    check(
      `ドリルダウンは当日のレースも「このレースの直前まで」で集計する（ドリルダウンの取得 useDrillLoad を偽の DB で回した機力指数の走数 ${got.PowerIndex?.sample_count}・直前まで ${before?.sample_count}・全部 ${all?.sample_count}）`,
      got.PowerIndex?.sample_count === before?.sample_count &&
        before?.sample_count !== all?.sample_count,
    );
  }
  check(
    "一覧の機力指数も当日のレースは「このレースの直前まで」（同日の後のレース・このレース自身を入れず、公式の2連率・3連率を直前までの値に差し替える）",
    await (async () => {
      const { tt, tables } = todayScene(day, rid);
      const got = await run(tables, () => getRaceMotorBreakdown(tt, V, 90));
      const [row] = got.rows;
      return (
        got.rows.length === 1 &&
        row.rate_source === "recalc" &&
        row.sample_count === 2 &&
        near(row.power_index, 5) &&
        near(row.motor_2rate, 50) &&
        near(row.motor_3rate, 100) &&
        row.official_2rate === 41.2
      );
    })(),
  );
  // 展示タイムは速い（小さい）ほど上。枠番別成績の小さな線が逆（遅いほど上）で、
  // 下の推移グラフを「上ほど速い」にしたとき同じタブで向きが食い違った（PR #1193 ファン評価1周目）
}

async function section6_2(ctx) {
  const { check, exhibitionSparklineY, grid } = ctx;
  check(
    "展示タイムの小さな推移線は速いほど上（最小が上端 y=0、最大が下端 y=height）",
    exhibitionSparklineY(6.7, 6.7, 6.9, 24) === 0 &&
      exhibitionSparklineY(6.9, 6.7, 6.9, 24) === 24 &&
      exhibitionSparklineY(6.8, 6.8, 6.8, 24) === 0 &&
      // 描いた枠番別成績の線（6.7・6.9・6.8）: 最速の 6.7 が上端、最遅の 6.9 が下端
      grid.rows[1].sparkline === "0.0,0.0 40.0,24.0 80.0,12.0",
  );
}

async function section6_3(ctx) {
  const { check, drill, exhibitionTimeAxis, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const exhibitionTicks = (times) =>
    exhibitionTimeAxis(times).ticks.map((x) => x.toFixed(2));
  const ex = drill.charts[H("exhibitionTrendHeading")];
  check(
    "モータ情報の展示タイムの推移は縦軸を反転し（速いほど上）、渡した目盛りを全部出す（描いたグラフ）",
    ex?.yTicks.join("/") === exhibitionTicks([6.8, 6.9, 6.75]).join("/") &&
      ex.yTickYs.every((y, i) => i === 0 || y > ex.yTickYs[i - 1]),
  );
}

async function section6_4(ctx) {
  const { check, drill, exhibitionTimeAxis, racerCardView: card, tJa } = ctx;
  const exhibitionTicks = (times) =>
    exhibitionTimeAxis(times).ticks.map((x) => x.toFixed(2));
  const ex = drill.charts[tJa("analysis.motor.exhibitionTrendHeading")];
  // 展示タイムの縦軸の端は0.2秒の倍数（6.43 / 6.63 … や上端だけ7.10にしない）
  // 範囲だけ渡すと recharts が5本に等分し、幅0.6秒で 6.80/6.95/7.10… になった（ファン評価）
  const axisA = exhibitionTimeAxis([6.86, 7.31]);
  const axisB = exhibitionTimeAxis([6.53, 7.04, null]);
  check(
    "展示タイムの縦軸は端も目盛りも0.2秒刻み（幅0.6秒でも0.15刻みにしない）",
    JSON.stringify(axisA) ===
      JSON.stringify({ domain: [6.8, 7.4], ticks: [6.8, 7, 7.2, 7.4] }) &&
      JSON.stringify(axisB.ticks) === JSON.stringify([6.4, 6.6, 6.8, 7, 7.2]) &&
      exhibitionTimeAxis([null]) === null,
  );
  const linear = (c) =>
    c.curves.length > 0 && c.curves.every((d) => !/[CQ]/.test(d));
  check(
    "展示タイムのグラフ（モータ情報・選手ページ）が0.2秒刻みの範囲と目盛りを使い、直線でつなぐ（描いた2つのグラフ）",
    [
      [ex, [6.8, 6.9, 6.75]],
      [card.chart, [6.81, 6.9, 6.7]],
    ].every(
      ([c, times]) =>
        c &&
        c.yTicks.join("/") === exhibitionTicks(times).join("/") &&
        linear(c),
    ),
  );
}

export async function section6(ctx) {
  // ---- BOA-557（BOA-549 ファン評価の残り） ----
  // 当日のレースも「このレースの直前まで」。終了後に開くとそのレース自身の結果が入り、
  // 翌日（過去レース扱い）に開いたときと数字が変わっていた
  await section6_1(ctx);
  await section6_2(ctx);
  await section6_3(ctx);
  await section6_4(ctx);
}

async function section7_1(ctx) {
  const { check, drill, racerCardView: card, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const slanted = (c) =>
    c &&
    c.xTicks.length === c.xTickTransforms.length &&
    c.xTickTransforms.every((x) => x.startsWith("rotate(-35"));
  check(
    "選手ページの展示タイムも、375pxでラベルを間引かない（描いたカードの横軸: 3点とも斜めに出す）",
    card.chart?.xTicks.length === 3 && slanted(card.chart),
  );
  const noRace = await scenes.drillScene({ selectedRace: null });
  check(
    "「このレースの直前まで」の注記を当日のレースのドリルダウンにも出す（描いたドリルダウン。レースを選んでいなければ出さない）",
    drill.notes.includes(H("drillAsOfRaceNote")) &&
      !noRace.notes.includes(H("drillAsOfRaceNote")),
  );
}

async function section7_2(ctx) {
  const { check, racerCardView: card, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const slanted = (c) =>
    c &&
    c.xTicks.length === c.xTickTransforms.length &&
    c.xTickTransforms.every((x) => x.startsWith("rotate(-35"));
  // 8節（選手名は10字）。間引けば名前が欠け、曲線なら path に C が出る
  const names = Array.from(
    { length: 8 },
    (_, i) => `選手名の長い選手${i + 1}号`,
  );
  const many = await scenes.drillScene({
    usageHistory: names.map((name, i) => ({
      ...scenes.drillState().usageHistory[1],
      racerId: i + 1,
      playerName: name,
      rate2: 30 + (i % 3) * 20,
    })),
  });
  const usage = many.charts[H("usageHistoryHeading")];
  check(
    "使用履歴のグラフは選手名を間引かず、直線でつなぐ（描いた8節のグラフ）",
    usage?.xTicks.length === 8 &&
      slanted(usage) &&
      usage.curves.length === 2 &&
      usage.curves.every((d) => !/[CQ]/.test(d)),
  );
  const { single } = await ctx.racerCard();
  check(
    "選手ページの展示タイムの横軸は、レース番号を全部の点に付けるか全部付けない（描いたカード）",
    card.chart?.xTicks.every((x) => / \d+R$/.test(x)) &&
      single.chart?.xTicks.every((x) => !/R$/.test(x)),
  );
}

async function section7_3(ctx) {
  const { check, drill, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const oneMeet = await scenes.drillScene({
    usageHistory: [scenes.drillState().usageHistory[0]],
  });
  const chartNote = ` ${H("usageHistoryChartNote")}`;
  check(
    "使用履歴のグラフの向きの説明は、グラフが出ているときだけ（描いた使用履歴: 2節は出す、1節は出さない）",
    drill.notes.includes(`${H("usageHistoryNote")}${chartNote}`) &&
      oneMeet.charts[H("usageHistoryHeading")] === null &&
      oneMeet.notes.includes(H("usageHistoryNote")),
  );
}

async function section7_4(ctx) {
  const { check, drill, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  // 初出走（直前までの走りが0）の空表示は、取得失敗と区別できる文言にする
  const firstRun = await scenes.drillScene({
    powerIndex: { power_index: null, sample_count: 0 },
    usageHistory: [],
    trendData: { trend: [] },
  });
  const notFirst = await scenes.drillScene({
    usageHistory: [],
    trendData: { trend: [] },
  });
  check(
    "初出走のドリルダウンは「データが見つかりません」でなく理由を出す（3か所。描いたドリルダウン）",
    firstRun.empties.filter((e) => e === H("drillFirstRunEmpty")).length ===
      3 && !notFirst.empties.includes(H("drillFirstRunEmpty")),
  );
  // ダークモードでツールチップの見出しが白地に白字にならない
  check(
    "推移グラフのツールチップはテーマの色（背景・文字）を使う（描いたグラフの全部）",
    Object.values(drill.charts)
      .filter(Boolean)
      .every(
        (c) =>
          c.tooltip.includes("background: var(--surface-card)") &&
          c.tooltipLabel.includes("color: var(--text-primary)"),
      ),
  );
}

async function section7_5(ctx) {
  const { check, read } = ctx;
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 公式値の更新遅れの注記が、当サイトの集計を「最新のレースまで」と言わない`,
      !/最新のレースまで|latest race|至最新比賽|최신 레이스까지/.test(
        motor.officialSnapshotNote,
      ),
    );
    check(
      `${lang}: 使用履歴の注記からグラフの向きの文を分け、別キーにある`,
      typeof motor.usageHistoryChartNote === "string" &&
        !motor.usageHistoryNote.includes(motor.usageHistoryChartNote),
    );
  }
}

async function section7_6(ctx) {
  const { check, competitionRank } = ctx;
  // 丸亀 2026-09-28 のスナップショット: 11号機の2連率44.4は5基が同値、上に10基
  const values = [
    60, 58, 55, 52, 50, 49, 48, 47, 46, 45, 44.4, 44.4, 44.4, 44.4, 44.4, 40,
  ];
  check(
    "competitionRank: 同値5基・上に10基なら11位で5基タイ（行順に依存しない）",
    JSON.stringify(competitionRank(values, 44.4)) ===
      JSON.stringify({ rank: 11, tied: 5 }) &&
      JSON.stringify(competitionRank([...values].reverse(), 44.4)) ===
        JSON.stringify({ rank: 11, tied: 5 }),
  );
  check(
    "competitionRank: 同値の次は飛ばす（1, 2, 2, 4）",
    competitionRank([9, 8, 8, 7], 7).rank === 4 &&
      competitionRank([9, 8, 8, 7], 8).rank === 2,
  );
  check(
    "competitionRank: 小さいほど良い指標（事故率）は昇順",
    competitionRank([0.1, 0.2, 0.2, 0.5], 0.5, { ascending: true }).rank === 4,
  );
}

export async function section7(ctx) {
  await section7_1(ctx);
  await section7_2(ctx);
  await section7_3(ctx);
  await section7_4(ctx);
  await section7_5(ctx);
  await section7_6(ctx);
}

export async function section8(ctx) {
  const {
    V,
    check,
    day,
    getVenueMotorRanking,
    rankingTables,
    read,
    run,
    same,
    scenes,
    seed,
    tJa,
  } = ctx;
  {
    // 会場内順位は competitionRank で出す: 同じ値は同じ順位（1, 2, 2, 4）・値なしと出走数 0 は母数に入れない
    const tables = rankingTables(day);
    const own = await run(tables, async () => {
      // 同じ値の順位を付ける前（v1）の形・出走数 0 を外す前（v2）のキャッシュ。読むと順位がずれる
      seed(`venue-motor-ranking-v2-${V}-24-top2Rate`, { rank: 3, total: 5 });
      return getVenueMotorRanking(V, 24, "top2Rate");
    });
    const last = await getVenueMotorRanking(V, 29, "top2Rate");
    const none = await getVenueMotorRanking(V, 27, "top2Rate");
    check(
      "会場内順位は同値を同順位にし（50が2基なら両方2位・tied 2。並べた位置の順位ではない）、次は飛ばす（4位）。値なし・出走数 0 は順位を出さず母数に入れない",
      same(own, {
        rank: 2,
        tied: 2,
        total: 4,
        metric: "top2Rate",
        value: 50,
        scrapedDate: day(-10),
      }) &&
        last.rank === 4 &&
        last.tied === 1 &&
        none === null,
    );
    // 描いたドリルダウンの会場内順位の札（同順位・単独）と、公式の更新遅れの注記に添える切り捨ての注記
    const tied = await scenes.drillScene({
      venueMotorRanking: { ...own, value: 50 },
    });
    const alone = await scenes.drillScene({
      venueMotorRanking: { ...last, value: 41.24 },
    });
    const badge = (key, r, value) =>
      tJa(`analysis.motor.${key}`, { rank: r.rank, total: r.total, value });
    check(
      "会場内順位: 画面は同順位なら「◯位タイ」の文言、値・切り捨ての注記を出す（描いたドリルダウン）",
      tied.text.includes(badge("venueRankBadgeTied", own, "50.0")) &&
        alone.text.includes(badge("venueRankBadge", last, "41.2")) &&
        !alone.text.includes(badge("venueRankBadgeTied", last, "41.2")) &&
        tied.notes.includes(
          `${tJa("analysis.motor.officialSnapshotNote")} ${tJa("analysis.motor.venueRankRoundingNote")}`,
        ),
    );
  }
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 会場内順位の値が一覧と0.1違いうる理由（会場公式は切り捨て）の注記がある`,
      /0\.1/.test(motor.venueRankRoundingNote ?? ""),
    );
    check(
      `${lang}: 会場内順位の見出しに基準（2連率）が書いてある`,
      /2連率|top-2|2연대율/.test(motor.venueRankLabel),
    );
    check(
      `${lang}: 同順位の会場内順位の文言がある`,
      /\{\{rank\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        /\{\{total\}\}/.test(motor.venueRankBadgeTied ?? "") &&
        // 何の値の順位かを数字で示す（当日は一覧に2連率が2列ある。ファン評価2周目）
        [motor.venueRankBadge, motor.venueRankBadgeTied].every((s) =>
          s.includes("{{value}}"),
        ),
    );
  }
}
