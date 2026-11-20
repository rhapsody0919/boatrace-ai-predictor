/**
 * verify-motor-tab-readability.js の検査の続き（motor-tab-readability-sections1.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section1(ctx) {
  const { check, formatRateOrCount, scenes, tJa } = ctx;
  const grid = await scenes.wakuGridScene();
  const drill = await scenes.drillScene();
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
  check(
    "使用履歴の2連率ラベルも (%) の付かない名前を使う（「2連率 (%) 66.7%」と二重にしない。描いた使用履歴）",
    drill.usageRates.join("|") === `${H("legend2")} 66.7%|${H("legend2")} 50.0%`,
  );
  {
    // 当日の一覧は会場公式の列が無い。過去レースの一覧は 1着率の列だけ（優出・優勝の値が無い）
    const today = await scenes.motorListScene();
    const past = await scenes.pastListScene();
    const quoted = (key) => tJa("analysis.motor.quotedLabel", { label: H(key) });
    check(
      "過去レースの出典注記は、表に出ている会場公式の列だけを挙げる（1着率の列が無ければ触れない。描いた一覧）",
      past.text.includes(tJa("analysis.motor.venueColsPastNote", { venueCols: quoted("firstPlaceRateHeader") })) &&
        !past.text.includes(quoted("finalCountHeader")) &&
        !today.text.includes(quoted("firstPlaceRateHeader")),
    );
  }
  check(
    "2連率・3連率の推移グラフに見出しを付ける（描いたドリルダウン）",
    drill.headings.includes(H("rateTrendHeading")) &&
      drill.charts[H("rateTrendHeading")] !== null,
  );
  check(
    "使用履歴のグラフは左が古く右が新しい（推移グラフと同じ向き。描いたグラフの横軸）",
    drill.charts[H("usageHistoryHeading")]?.xTicks.join("/") === "旧一/新二",
  );
  check(
    "公式サイトのスナップショット（鮮度・順位・1着率・優出・優勝）の更新が遅れる旨を注記する（描いたドリルダウン）",
    drill.notes.some((n) => n.startsWith(H("officialSnapshotNote"))),
  );
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
      card.caption === `今節（${d1}〜${d2}）、この選手がこのモーターで出走してからの展示タイム`,
    );
    Object.assign(ctx, { racerCardView: small });
  }
  // ---- BOA-513 PR2: ファン4人のパネルで決めた表示（2026-09-29 ユーザー承認） ----
  check(
    "formatRateOrCount: n<6 は「該当数/出走数」、6以上は %、出走なしは「-」",
    formatRateOrCount(66.66666, 3, 6) === "2/3" &&
      formatRateOrCount(100, 1, 6) === "1/1" &&
      formatRateOrCount(0, 5, 6) === "0/5" &&
      formatRateOrCount(50, 6, 6) === "50.0%" &&
      formatRateOrCount(null, 0, 6) === "-",
  );
  const racers = await scenes.racerWakuScene();
  check(
    "枠番別成績・選手×枠成績の率を formatRateOrCount で出す（n<6 の率を % で出さない。描いた表と一覧）",
    grid.rows[0].rates.join("/") === "2/3/2/3/3/3" &&
      grid.rows[1].rates.join("/") === "50.0%/50.0%/75.0%" &&
      racers[0].rates.join("|") === `${H("firstPlaceRateHeader")} 1/3|${H("legend2")} 2/3|${H("legend3")} 3/3` &&
      racers[1].rates.join("|") === `${H("firstPlaceRateHeader")} 25.0%|${H("legend2")} 50.0%|${H("legend3")} 75.0%`,
  );
  check(
    "展示タイムのスパークラインは3点未満なら出さない（描いた表: 2点の行は無し、3点の行は有り）",
    grid.rows[0].sparkline === null && grid.rows[1].sparkline !== null,
  );
  Object.assign(ctx, { grid, drill, racers });
}

export async function section2(ctx) {
  const {
    M,
    V,
    check,
    day,
    drill,
    fetchMotorDailySeries,
    getMotorPartsHistory,
    officialTallyState,
    partsScene,
    recalcMotorRows,
    rid,
    run,
    same,
    scenes,
    seed,
    tJa,
  } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  {
    // 当日の一覧: 優出・優勝の値がどの艇にも無い → 列も注記も無い。1艇に値がある → 列と注記に出す
    const none = await scenes.motorListScene();
    const some = await scenes.motorListScene({ 2: { final_count: 3, championship_count: 1 } });
    const quoted = (key) => tJa("analysis.motor.quotedLabel", { label: H(key) });
    const cols = (list) => [H("finalCountHeader"), H("championshipCountHeader")].map((h) => list.heads.includes(h));
    check(
      "優出数・優勝数は、会場の全モーターで値が無いとき列ごと畳む（見出し・セル・出典注記。描いた一覧）",
      same(cols(none), [false, false]) &&
        same(cols(some), [true, true]) &&
        some.text.includes(quoted("finalCountHeader")) &&
        some.text.includes(quoted("championshipCountHeader")) &&
        // 列が1つも無い会場（戸田など）では、列名の文ごと出さない（文が崩れない）
        !none.notes.some((n) => n.includes(tJa("analysis.motor.venueColsTodayNote", { venueCols: "" }).trim())),
    );
    check(
      "結果の出た走が無い新モーター（sample_count === 0）に「初下ろし」を添える（描いた一覧と、行の組み立て recalcMotorRows）",
      none.rate2[0] === `0.0${H("firstUseBadge")}` &&
        !none.rate2[1].includes(H("firstUseBadge")) &&
        same(
          recalcMotorRows([{ racer_id: 1 }, { racer_id: 2 }], [{ sample_count: 0 }, { sample_count: 5 }], [], new Map()).map((r) => r.sample_count),
          [0, 5],
        ),
    );
    Object.assign(ctx, { list: none });
  }
  check(
    "推移グラフは、入れ替え直後の 2連率・3連率とも 0 の先頭の点を描かない（描いた推移の横軸は 0 でない日から）",
    drill.charts[H("rateTrendHeading")]?.xTicks.join("/") === "10-05/10-09" &&
      drill.charts[H("exhibitionTrendHeading")]?.xTicks.join("/") === "10-01/10-05/10-09",
  );
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
    const unknown = await scenes.allZeroTrendScene({ raceCount: 0, venueHasStats: false });
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

export async function section3(ctx) {
  const { check, drill, powerIndexTone, racers, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  const noLeadingZero = await scenes.drillScene({
    trendData: { trend: [{ date: "2026-10-01", motor_2rate: 30, motor_3rate: 50, exhibition_time: 6.8 }, { date: "2026-10-05", motor_2rate: 35, motor_3rate: 55, exhibition_time: 6.9 }] },
  });
  check(
    "推移グラフ: 先頭の 0 を落としたときは、展示タイムと始まりがずれる理由を書く（描いたドリルダウン。落とさないときは書かない）",
    drill.notes.includes(H("trendStartNote")) && !noLeadingZero.notes.includes(H("trendStartNote")),
  );
  check(
    "使用履歴: 今日これから走るレースは「未」と出し、欠場等の「-」と区別する（描いた使用履歴）",
    drill.usageRanks[0] === [tJa("analysis.motor.usageHistoryRank", { n: 1 }), "-", H("usageHistoryNotRun")].join(" "),
  );
  check(
    "選手×枠成績: n<6 では (n=◯) を付けない（分数に走数が入る。描いた一覧）",
    racers[0].n === null && racers[1].n === tJa("analysis.motor.sampleCount", { n: 12 }),
  );
  // 公式の 0.0 の「集計前」の印は、BOA-830（公式が 0 の艇は自前の値）に置き換えた。
  // 新しい決まりは verify-motor-fresh-rate.js が守る
  {
    // 過去レースで公式 0/0 の艇がある一覧に、「集計前」の印・注記（訳があれば訳、無ければキー）が出ない
    const past = await scenes.pastListScene();
    const marks = ["officialPendingBadge", "officialPendingNote"].flatMap((k) => [`analysis.motor.${k}`, H(k)]);
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

export async function section4(ctx) {
  const {
    M,
    V,
    check,
    day,
    drill,
    formatPowerIndex,
    getMotorUsageHistory,
    list,
    near,
    racerCardView: card,
    rid,
    run,
    same,
    scenes,
    seed,
    tJa,
    usageTables,
  } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  // 一覧の2号艇は4走で +9.5、ドリルダウンと選手ページは4走で -0.04（どれも6走未満）
  check(
    "機力指数: 一覧・ドリルダウン・選手ページの3か所で powerIndexTone を使い、小標本では評価の言葉を出さない（描いた3か所）",
    list.power[1].cls.split(" ").includes("is-small-sample") &&
      drill.summaryClass.split(" ").includes("is-small-sample") &&
      drill.summary.endsWith(H("powerIndexSmallSample")) &&
      ![H("powerIndexGood"), H("powerIndexBad")].some((w) => drill.summary.includes(w)) &&
      card.indexClass.split(" ").includes("is-small-sample"),
  );
  check(
    "グラフ: 縦軸のラベルを縦方向の中央に置き（375px で切れない）、展示タイムの目盛りは小数2桁にそろえる（描いたグラフ）",
    Object.values(drill.charts).filter(Boolean).every((c) => c.yLabelAnchor === "middle") &&
      drill.charts[H("exhibitionTrendHeading")]?.yTicks.every((x) => /^\d+\.\d{2}$/.test(x)),
  );
  {
    // 使用履歴の節ごとの2連率も、着順の付かなかった走を分母に数える（機力指数・枠番別と
    // そろえる。BOA-549、戸田14号機で 4/6 と 22/38 が食い違っていた）
    const tables = usageTables(day, rid);
    const usage = await run(tables, async () => {
      // 着順の付かない走を分母に数えなかった頃（v3）のキャッシュ。読むと節の走数が1になる
      seed(`motor-usage-history-v3-${V}-${M}`, [
        { racerId: 11, sampleCount: 1 },
      ]);
      return getMotorUsageHistory(V, M);
    });
    const [meet] = usage;
    check(
      "使用履歴: 着順の付かなかった走も、結果の出たレースなら分母に数える（不成立・結果なしは数えない。旧版のキャッシュを読まない）",
      usage.length === 1 &&
        same(
          meet.races.map((r) => r.rank),
          [1, null, null, null, 1],
        ) &&
        meet.sampleCount === 3 &&
        near(meet.rate2, 200 / 3) &&
        near(meet.rate3, 200 / 3),
    );
  }
  check(
    "formatPowerIndex: 丸めて0になる負の値を「-0.0」と出さない（丸亀45号機 -0.04 → 0.0）",
    formatPowerIndex(-0.04) === "0.0" &&
      formatPowerIndex(12.14) === "+12.1" &&
      formatPowerIndex(-4.1) === "-4.1" &&
      formatPowerIndex(0) === "0.0" &&
      // 画面（一覧・ドリルダウン・選手ページ）の -0.04 も 0.0（"-0.0"・"+0.0" にしない）
      list.power[2].text === "0.0" &&
      drill.summary.includes(tJa("analysis.motor.powerIndexSummary", { index: "0.0", count: 4, period: H("period90") })) &&
      card.index.startsWith("機力指数 0.0（"),
  );
  {
    const plain = await scenes.motorListScene({ 2: { sample_count: 13 } });
    const note = tJa("analysis.motor.powerIndexSmallSampleNote", { n: 6 });
    check(
      "一覧: オレンジ色の機力指数がある行があるときは、表の下の注記で意味（6走未満の参考値）を書く（描いた一覧。無い一覧には書かない）",
      list.notes.some((n) => n.includes(note)) && !plain.notes.some((n) => n.includes(note)),
    );
  }
  {
    // 全部の点が 0・会場公式の出走数 0。取得に失敗していれば断定せず、取れていれば集計前
    const failed = await scenes.allZeroTrendScene({ raceCount: 0, fetchFailed: true });
    check(
      "1基の詳細: 会場公式の成績が取れなかったとき（fetchFailed）は、推移グラフを「集計前」と判定しない（BOA-740。描いた推移の節）",
      failed.text === H("trendOfficialZeroUnknown"),
    );
  }
  check(
    "選手ページ: 参考値の文言をレースページと同じ「— 走数が少ないため参考値」にそろえる（描いたカード）",
    card.index.endsWith(" — 走数が少ないため参考値"),
  );
}

export async function section5(ctx) {
  const { check, read } = ctx;
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    // 「入れ替え後の最初の節」ではなくモーター単位で言う。丸亀は入れ替え後の最初の節が
    // 終わった後も、その後に初めて使われたモーターが集計前になる（ファン評価2周目 P2）
    check(
      `${lang}: 集計前の説明を「入れ替え後の最初の節」でなく、モーターが初めて使われた節で言う`,
      !/入れ替え後の最初の節|first meet since the changeover|更換後第一節|교체 후 첫 절/.test(
        motor.trendNotYetOfficial + motor.trendOfficialZeroUnknown,
      ),
    );
    check(
      `${lang}: 縦軸の名前が「出現率」でない（2連率・3連率を指す）`,
      !/出現率|Occurrence|出現率|출현율/.test(motor.yAxis),
    );
  }
}

// 出典注記の文言のうち、{{venueCols}} などの差し込みの口と見出しの有無（前半）
const sourceNoteSlots = (motor) =>
  !motor.officialModeSourceNote.includes("{{venueCols}}") &&
  motor.venueColsPastNote?.includes("{{venueCols}}") &&
  motor.venueColsTodayNote?.includes("{{venueCols}}") &&
  typeof motor.rateTrendHeading === "string" &&
  motor.quotedLabel?.includes("{{label}}");

// 出典注記の文言のうち、区切り・更新遅れの注記・使用履歴・展示タイムの見出し（後半）
const sourceNoteTexts = (motor) =>
  typeof motor.quotedLabelSeparator === "string" &&
  typeof motor.officialSnapshotNote === "string" &&
  /90/.test(motor.usageHistoryNote) &&
  // 使用履歴の「-」（着順の付かない走）と「未」の意味・数え方を書く（BOA-549）
  /「-」|"-"/.test(motor.usageHistoryNote) &&
  // 枠番別成績の展示タイムの列が、平均の値と推移の図だと分かる見出し（BOA-549）
  /平均|avg|平均|평균/i.test(motor.exhibitionTrendHeader);

export async function section5b(ctx) {
  const { check, read } = ctx;
  for (const lang of ["ja", "en", "zh-TW", "ko"]) {
    const motor = JSON.parse(read(`src/locales/${lang}/common.json`)).analysis
      .motor;
    check(
      `${lang}: 出典注記が {{venueCols}} を受け取り、見出し・区切り・更新遅れの注記・使用履歴の期間がある`,
      sourceNoteSlots(motor) && sourceNoteTexts(motor),
    );
  }
}
