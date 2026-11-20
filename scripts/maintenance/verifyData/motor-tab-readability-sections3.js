/**
 * verify-motor-tab-readability.js の検査の続き（motor-tab-readability-sections3.js）。機力指数の表示・訳（locales）の確かめ。verify ではない。
 * sections1.js が400行を越えたので、機力指数の表示（section4）と訳の場面を移した。共通の道具は ctx で受け取る。
 */

async function section4_1(ctx) {
  const { check, drill, list, racerCardView: card, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "機力指数: 一覧・ドリルダウン・選手ページの3か所で powerIndexTone を使い、小標本では評価の言葉を出さない（描いた3か所）",
    list.power[1].cls.split(" ").includes("is-small-sample") &&
      drill.summaryClass.split(" ").includes("is-small-sample") &&
      drill.summary.endsWith(H("powerIndexSmallSample")) &&
      ![H("powerIndexGood"), H("powerIndexBad")].some((w) =>
        drill.summary.includes(w),
      ) &&
      card.indexClass.split(" ").includes("is-small-sample"),
  );
  check(
    "グラフ: 縦軸のラベルを縦方向の中央に置き（375px で切れない）、展示タイムの目盛りは小数2桁にそろえる（描いたグラフ）",
    Object.values(drill.charts)
      .filter(Boolean)
      .every((c) => c.yLabelAnchor === "middle") &&
      drill.charts[H("exhibitionTrendHeading")]?.yTicks.every((x) =>
        /^\d+\.\d{2}$/.test(x),
      ),
  );
}

async function section4_2(ctx) {
  const {
    M,
    V,
    check,
    day,
    getMotorUsageHistory,
    near,
    rid,
    run,
    same,
    seed,
    usageTables,
  } = ctx;
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
}

async function section4_3(ctx) {
  const {
    check,
    drill,
    formatPowerIndex,
    list,
    racerCardView: card,
    scenes,
    tJa,
  } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  check(
    "formatPowerIndex: 丸めて0になる負の値を「-0.0」と出さない（丸亀45号機 -0.04 → 0.0）",
    formatPowerIndex(-0.04) === "0.0" &&
      formatPowerIndex(12.14) === "+12.1" &&
      formatPowerIndex(-4.1) === "-4.1" &&
      formatPowerIndex(0) === "0.0" &&
      // 画面（一覧・ドリルダウン・選手ページ）の -0.04 も 0.0（"-0.0"・"+0.0" にしない）
      list.power[2].text === "0.0" &&
      drill.summary.includes(
        tJa("analysis.motor.powerIndexSummary", {
          index: "0.0",
          count: 4,
          period: H("period90"),
        }),
      ) &&
      card.index.startsWith("機力指数 0.0（"),
  );
  {
    const plain = await scenes.motorListScene({ 2: { sample_count: 13 } });
    const note = tJa("analysis.motor.powerIndexSmallSampleNote", { n: 6 });
    check(
      "一覧: オレンジ色の機力指数がある行があるときは、表の下の注記で意味（6走未満の参考値）を書く（描いた一覧。無い一覧には書かない）",
      list.notes.some((n) => n.includes(note)) &&
        !plain.notes.some((n) => n.includes(note)),
    );
  }
}

async function section4_4(ctx) {
  const { check, racerCardView: card, scenes, tJa } = ctx;
  const H = (key) => tJa(`analysis.motor.${key}`);
  {
    // 全部の点が 0・会場公式の出走数 0。取得に失敗していれば断定せず、取れていれば集計前
    const failed = await scenes.allZeroTrendScene({
      raceCount: 0,
      fetchFailed: true,
    });
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

export async function section4(ctx) {
  // 一覧の2号艇は4走で +9.5、ドリルダウンと選手ページは4走で -0.04（どれも6走未満）
  await section4_1(ctx);
  await section4_2(ctx);
  await section4_3(ctx);
  await section4_4(ctx);
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
