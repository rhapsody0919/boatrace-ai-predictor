/**
 * verify-motor-tab-readability.js の検査の続き（motor-tab-readability-sections1.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

async function section1_1(ctx) {
  const { check, grid, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "枠番別成績の表に、横スクロールの目印（hscroll-hint・›）を付ける（描いた表の枠）",
    grid.hint,
  );
  check(
    "枠番別成績の見出しは、セルに%が付くので (%) の付かない名前（legend2/legend3）を使う（描いた表の見出し）",
    grid.heads[2] === H("legend2") &&
      grid.heads[3] === H("legend3") &&
      !grid.heads.includes(H("rate2Header")),
  );
}

async function section1_2(ctx) {
  const { check, drill, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "使用履歴の2連率ラベルも (%) の付かない名前を使う（「2連率 (%) 66.7%」と二重にしない。描いた使用履歴）",
    drill.usageRates.join("|") ===
      `${H("legend2")} 66.7%|${H("legend2")} 50.0%`,
  );
  {
    // 当日の一覧は会場公式の列が無い。過去レースの一覧は 1着率の列だけ（優出・優勝の値が無い）
    const today = await scenes.motorListScene();
    const past = await scenes.pastListScene();
    const quoted = (key) =>
      tJa("analysis.motor.quotedLabel", { label: H(key) });
    check(
      "過去レースの出典注記は、表に出ている会場公式の列だけを挙げる（1着率の列が無ければ触れない。描いた一覧）",
      past.text.includes(
        tJa("analysis.motor.venueColsPastNote", {
          venueCols: quoted("firstPlaceRateHeader"),
        }),
      ) &&
        !past.text.includes(quoted("finalCountHeader")) &&
        !today.text.includes(quoted("firstPlaceRateHeader")),
    );
  }
  check(
    "2連率・3連率の推移グラフに見出しを付ける（描いたドリルダウン）",
    drill.headings.includes(H("rateTrendHeading")) &&
      drill.charts[H("rateTrendHeading")] !== null,
  );
}

async function section1_3(ctx) {
  const { check, drill, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "使用履歴のグラフは左が古く右が新しい（推移グラフと同じ向き。描いたグラフの横軸）",
    drill.charts[H("usageHistoryHeading")]?.xTicks.join("/") === "旧一/新二",
  );
  check(
    "公式サイトのスナップショット（鮮度・順位・1着率・優出・優勝）の更新が遅れる旨を注記する（描いたドリルダウン）",
    drill.notes.some((n) => n.startsWith(H("officialSnapshotNote"))),
  );
}

async function section1_4(ctx) {
  const { check } = ctx;
  {
    // 選手ページ: 偽の DB の上で getRacerCurrentMotorStatus を回し、その戻りでカードを描く
    const { status, card, single, small } = await ctx.racerCard();
    const [d1, d2] = [ctx.day(-2).slice(5), ctx.day(-1).slice(5)];
    check(
      "選手ページ: 同じ日に2回走った日は、横軸にレース番号を添える（全部の点に付ける。1日1走なら付けない。偽の DB の今節のモーターで描いたカード）",
      status?.meetTrend.map((r) => r.raceNo).join(",") === "2,9,4" &&
        card.chart?.xTicks.join("/") === `${d1} 2R/${d1} 9R/${d2} 4R` &&
        single.chart?.xTicks.join("/") === `${d1}/${d2}`,
    );
    check(
      "選手ページ: 説明文の「）」と「、」の間に空白を入れない（描いたカードの説明文）",
      card.caption ===
        `今節（${d1}〜${d2}）、この選手がこのモーターで出走してからの展示タイム`,
    );
    Object.assign(ctx, { racerCardView: small });
  }
  // ---- BOA-513 PR2: ファン4人のパネルで決めた表示（2026-09-29 ユーザー承認） ----
}

async function section1_5(ctx) {
  const { check, formatRateOrCount, grid, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "formatRateOrCount: n<6 は「該当数/出走数」、6以上は %、出走なしは「-」",
    formatRateOrCount(66.66666, 3, 6) === "2/3" &&
      formatRateOrCount(100, 1, 6) === "1/1" &&
      formatRateOrCount(0, 5, 6) === "0/5" &&
      formatRateOrCount(50, 6, 6) === "50.0%" &&
      formatRateOrCount(null, 0, 6) === "-",
  );
  const racers = await scenes.racerWakuScene();
  Object.assign(ctx, { racers });
  check(
    "枠番別成績・選手×枠成績の率を formatRateOrCount で出す（n<6 の率を % で出さない。描いた表と一覧）",
    grid.rows[0].rates.join("/") === "2/3/2/3/3/3" &&
      grid.rows[1].rates.join("/") === "50.0%/50.0%/75.0%" &&
      racers[0].rates.join("|") ===
        `${H("firstPlaceRateHeader")} 1/3|${H("legend2")} 2/3|${H("legend3")} 3/3` &&
      racers[1].rates.join("|") ===
        `${H("firstPlaceRateHeader")} 25.0%|${H("legend2")} 50.0%|${H("legend3")} 75.0%`,
  );
  check(
    "展示タイムのスパークラインは3点未満なら出さない（描いた表: 2点の行は無し、3点の行は有り）",
    grid.rows[0].sparkline === null && grid.rows[1].sparkline !== null,
  );
}

export async function section1(ctx) {
  Object.assign(ctx, {
    grid: await ctx.scenes.wakuGridScene(),
    drill: await ctx.scenes.drillScene(),
  });
  await section1_1(ctx);
  await section1_2(ctx);
  await section1_3(ctx);
  await section1_4(ctx);
  await section1_5(ctx);
}

async function section2_1(ctx) {
  const { check, recalcMotorRows, same, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  {
    // 当日の一覧: 優出・優勝の値がどの艇にも無い → 列も注記も無い。1艇に値がある → 列と注記に出す
    const none = await scenes.motorListScene();
    const some = await scenes.motorListScene({
      2: { final_count: 3, championship_count: 1 },
    });
    const quoted = (key) =>
      tJa("analysis.motor.quotedLabel", { label: H(key) });
    const cols = (list) =>
      [H("finalCountHeader"), H("championshipCountHeader")].map((h) =>
        list.heads.includes(h),
      );
    check(
      "優出数・優勝数は、会場の全モーターで値が無いとき列ごと畳む（見出し・セル・出典注記。描いた一覧）",
      same(cols(none), [false, false]) &&
        same(cols(some), [true, true]) &&
        some.text.includes(quoted("finalCountHeader")) &&
        some.text.includes(quoted("championshipCountHeader")) &&
        // 列が1つも無い会場（戸田など）では、列名の文ごと出さない（文が崩れない）
        !none.notes.some((n) =>
          n.includes(
            tJa("analysis.motor.venueColsTodayNote", { venueCols: "" }).trim(),
          ),
        ),
    );
    check(
      "結果の出た走が無い新モーター（sample_count === 0）に「初下ろし」を添える（描いた一覧と、行の組み立て recalcMotorRows）",
      none.rate2[0] === `0.0${H("firstUseBadge")}` &&
        !none.rate2[1].includes(H("firstUseBadge")) &&
        same(
          recalcMotorRows(
            [{ racer_id: 1 }, { racer_id: 2 }],
            [{ sample_count: 0 }, { sample_count: 5 }],
            [],
            new Map(),
          ).map((r) => r.sample_count),
          [0, 5],
        ),
    );
    Object.assign(ctx, { list: none });
  }
}

async function section2_2(ctx) {
  const { check, drill, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "推移グラフは、入れ替え直後の 2連率・3連率とも 0 の先頭の点を描かない（描いた推移の横軸は 0 でない日から）",
    drill.charts[H("rateTrendHeading")]?.xTicks.join("/") === "10-05/10-09" &&
      drill.charts[H("exhibitionTrendHeading")]?.xTicks.join("/") ===
        "10-01/10-05/10-09",
  );
}

async function section2_3(ctx) {
  const {
    M,
    V,
    check,
    day,
    drill,
    fetchMotorDailySeries,
    getMotorPartsHistory,
    partsScene,
    rid,
    run,
    same,
    seed,
    tJa,
  } = ctx;
  {
    // 偽の DB: 使用開始日は40日前。a2 に部品交換、c にプロペラ交換が記録される（同じ日の2レースは a・a2）
    const { G, tables } = partsScene(day, rid);
    const { series } = await run(tables(), async () => {
      // 交換のレース番号が無かった頃（v2）のキャッシュ。読むとレース番号が出ない
      seed(`motor-daily-series-v2-${V}-${M}-90`, {
        window: null,
        series: [{ date: G, eventRaceNos: undefined }],
      });
      return fetchMotorDailySeries(V, M, 90);
    });
    const parts = await run(tables(), async () => {
      seed(`motor-parts-history-v2-${V}-${M}-90`, {
        events: [{ date: day(-20) }],
      });
      return getMotorPartsHistory(V, M, 90);
    });
    check(
      "部品交換に、交換が記録されたレース番号を添える（日次系列の eventRaceNos・部品交換の raceNos。同じ日は1日に畳み、交換の無い日は空。旧版のキャッシュを読まない）",
      series.length === 4 &&
        same(
          series.map((d) => d.eventRaceNos),
          [[], [5], [], [1]],
        ) &&
        parts.events.length === 2 &&
        same(
          parts.events.map((e) => [e.date, e.raceNos]),
          [
            [day(-20), [5]],
            [day(-3), [1]],
          ],
        ),
    );
    check(
      "部品交換: チャートが raceNos を「◯R」に整形する（描いた部品交換の履歴）",
      drill.parts.includes(`2026-10-05 5R${tJa("listSeparator")}11R`),
    );
  }
  // ---- BOA-513 PR2 ファン評価1周目（2026-09-29） ----
}

async function section2_4(ctx) {
  const { check, officialTallyState, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  // 公式 0/0 が「集計前」か「集計済みの 0%」かは、会場公式の出走数で分ける
  // （丸亀24号機は 9/21 に2走とも6着＝集計済みの 0%。2026-09-29 ファン評価 P1）
  check(
    "officialTallyState: 会場公式の出走数が1以上なら集計済み、値のある会場で0/無しなら集計前、値の無い会場は不明",
    officialTallyState(true, 2) === "tallied" &&
      officialTallyState(false, 2) === "tallied" &&
      officialTallyState(true, 0) === "pending" &&
      officialTallyState(true, null) === "pending" &&
      officialTallyState(false, null) === "unknown",
  );
  {
    const tallied = await scenes.allZeroTrendScene({ raceCount: 2 });
    const pending = await scenes.allZeroTrendScene({ raceCount: 0 });
    const unknown = await scenes.allZeroTrendScene({
      raceCount: 0,
      venueHasStats: false,
    });
    check(
      "推移グラフ: 全部の点が 0 のとき、集計前なら線を引かず、集計済みなら 0 の線を引き、不明なら断定しない（描いた推移の節）",
      tallied.chart?.xTicks.length === 2 &&
        pending.chart === null &&
        pending.text === H("trendNotYetOfficial") &&
        unknown.chart === null &&
        unknown.text === H("trendOfficialZeroUnknown"),
    );
  }
}

export async function section2(ctx) {
  await section2_1(ctx);
  await section2_2(ctx);
  await section2_3(ctx);
  await section2_4(ctx);
}

export async function section3(ctx) {
  const { check, drill, powerIndexTone, racers, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const noLeadingZero = await scenes.drillScene({
    trendData: {
      trend: [
        {
          date: "2026-10-01",
          motor_2rate: 30,
          motor_3rate: 50,
          exhibition_time: 6.8,
        },
        {
          date: "2026-10-05",
          motor_2rate: 35,
          motor_3rate: 55,
          exhibition_time: 6.9,
        },
      ],
    },
  });
  check(
    "推移グラフ: 先頭の 0 を落としたときは、展示タイムと始まりがずれる理由を書く（描いたドリルダウン。落とさないときは書かない）",
    drill.notes.includes(H("trendStartNote")) &&
      !noLeadingZero.notes.includes(H("trendStartNote")),
  );
  check(
    "使用履歴: 今日これから走るレースは「未」と出し、欠場等の「-」と区別する（描いた使用履歴）",
    drill.usageRanks[0] ===
      [
        tJa("analysis.motor.usageHistoryRank", { n: 1 }),
        "-",
        H("usageHistoryNotRun"),
      ].join(" "),
  );
  check(
    "選手×枠成績: n<6 では (n=◯) を付けない（分数に走数が入る。描いた一覧）",
    racers[0].n === null &&
      racers[1].n === tJa("analysis.motor.sampleCount", { n: 12 }),
  );
  // 公式の 0.0 の「集計前」の印は、BOA-830（公式が 0 の艇は自前の値）に置き換えた。
  // 新しい決まりは verify-motor-fresh-rate.js が守る
  {
    // 過去レースで公式 0/0 の艇がある一覧に、「集計前」の印・注記（訳があれば訳、無ければキー）が出ない
    const past = await scenes.pastListScene();
    const marks = ["officialPendingBadge", "officialPendingNote"].flatMap(
      (k) => [`analysis.motor.${k}`, H(k)],
    );
    check(
      "一覧: 「集計前」の印と注記を出さない（BOA-830 で、公式が 0 の艇は自前の値に置き換えた。描いた過去レースの一覧）",
      marks.every((mark) => !past.text.includes(mark)),
    );
  }
  // ---- BOA-549: 走数が少ない機力指数（2026-09-29 ファン4人のパネル） ----
  check(
    "powerIndexTone: n<6 は評価せず small、6以上は符号で good/bad/even、値なしは null",
    powerIndexTone(-3.1, 4, 6) === "small" &&
      powerIndexTone(9.5, 5, 6) === "small" &&
      powerIndexTone(9.5, 6, 6) === "good" &&
      powerIndexTone(-0.9, 20, 6) === "bad" &&
      powerIndexTone(0, 20, 6) === "even" &&
      // 丸めて 0.0 になる値は良い・悪いと言わない（丸亀45号機 -0.04 が「低調」と出ていた）
      powerIndexTone(-0.04, 13, 6) === "even" &&
      powerIndexTone(0.04, 13, 6) === "even" &&
      powerIndexTone(0.05, 13, 6) === "good" &&
      powerIndexTone(null, 4, 6) === null,
  );
}
