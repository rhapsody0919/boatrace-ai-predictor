/**
 * verify-frontend-pure-functions.js の検査の一部（suiteVolatilityLevel・suiteCautionEvents・suiteInCautionAccuracy・suiteSemifinalCount・suiteMeetStRank・suiteMotorMeetParts）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { show } from "./frontend-pure-functions-common.js";

export function suiteVolatilityLevel(m, check) {
  const show = (p) => [m.getVolatilityLevel(p), m.volatilityDisplayValue(p)];
  check("volatility: 0.6975 は標準で69（四捨五入の70にしない）", show(0.6975), [
    "standard",
    69,
  ]);
  check("volatility: 0.7037 はイン崩れ注意（高）で70", show(0.7037), [
    "high",
    70,
  ]);
  check("volatility: 0.3 は本命有利で30", show(0.3), ["low", 30]);
  check("volatility: 0.3004 は標準で31（四捨五入の30にしない）", show(0.3004), [
    "standard",
    31,
  ]);
  check(
    "volatility: 0 と 1 はそのまま",
    [show(0), show(1)],
    [
      ["low", 0],
      ["high", 100],
    ],
  );
  check("volatility: 標準の中はそのまま四捨五入", show(0.555), [
    "standard",
    56,
  ]);
}

// --- cautionEvents（BOA-822 task 27）: 注意度の GA4 イベント。生の % を送らず段のキーだけ、レース単位の面だけ race_id
export function suiteCautionEvents(m, check) {
  const rid = "2026-10-11-02-04";
  check(
    "cautionEvents: レース詳細の visible は race_id・段・置き場所（ai_tab）。% は送らない",
    m.cautionVisibleEvent({
      surface: "race_detail",
      raceId: rid,
      inCaution: { level: "high", pct: 65 },
    }),
    {
      name: "caution_visible",
      params: {
        caution_surface: "race_detail",
        race_id: rid,
        caution_band: "high",
        caution_placement: "ai_tab",
      },
    },
  );
  check(
    "cautionEvents: 値の無いレースは段 insufficient",
    m.cautionVisibleEvent({
      surface: "race_detail",
      raceId: rid,
      inCaution: null,
    }).params.caution_band,
    "insufficient",
  );
  check(
    "cautionEvents: ホーム・一覧から押したレースは race_id・段つき、/accuracy への導線は付けない。一覧の visible はページごと",
    [
      m.cautionClickEvent({
        surface: "home_highlight",
        target: "race",
        raceId: rid,
        inCaution: { level: "high" },
      }).params,
      m.cautionClickEvent({ surface: "home_highlight", target: "accuracy" })
        .params,
      m.cautionVisibleEvent({ surface: "race_list", raceId: rid }).params,
    ],
    [
      {
        caution_surface: "home_highlight",
        race_id: rid,
        caution_band: "high",
        caution_target: "race",
      },
      { caution_surface: "home_highlight", caution_target: "accuracy" },
      { caution_surface: "race_list" },
    ],
  );
  check(
    "cautionEvents: ホーム・/accuracy は race_id・段・置き場所なし",
    m.cautionVisibleEvent({ surface: "accuracy" }),
    { name: "caution_visible", params: { caution_surface: "accuracy" } },
  );
  check(
    "cautionEvents: click は行き先つき。知らない面・行き先、race_id の無いレース単位の面は送らない",
    [
      m.cautionClickEvent({
        surface: "race_detail",
        target: "sonar",
        raceId: rid,
        inCaution: { level: "low" },
      }).params,
      m.cautionClickEvent({ surface: "race_detail", target: "x", raceId: rid }),
      m.cautionClickEvent({ surface: "nowhere", target: "race" }),
      m.cautionClickEvent({ surface: "home_highlight", target: "race" }),
    ],
    [
      {
        caution_surface: "race_detail",
        race_id: rid,
        caution_band: "low",
        caution_placement: "ai_tab",
        caution_target: "sonar",
      },
      null,
      null,
      null,
    ],
  );
}

// --- inCautionAccuracyView（BOA-822 task 24）: /accuracy の段ごとの実績。夜のジョブが書いた件数を並べ、
// 件数30未満の段は割合を出さない（公開直後に1〜2件で 0% や 100% を出さない）
export function suiteInCautionAccuracy(m, check) {
  // 公開前の検証（2026-10-17 本番の表から再計算した値、#1605）
  const pre = m.inCautionAccuracyView({
    base: { n: 75295, nonWin: 34194 },
    byLevel: {
      low: { n: 21027, nonWin: 5716 },
      mid: { n: 32169, nonWin: 13962 },
      high: { n: 22071, nonWin: 14503 },
    },
  });
  check(
    "inCautionAccuracy: 並びは崩れやすい→堅め、割合・全体に占める割合・全国",
    pre.rows.map((r) => [r.level, m.pct1(r.rate), Math.round(r.share * 100)]),
    [
      ["high", "65.7", 29],
      ["mid", "43.4", 43],
      ["low", "27.2", 28],
    ],
  );
  check("inCautionAccuracy: 全国は base の割合", m.pct1(pre.base.rate), "45.4");
  check(
    "inCautionAccuracy: ぶれ幅は Wilson の95%（崩れやすい 65.1〜66.3）",
    [m.pct1(pre.rows[0].lo), m.pct1(pre.rows[0].hi)],
    ["65.1", "66.3"],
  );
  // 公開直後: 29件の段は割合を出さない。30件から出す。段が無いキーは0件
  const post = m.inCautionAccuracyView({
    base: { n: 59, nonWin: 30 },
    byLevel: { high: { n: 29, nonWin: 29 }, mid: { n: 30, nonWin: 12 } },
  });
  check(
    "inCautionAccuracy: 30件未満は割合・ぶれ幅なし、30件から出す、無い段は0件",
    post.rows.map((r) => [r.level, r.n, r.rate, r.lo === null]),
    [
      ["high", 29, null, true],
      ["mid", 30, 0.4, false],
      ["low", 0, null, true],
    ],
  );
  check("inCautionAccuracy: 無いときは null", m.inCautionAccuracyView(null), null);
}

// BOA-1155: 準優出は欠場を含む掲載回数。当社集計の開始日は呼び出し側が渡す。
export function suiteSemifinalCount(m, check) {
  const row = (race_id, race_stage = "準優勝戦", rest = {}) => ({
    race_id,
    race_date: "2025-12-01",
    race_stage,
    racer_id: 4320,
    is_absent: false,
    ...rest,
  });
  const count = (rows, ids = []) =>
    [...m.countSemifinalsByRacer(rows, "2025-12-01", ids)];
  check(
    "準優出: 開始日を含み、前日を除く",
    count([
      row("before", "準優勝戦", { race_date: "2025-11-30" }),
      row("boundary"),
      row("after", "準優勝戦", { race_date: "2025-12-02" }),
    ]),
    [[4320, 2]],
  );
  check(
    "準優出: 種別は getRaceStageKey に従う（表記ゆれも含む）",
    [
      "準優勝戦", "準優進出戦", "準々優勝戦", "優勝戦", "予選", null,
      "Ｗ準優戦前半", "準決勝戦", "セミファイナル",
    ].map((stage) => count([row("stage", stage)], [4320])[0][1]),
    [1, 0, 0, 0, 0, 0, 1, 1, 1],
  );
  check(
    "準優出: 欠場だけの走も含め、選手×レースで重複排除",
    count([
      row("absent", "準優勝戦", { is_absent: true }),
      row("mixed", "準優勝戦", { is_absent: true }),
      row("mixed"),
      row("mixed"),
      row("mixed", "準優勝戦", { racer_id: 4444 }),
    ]),
    [[4320, 2], [4444, 1]],
  );
  check(
    "準優出: 行の無い選手は引数の一覧で0を返す",
    count([], [4320, 4444, 4444]),
    [[4320, 0], [4444, 0]],
  );
  check("準優出: 空入力・一覧なし", count([]), []);
  check(
    "準優出: 開始日は固定値でなく引数を使う",
    [...m.countSemifinalsByRacer([row("earlier")], "2025-12-02")],
    [],
  );
  const rows = Object.freeze([Object.freeze(row("frozen"))]);
  const ids = Object.freeze([4444]);
  const before = show([rows, ids]);
  count(rows, ids);
  check("準優出: 配列・各行・選手一覧を変更しない", show([rows, ids]), before);
}

export function suiteMeetStRank(m, check) {
  const beforeRaceId = "2026-11-04-22-12";
  const runs = (values) => values.map((st, i) => ({
    raceId: `2026-11-03-22-0${i + 1}`, st,
    finish: st === null ? "F" : 1,
  }));
  const input = [
    [0.15, 0.16, 0.14], [0.12, 0.11, 0.13],
    [0.14, null, 0.14, 0.14], [0.20, 0.18],
    [0.16, 0.15, 0.14], [],
  ].map((values, i) => ({ boat: i + 1, runs: runs(values) }));
  check("今節平均・有効走数・同順位と欠番", m.rankMeetAvgSt(input, { beforeRaceId }), [
    { boat: 1, avg: 0.15, n: 3, rank: 3 },
    { boat: 2, avg: 0.12, n: 3, rank: 1 },
    { boat: 3, avg: 0.14, n: 3, rank: 2 },
    { boat: 4, avg: null, n: 2, rank: null },
    { boat: 5, avg: 0.15, n: 3, rank: 3 },
    { boat: 6, avg: null, n: 0, rank: null },
  ]);
  const excluded = [
    { raceId: beforeRaceId, st: 0.01 },
    { raceId: "2026-11-05-22-01", st: 0.02 },
    ...["F", "L"].map((finish) => ({ raceId: "2026-11-03-22-09", st: 0.01, finish })),
    ...[null, undefined, NaN, Infinity, "0.15"].map((st) => ({ raceId: "2026-11-03-22-08", st })),
  ];
  check("当該・未来・F・L・数値以外を除外", m.rankMeetAvgSt([
    { boat: 1, runs: [...runs([0.15, 0.15]), ...excluded] },
  ], { beforeRaceId }), [{ boat: 1, avg: null, n: 2, rank: null }]);
  check("minRunsを指定できる", m.rankMeetAvgSt([
    { boat: 4, runs: runs([0.20, 0.18]) },
  ], { beforeRaceId, minRuns: 2 }), [{ boat: 4, avg: 0.19, n: 2, rank: 1 }]);
  check("小数3桁で同じ平均は同順位", m.rankMeetAvgSt([
    { boat: 1, runs: runs([0.1501, 0.1501, 0.1501]) },
    { boat: 2, runs: runs([0.1504, 0.1504, 0.1504]) },
    { boat: 3, runs: runs([0.151, 0.151, 0.151]) },
  ], { beforeRaceId }).map(({ rank }) => rank), [1, 1, 3]);
}

export function suiteMotorMeetParts({ countMeetPartsChanges: count }, check) {
  const events = [
    { date: "2026-10-30", parts: ["ピストン"] },
    { date: "2026-11-02", parts: ["リング", "ピストン"], propellerChanged: true },
    { date: "2026-11-03", parts: [], propellerChanged: true },
    { date: "2026-11-05", parts: ["キャブ"] },
  ];
  check("今節だけ・プロペラ除外", count(events, { from: "2026-10-31", to: "2026-11-04" }),
    { count: 2, parts: ["リング", "ピストン"] });
  check("両端を含み日付順・入力を変更しない", count([...events].reverse(), { from: "2026-10-30", to: "2026-11-05" }),
    { count: 4, parts: ["ピストン", "リング", "ピストン", "キャブ"] });
  check("配列以外", count(null, { from: "2026-10-30", to: "2026-11-05" }), { count: 0, parts: [] });
  check("プロペラだけ", count([events[2]], { from: "2026-11-03", to: "2026-11-03" }), { count: 0, parts: [] });
}
