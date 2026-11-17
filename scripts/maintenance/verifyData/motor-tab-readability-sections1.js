/**
 * verify-motor-tab-readability.js の検査の続き（motor-tab-readability-sections1.js）。大きさの関所のため、同じ検査を場面ごとの関数に分けた。verify ではない。
 * 共通の道具・場面は ctx で受け取り、前の場面で作った物は ctx に足されて次へ渡る。
 */

export async function section1(ctx) {
  const { card, chart, check, formatRateOrCount, grid, racerMotor, read } = ctx;
  check(
    "枠番別成績の表に、横スクロールの目印（hscroll-hint・›）を付ける",
    grid.includes("useHorizontalScrollHint(") &&
      grid.includes("hscroll-hint") &&
      grid.includes('className="table-scroll"'),
  );
  check(
    "枠番別成績の見出しは、セルに%が付くので (%) の付かない名前（legend2/legend3）を使う",
    grid.includes('t("analysis.motor.legend2")') &&
      grid.includes('t("analysis.motor.legend3")') &&
      !grid.includes('t("analysis.motor.rate2Header")'),
  );
  check(
    "使用履歴の2連率ラベルも (%) の付かない名前を使う（「2連率 (%) 66.7%」と二重にしない）",
    !/\{t\("analysis\.motor\.rate2Header"\)\} \{meet\.rate2/.test(chart),
  );
  check(
    "過去レースの出典注記は、表に出ている会場公式の列だけを挙げる（1着率の列が無ければ触れない）",
    /venueColsLabel = \[\s*showFirstPlaceRate && "analysis\.motor\.firstPlaceRateHeader"/.test(
      chart,
    ),
  );
  check(
    "2連率・3連率の推移グラフに見出しを付ける",
    chart.includes('t("analysis.motor.rateTrendHeading")'),
  );
  check(
    "使用履歴のグラフは左が古く右が新しい（推移グラフと同じ向き）",
    /usageHistoryChartData = \[\.\.\.usageHistory\]\s*\.reverse\(\)/.test(
      chart,
    ),
  );
  check(
    "公式サイトのスナップショット（鮮度・順位・1着率・優出・優勝）の更新が遅れる旨を注記する",
    chart.includes('t("analysis.motor.officialSnapshotNote")'),
  );
  check(
    "選手ページ: 同じ日に2回走った日は、横軸にレース番号を添える",
    racerMotor.includes("raceNo: Number(e.race_id.slice(-2))") &&
      // 2回走った日が1日でもあれば全部の点に付ける（BOA-557。付く点と付かない点が混ざらない）
      card.includes("runsOnDate.values()].some((n) => n > 1)"),
  );
  check(
    "選手ページ: 説明文の「）」と「、」の間に空白を入れない（1つのテンプレート文字列で組む）",
    /\}）、この選手がこのモーターで出走してからの展示タイム`/.test(card),
  );
  // ---- BOA-513 PR2: ファン4人のパネルで決めた表示（2026-09-29 ユーザー承認） ----
  check(
    "formatRateOrCount: n<6 は「該当数/出走数」、6以上は %、出走なしは「-」",
    formatRateOrCount(66.66666, 3, 6) === "2/3" &&
      formatRateOrCount(100, 1, 6) === "1/1" &&
      formatRateOrCount(0, 5, 6) === "0/5" &&
      formatRateOrCount(50, 6, 6) === "50.0%" &&
      formatRateOrCount(null, 0, 6) === "-",
  );
  check(
    "枠番別成績・選手×枠成績の率を formatRateOrCount で出す（n<6 の率を % で出さない）",
    (grid.match(/formatRateOrCount\(/g) ?? []).length >= 3 &&
      (
        read("src/components/analysis/MotorRacerWakuDrillDown.jsx").match(
          /formatRateOrCount\(/g,
        ) ?? []
      ).length >= 3,
  );
  check(
    "展示タイムのスパークラインは3点未満なら出さない",
    grid.includes("trend.length < 3) return null"),
  );
}

export async function section2(ctx) {
  const {
    M,
    V,
    chart,
    check,
    day,
    fetchMotorDailySeries,
    getMotorPartsHistory,
    officialTallyState,
    partsScene,
    read,
    rid,
    run,
    same,
    seed,
  } = ctx;
  check(
    "優出数・優勝数は、会場の全モーターで値が無いとき列ごと畳む（見出し・セル・出典注記）",
    chart.includes("showFinalCount && (") &&
      chart.includes("showChampionshipCount && (") &&
      chart.includes('showFinalCount && "analysis.motor.finalCountHeader"') &&
      // 列が1つも無い会場（戸田など）では、列名の文ごと出さない（文が崩れない）
      /\{venueColsLabel &&\s*`\$\{t\(/.test(chart),
  );
  check(
    "結果の出た走が無い新モーター（sample_count === 0）に「初下ろし」を添える",
    chart.includes("row.sample_count === 0 && (") &&
      chart.includes('t("analysis.motor.firstUseBadge")') &&
      // 行の組み立ては src/pure/raceMotorBreakdown.js の recalcMotorRows に移した
      /sample_count: powerIndexes\[i\]\?\.sample_count/.test(
        read("src/pure/raceMotorBreakdown.js"),
      ),
  );
  check(
    "推移グラフは、入れ替え直後の 2連率・3連率とも 0 の先頭の点を描かない",
    /findIndex\(\s*\(row\) => row\.motor_2rate !== 0 \|\| row\.motor_3rate !== 0/.test(
      chart,
    ),
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
      "部品交換: チャートが raceNos を「◯R」に整形する（画面）",
      chart.includes("event.raceNos.map((n) => `${n}R`)"),
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
  check(
    "推移グラフ: 全部の点が 0 のとき、集計前なら線を引かず、集計済みなら 0 の線を引き、不明なら断定しない",
    /firstRatedIndex === -1\s*\?\s*drillTallyState === "tallied"/.test(chart) &&
      chart.includes('t("analysis.motor.trendNotYetOfficial")') &&
      chart.includes('t("analysis.motor.trendOfficialZeroUnknown")'),
  );
}

export async function section3(ctx) {
  const { chart, check, powerIndexTone, read } = ctx;
  check(
    "推移グラフ: 先頭の 0 を落としたときは、展示タイムと始まりがずれる理由を書く",
    chart.includes("firstRatedIndex > 0 && (") &&
      chart.includes('t("analysis.motor.trendStartNote")'),
  );
  check(
    "使用履歴: 今日これから走るレースは「未」と出し、欠場等の「-」と区別する",
    /r\.date >= getTodayJST\(\)\s*\?\s*t\("analysis\.motor\.usageHistoryNotRun"\)/.test(
      chart,
    ),
  );
  check(
    "選手×枠成績: n<6 では (n=◯) を付けない（分数に走数が入る）",
    /\{!isSmallSample && \(\s*<span className="motor-waku-n">/.test(
      read("src/components/analysis/MotorRacerWakuDrillDown.jsx"),
    ),
  );
  // 公式の 0.0 の「集計前」の印は、BOA-830（公式が 0 の艇は自前の値）に置き換えた。
  // 新しい決まりは verify-motor-fresh-rate.js が守る
  check(
    "一覧: 「集計前」の印と注記を出さない（BOA-830 で、公式が 0 の艇は自前の値に置き換えた）",
    !chart.includes("isOfficialPending") &&
      !chart.includes('t("analysis.motor.officialPendingBadge")') &&
      !chart.includes('t("analysis.motor.officialPendingNote")'),
  );
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
    card,
    chart,
    check,
    day,
    formatPowerIndex,
    getMotorUsageHistory,
    near,
    read,
    rid,
    run,
    same,
    seed,
    usageTables,
  } = ctx;
  check(
    "機力指数: 一覧・ドリルダウン・選手ページの3か所で powerIndexTone を使い、小標本では評価の言葉を出さない",
    (chart.match(/powerIndexTone\(/g) ?? []).length >= 2 &&
      chart.includes('t("analysis.motor.powerIndexSmallSample")') &&
      card.includes("powerIndexTone(") &&
      card.includes('tone === "small"'),
  );
  check(
    "グラフ: 縦軸のラベルを縦方向の中央に置き（375px で切れない）、展示タイムの目盛りは小数2桁にそろえる",
    read("src/components/analysis/TrendLineChart.jsx").includes(
      'style: { textAnchor: "middle" }',
    ) && /exhibitionYAxis"\)\}\s*yTickDecimals=\{2\}/.test(chart),
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
      !/power_index > 0 \? "\+" : ""/.test(chart + card),
  );
  check(
    "一覧: オレンジ色の機力指数がある行があるときは、表の下の注記で意味（6走未満の参考値）を書く",
    chart.includes('t("analysis.motor.powerIndexSmallSampleNote"'),
  );
  check(
    "1基の詳細: 会場公式の成績が取れなかったとき（fetchFailed）は、推移グラフを「集計前」と判定しない（BOA-740）",
    /officialTallyState\(\s*venueHasOfficialStats && !venueMotorStats\?\.fetchFailed,\s*venueMotorStats\?\.raceCount,?\s*\)/.test(
      chart,
    ),
  );
  check(
    "選手ページ: 参考値の文言をレースページと同じ「— 走数が少ないため参考値」にそろえる",
    card.includes('" — 走数が少ないため参考値"'),
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
