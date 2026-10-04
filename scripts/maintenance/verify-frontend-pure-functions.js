#!/usr/bin/env node
/**
 * 画面側の純関数（DB・ネットワーク・DOMに依存しない集計・判定）の回帰テスト（BOA-255）。
 * DB接続は不要。
 *
 * 対象は「2026-08-15以降に fix コミットが入った」かつ「既存の verify-* から検証されていない」
 * ファイルを fix 件数順に選んだもの（選定表は BOA-255 の PR 本文）。各検証は、実際に起きた
 * バグを再現する入力を含み、そのバグが再発すると落ちる。
 *
 *   1. src/components/race/basicInfoStats.js  … 基本情報・直前情報・今節タブの集計
 *   2. src/utils/raceStatus.js                … レースの締切前/結果反映待ち/確定の判定
 *   3. src/components/race/courseGridStats.js … 枠別情報タブのコース別成績
 *   4. src/components/race/venueDayTrend.js   … 「この日の水面傾向」の1行要約
 *   5. src/components/race/weatherInfo.js     … 気象の観測時刻の表示
 *   6. src/utils/dateUtils.js                 … ブログ一覧の NEW バッジ（isWithinDays）
 *
 * 末尾の変異検証で、各関数の要（過去に壊れた箇所を含む）を1つずつ壊したコピーに同じ検証を
 * かけ、検証が失敗する（＝歯がある）ことを確かめる。
 *
 * 期間フィルタ（last3m / last1m）は既定で実行時の現在日時に依存するため、日付は「今日から何日前」で
 * 作り、境界から十分離す（同じコミットなら常に同じ結果になるように）。境界そのものを見る検証
 * （BOA-469）は filterRecords の now で現在時刻を固定する。TZ=UTC / TZ=Asia/Tokyo の両方で通ること。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getDaysAgoJST } from "../../src/utils/dateUtils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

const TARGETS = {
  basicInfoStats: "src/components/race/basicInfoStats.js",
  raceStatus: "src/utils/raceStatus.js",
  courseGridStats: "src/components/race/courseGridStats.js",
  venueDayTrend: "src/components/race/venueDayTrend.js",
  weatherInfo: "src/components/race/weatherInfo.js",
  dateUtils: "src/utils/dateUtils.js",
  prevResult: "src/utils/prevResult.js",
  nextOpenDate: "src/utils/nextOpenDate.js",
  meetGrouping: "src/utils/meetGrouping.js",
  turnPrediction: "src/utils/turnPrediction.js",
  volatilityLevel: "src/utils/volatilityLevel.js",
  hscrollHint: "src/utils/horizontalScrollHint.js",
};

const show = (v) => JSON.stringify(v);
const r2 = (v) =>
  v === null || v === undefined ? v : Math.round(v * 100) / 100;

// JST の今日から days 日前（BOA-554: 以前はローカル時刻で setDate したあと toISOString（UTC）で
// 取り出しており、JST 0〜9時は1日古くなった。境界から離して使うので実害は無かった）
const daysAgo = (days) => getDaysAgoJST(days);

/**
 * getRacerScopedRaceStats の1行と同じ形のレコードを作る。
 * ranks は [1着艇, 2着艇, ..., 6着艇]（未取得・欠場の着は null）
 */
function rec({
  raceId,
  date = raceId.slice(0, 10),
  venueCode = Number(raceId.slice(11, 13)),
  boatNumber,
  ranks = [1, 2, 3, 4, 5, 6],
  raceGrade = "ippan",
  startTiming = null,
  actualCourse = null,
  ...rest
}) {
  return {
    raceId,
    date,
    venueCode,
    boatNumber,
    raceGrade,
    rank1: ranks[0] ?? null,
    rank2: ranks[1] ?? null,
    rank3: ranks[2] ?? null,
    rank4: ranks[3] ?? null,
    rank5: ranks[4] ?? null,
    rank6: ranks[5] ?? null,
    startTiming,
    actualCourse,
    raceTitle: null,
    raceStage: null,
    winningTechnique: null,
    payoutWin: null,
    ...rest,
  };
}

// ---------------------------------------------------------------------------
// 1. basicInfoStats.js
// ---------------------------------------------------------------------------
function suiteBasicInfoStats(m, check) {
  // --- getRecentRaces: 枠番は生の艇番（2e91aa0b → 57a9b159 で往復したバグ）
  // 2e91aa0b 以前は actualCourse ?? boatNumber を「枠番」に出しており、欠場で
  // actualCourse=null のとき艇番を実在コースとして誤表示した。57a9b159 で
  // courseWithFallback（実進入コース）を渡したために、同じ行の「枠番」と
  // 着順判定の艇番が食い違った。現在は boatNumber=生の艇番、entryCourse=実進入コース
  const recent = m.getRecentRaces(
    [
      rec({
        raceId: "2026-09-10-04-05",
        boatNumber: 3,
        actualCourse: 5,
        courseWithFallback: 5,
        ranks: [3, 1, 2, 4, 5, 6],
      }),
      rec({
        raceId: "2026-09-11-04-07",
        boatNumber: 4,
        actualCourse: null, // 欠場
        courseWithFallback: null,
        ranks: [1, 2, 3, 5, 6, null],
      }),
    ],
    5,
  );
  check(
    "getRecentRaces: 枠番(boatNumber)は実進入コースではなく当該レースの艇番（57a9b159）",
    recent.map((r) => r.boatNumber),
    [3, 4],
  );
  check(
    "getRecentRaces: 実進入コースは entryCourse に分けて持つ。欠場は null（2e91aa0b）",
    recent.map((r) => r.entryCourse),
    [5, null],
  );
  check(
    "getRecentRaces: 枠番で着順を判定する（3号艇が1着なら1着）",
    recent[0].finishRank,
    1,
  );
  check(
    "getRecentRaces: 欠場（どの着にも艇番が無い）は着順 null",
    recent[1].finishRank,
    null,
  );
  check(
    "getRecentRaces: レース番号は race_id から導出する",
    recent.map((r) => r.raceNo),
    [5, 7],
  );

  // --- getRecentRaces: レース名・種別・決まり手・単勝配当を透過する（6a126cb8）
  // 以前は4列とも null 固定で「直近5走」が常に「-」表示だった
  const passthrough = m.getRecentRaces([
    rec({
      raceId: "2026-09-12-04-12",
      boatNumber: 1,
      ranks: [1, 2, 3, 4, 5, 6],
      raceTitle: "G1 全日本王者決定戦",
      raceStage: "優勝戦",
      winningTechnique: "逃げ",
      payoutWin: 0, // 0円は「データなし」ではない（927d46d1 #6）
    }),
  ])[0];
  check(
    "getRecentRaces: raceTitle/raceStage/winningTechnique/payoutWin を透過する（6a126cb8）",
    [
      passthrough.raceTitle,
      passthrough.raceStage,
      passthrough.winningTechnique,
      passthrough.payoutWin,
    ],
    ["G1 全日本王者決定戦", "優勝戦", "逃げ", 0],
  );
  check(
    "getRecentRaces: 末尾（新しい方）から count 件",
    m
      .getRecentRaces(
        [1, 2, 3, 4, 5, 6, 7].map((i) =>
          rec({ raceId: `2026-09-0${i}-04-01`, boatNumber: 1 }),
        ),
        5,
      )
      .map((r) => r.date),
    ["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06", "2026-09-07"],
  );
  check("getRecentRaces: null は空配列", m.getRecentRaces(null), []);

  // --- finishPositionOf: 4〜6着を実際の順位で返す（d3817581）
  // 以前は1〜3着以外を一律 "out" にしていた
  const pos = (boatNumber, ranks) =>
    m.finishPositionOf(rec({ raceId: "2026-09-10-01-01", boatNumber, ranks }));
  check(
    "finishPositionOf: 4〜6着は 4/5/6 を返す（d3817581）",
    [
      pos(4, [1, 2, 3, 4, 5, 6]),
      pos(5, [1, 2, 3, 4, 5, 6]),
      pos(6, [1, 2, 3, 4, 5, 6]),
    ],
    [4, 5, 6],
  );
  check(
    "finishPositionOf: rank4〜6 が未バックフィル（null）なら null（'out' 等の文字列にしない）",
    pos(5, [1, 2, 3, null, null, null]),
    null,
  );

  // --- computeRates: 平均STは startTiming が取れた走だけで割る（d3817581）
  const rates = m.computeRates([
    rec({
      raceId: "2026-09-10-01-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.1,
    }),
    rec({
      raceId: "2026-09-10-01-02",
      boatNumber: 2,
      ranks: [1, 2, 3],
      startTiming: 0.2,
    }),
    rec({
      raceId: "2026-09-10-01-03",
      boatNumber: 3,
      ranks: [1, 2, 3],
      startTiming: null,
    }), // F・未計測
    rec({
      raceId: "2026-09-10-01-04",
      boatNumber: 4,
      ranks: [1, 2, 3],
      startTiming: undefined,
    }),
  ]);
  check(
    "computeRates: 1着率・2連対率・3連対率（各レコード自身の艇番で判定）",
    [rates.n, rates.winRate, rates.top2Rate, rates.top3Rate],
    [4, 25, 50, 75],
  );
  check(
    "computeRates: 平均STは null/undefined を母数に入れない（avgStN と n は別）",
    [r2(rates.avgSt), rates.avgStN],
    [0.15, 2],
  );
  check("computeRates: 0件は率を null（0% と区別する）", m.computeRates([]), {
    n: 0,
    winRate: null,
    top2Rate: null,
    top3Rate: null,
    avgSt: null,
    avgStN: 0,
  });

  // --- filterRecords: G2/G3 は「全レース」だけに含める
  const graded = ["SG", "G1", "G2", "G3", "ippan", null].map((g, i) =>
    rec({ raceId: `2026-09-1${i}-04-01`, boatNumber: 1, raceGrade: g }),
  );
  const gradesOf = (grade) =>
    m
      .filterRecords(graded, {
        venueCode: 4,
        scope: "national",
        grade,
        period: "current",
      })
      .map((r) => r.raceGrade);
  check("filterRecords: SG・G1 は SG と G1 だけ", gradesOf("sgg1"), [
    "SG",
    "G1",
  ]);
  check("filterRecords: 一般戦は ippan だけ", gradesOf("ippan"), ["ippan"]);
  check(
    "filterRecords: 全レースは G2/G3/グレード未取得も含む",
    gradesOf("all").length,
    6,
  );
  check(
    "filterRecords: 当地は会場コードで絞る",
    m
      .filterRecords(
        [
          rec({ raceId: "2026-09-10-04-01", boatNumber: 1 }),
          rec({ raceId: "2026-09-10-12-01", boatNumber: 1 }),
        ],
        { venueCode: 12, scope: "local", grade: "all", period: "current" },
      )
      .map((r) => r.venueCode),
    [12],
  );
  check(
    "filterRecords: 直近1ヶ月は30日より前を落とす（境界から離した日付で）",
    m
      .filterRecords(
        [
          rec({ raceId: `${daysAgo(10)}-04-01`, boatNumber: 1 }),
          rec({ raceId: `${daysAgo(60)}-04-01`, boatNumber: 1 }),
          rec({ raceId: `${daysAgo(200)}-04-01`, boatNumber: 1 }),
        ],
        { venueCode: 4, scope: "national", grade: "all", period: "last1m" },
      )
      .map((r) => r.date),
    [daysAgo(10)],
  );

  // --- filterRecords: 期間の境界は JST の日付で切る（BOA-469）
  // 以前はローカル時刻で setDate したあと toISOString()（UTC）で日付を取り出しており、
  // JST 0〜9時は UTC では前日なので境界が1日古くなり、31日前・91日前の走が混ざった。
  // 現在時刻を固定して、JST 早朝（UTC では前日）と JST 昼の両方で境界の前後を見る。
  // どちらも JST 2026-09-29 の扱い: 直近1ヶ月の境界は 08-30、直近3ヶ月は 07-01
  const boundaryRecs = [
    "2026-06-30",
    "2026-07-01",
    "2026-07-02",
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
  ].map((d) => rec({ raceId: `${d}-04-01`, boatNumber: 1 }));
  const periodDates = (period, now) =>
    m
      .filterRecords(boundaryRecs, {
        venueCode: 4,
        scope: "national",
        grade: "all",
        period,
        now,
      })
      .map((r) => r.date);
  for (const [label, iso] of [
    ["JST 03:00（UTC 前日 18:00）", "2026-09-28T18:00:00Z"],
    ["JST 12:00（UTC 同日 03:00）", "2026-09-29T03:00:00Z"],
  ]) {
    check(
      `filterRecords: ${label} の直近1ヶ月は JST 30日前(08-30)から。31日前は含めない（BOA-469）`,
      periodDates("last1m", new Date(iso)),
      ["2026-08-30", "2026-08-31"],
    );
    check(
      `filterRecords: ${label} の直近3ヶ月は JST 90日前(07-01)から。91日前は含めない（BOA-469）`,
      periodDates("last3m", new Date(iso)),
      ["2026-07-01", "2026-07-02", "2026-08-29", "2026-08-30", "2026-08-31"],
    );
  }

  // --- computeVenueRanking: 指標連動・n>=5・平均STは昇順（d3817581）
  const venueRecords = [];
  // 会場4: 5走中3勝、ST 0.20
  for (let i = 0; i < 5; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-04-01`,
        boatNumber: 1,
        ranks: i < 3 ? [1, 2, 3] : [2, 3, 4],
        startTiming: 0.2,
      }),
    );
  // 会場12: 5走中1勝、ST 0.10（STは良いが勝率は低い）
  for (let i = 0; i < 5; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-12-01`,
        boatNumber: 1,
        ranks: i < 1 ? [1, 2, 3] : [2, 3, 4],
        startTiming: 0.1,
      }),
    );
  // 会場20: 6走だがSTが取れたのは2走だけ（勝率では対象、平均STでは対象外）
  for (let i = 0; i < 6; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-20-01`,
        boatNumber: 1,
        ranks: [2, 3, 4],
        startTiming: i < 2 ? 0.05 : null,
      }),
    );
  // 会場24: 4走（n<5 でどの指標でも対象外）
  for (let i = 0; i < 4; i++)
    venueRecords.push(
      rec({
        raceId: `2026-09-0${i + 1}-24-01`,
        boatNumber: 1,
        ranks: [1, 2, 3],
      }),
    );
  check(
    "computeVenueRanking: 勝率は降順、n<5 の会場は除く",
    m.computeVenueRanking(venueRecords, "winRate").map((r) => r.venueCode),
    [4, 12, 20],
  );
  check(
    "computeVenueRanking: 平均STは小さい方が良いので昇順、母数は avgStN>=5",
    m.computeVenueRanking(venueRecords, "avgSt").map((r) => r.venueCode),
    [12, 4],
  );

  // --- computeFrameEntryDistribution（BOA-485、旧 computeAvgEntryCourse の置き換え）
  // / computeExhibitionTopRates（BOA-304）
  // 旧実装は全枠のレースを混ぜて平均し、1号艇でも 3.16 のような値になった。
  // 今回と同じ枠番の走だけ・表示中のレースより前だけ・actualCourse=null は母数外、を固定する
  const frameEntryRecords = [
    rec({ raceId: "2026-09-10-04-01", boatNumber: 2, actualCourse: 2 }),
    rec({ raceId: "2026-09-10-04-02", boatNumber: 2, actualCourse: 1 }),
    rec({ raceId: "2026-09-10-04-03", boatNumber: 2, actualCourse: 3 }),
    rec({ raceId: "2026-09-10-04-04", boatNumber: 2, actualCourse: null }), // 欠場
    rec({ raceId: "2026-09-10-04-05", boatNumber: 1, actualCourse: 1 }), // 別の枠
    rec({ raceId: "2026-09-10-04-09", boatNumber: 2, actualCourse: 2 }), // 表示中より後
  ];
  check(
    "computeFrameEntryDistribution: 同じ枠番・表示中より前の走だけ、actualCourse=null は母数外（BOA-485）",
    m.computeFrameEntryDistribution(frameEntryRecords, 2, "2026-09-10-04-08"),
    {
      n: 3,
      counts: [1, 1, 1, 0, 0, 0],
      wakuRate: (1 / 3) * 100,
      inwardRate: (1 / 3) * 100,
      outwardRate: (1 / 3) * 100,
    },
  );
  check(
    "computeFrameEntryDistribution: 対象0件なら率は null（0% と区別する）",
    m.computeFrameEntryDistribution(frameEntryRecords, 6, null),
    {
      n: 0,
      counts: [0, 0, 0, 0, 0, 0],
      wakuRate: null,
      inwardRate: null,
      outwardRate: null,
    },
  );
  check(
    "computeExhibitionTopRates: 展示単独最速の走だけで率を出す（同着最速=null は除く）",
    m.computeExhibitionTopRates([
      rec({
        raceId: "2026-09-10-04-01",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: true,
      }),
      rec({
        raceId: "2026-09-10-04-02",
        boatNumber: 1,
        ranks: [2, 1, 3],
        isFastestExhibition: true,
      }),
      rec({
        raceId: "2026-09-10-04-03",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: null,
      }),
      rec({
        raceId: "2026-09-10-04-04",
        boatNumber: 1,
        ranks: [1, 2, 3],
        isFastestExhibition: false,
      }),
    ]).winRate,
    50,
  );

  // --- lastStartTiming（BOA-597）: 前走のST。直前が F・L ならその記号で、飛ばさない
  const stOf = { valueOf: (r) => r.st, markOf: (r) => r.mark ?? null };
  check(
    "lastStartTiming: 直前が F・L ならその記号、欠場（ST無し・記号無し）は飛ばす、何も無ければ null",
    [
      m.lastStartTiming([{ st: 0.09 }, { st: null, mark: "F" }], stOf),
      m.lastStartTiming([{ st: 0.09 }, { st: null, mark: "L" }], stOf),
      m.lastStartTiming([{ st: 0.12 }, { st: null }], stOf),
      m.lastStartTiming([{ st: null, mark: "F" }, { st: 0.15 }], stOf),
      m.lastStartTiming([{ st: null }], stOf),
      m.lastStartTiming(null, stOf),
    ],
    [
      { mark: "F", value: null },
      { mark: "L", value: null },
      { mark: null, value: 0.12 },
      { mark: null, value: 0.15 },
      null,
      null,
    ],
  );

  // --- periodDiff（BOA-439）: 前期と出走表の値の差。どちらも公式値
  check(
    "periodDiff: 出走表の値と、符号つきの差（勝率は小数2桁・2連対率は1桁）",
    [
      m.periodDiff(4.5, "4.12", 2),
      m.periodDiff(25.6, 31.25, 1),
      m.periodDiff(4.5, 4.5, 2),
    ],
    [
      { current: "4.12", diff: "−0.38", sign: -1 },
      { current: "31.3", diff: "+5.7", sign: 1 },
      { current: "4.50", diff: "±0.00", sign: 0 },
    ],
  );
  check(
    "periodDiffShownFrom: 期の初めから3か月後の1日から差を出す（年をまたぐ期も）",
    [
      m.periodDiffShownFrom("2026-04-30"),
      m.periodDiffShownFrom("2025-10-31"),
      m.periodDiffShownFrom(null),
      m.periodDiffShownFrom("2026/04/30"),
    ],
    ["2026-08-01", "2026-02-01", null, null],
  );
  check(
    "periodDiff: どちらかが無ければ null（出走0の新人・出走表の値が無いとき）",
    [
      m.periodDiff(null, 4.1, 2),
      m.periodDiff(4.5, null, 2),
      m.periodDiff(4.5, "", 2),
      m.periodDiff(4.5, "abc", 2),
    ],
    [null, null, null, null],
  );

  check(
    "getRecentRaces: 進入は本番STの進入（当日も入る）を先に、無ければ Kファイル。ST順位と F を渡す（BOA-623）",
    m
      .getRecentRaces(
        [
          {
            raceId: "2026-10-01-16-04",
            boatNumber: 5,
            entryCourse: 6,
            actualCourse: null,
            rank1: 5,
            stRank: 2,
            isFlying: false,
          },
          {
            raceId: "2026-09-29-16-10",
            boatNumber: 5,
            actualCourse: 4,
            rank2: 5,
            stRank: 3,
          },
          {
            raceId: "2026-09-29-16-11",
            boatNumber: 2,
            entryCourse: null,
            actualCourse: null,
            isFlying: true,
          },
        ],
        10,
      )
      .map((x) => [x.entryCourse, x.startTimingRank, x.isFlying]),
    [
      [6, 2, false],
      [4, 3, false],
      [null, null, true],
    ],
  );

  // --- groupRunsByMeet（BOA-623）: 直近10走・レース一覧を節の見出し行でまとめる
  {
    const r = (raceId, venueCode, raceTitle, raceGrade = "G1") => ({
      raceId,
      venueCode,
      raceTitle,
      raceGrade,
    });
    const asc = [
      r("2026-09-14-18-07", 18, "ダイヤモンドカップ"),
      r("2026-09-15-18-02", 18, "ダイヤモンドカップ"),
      r("2026-09-17-18-09", 18, "ダイヤモンドカップ"),
      r("2026-09-28-16-05", 16, "児島キングカップ"),
      r("2026-09-29-16-10", 16, "児島キングカップ"),
    ];
    const summary = (gs) =>
      gs.map((g) => [g.venueCode, g.firstDate, g.lastDate, g.rows.length]);
    check(
      "groupRunsByMeet: 同じ会場・同じレース名・2日以内で続く行を1つの節にまとめる。古い順・新しい順のどちらでも期間は古い→新しい",
      [
        summary(m.groupRunsByMeet(asc)),
        summary(m.groupRunsByMeet([...asc].reverse())),
      ],
      [
        [
          [18, "2026-09-14", "2026-09-17", 3],
          [16, "2026-09-28", "2026-09-29", 2],
        ],
        [
          [16, "2026-09-28", "2026-09-29", 2],
          [18, "2026-09-14", "2026-09-17", 3],
        ],
      ],
    );
    check(
      "groupRunsByMeet: 同じ会場・同じ名前でも3日以上空けば別の節。会場が変われば同じ日でも別。空は空",
      [
        summary(
          m.groupRunsByMeet([
            r("2026-08-01-18-01", 18, "一般戦"),
            r("2026-08-05-18-01", 18, "一般戦"),
            r("2026-08-05-16-01", 16, "一般戦"),
          ]),
        ),
        m.groupRunsByMeet([]),
        m.groupRunsByMeet(null),
      ],
      [
        [
          [18, "2026-08-01", "2026-08-01", 1],
          [18, "2026-08-05", "2026-08-05", 1],
          [16, "2026-08-05", "2026-08-05", 1],
        ],
        [],
        [],
      ],
    );
  }

  // --- recordsBeforeRace（BOA-603）: 表示中のレースより前の走だけ
  check(
    "recordsBeforeRace: 表示中のレース自身と後日の走を外す。取得前・失敗・raceId無しはそのまま",
    [
      m
        .recordsBeforeRace(
          [
            { raceId: "2026-09-25-09-03" },
            { raceId: "2026-09-26-09-04" },
            { raceId: "2026-09-26-09-05" },
            { raceId: "2026-09-26-09-11" },
            { raceId: "2026-09-28-09-11" },
          ],
          "2026-09-26-09-05",
        )
        .map((r) => r.raceId),
      m.recordsBeforeRace(undefined, "2026-09-26-09-05"),
      m.recordsBeforeRace(null, "2026-09-26-09-05"),
      m.recordsBeforeRace([{ raceId: "2026-09-28-09-11" }], null).length,
    ],
    [["2026-09-25-09-03", "2026-09-26-09-04"], undefined, null, 1],
  );

  // --- buildConditionRows（phase a FR-2）
  const condRecords = [
    rec({
      raceId: "2026-09-10-04-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.1,
      seriesDay: 1,
      isFinalDay: false,
      waveHeight: 5,
      fCount: 1,
    }),
    rec({
      raceId: "2026-09-11-04-01",
      boatNumber: 1,
      ranks: [2, 1, 3],
      startTiming: null,
      seriesDay: 2,
      isFinalDay: false,
      waveHeight: 4,
      fCount: 0,
    }),
    rec({
      raceId: "2026-09-12-04-01",
      boatNumber: 1,
      ranks: [2, 3, 4],
      startTiming: 0.2,
      seriesDay: 3,
      isFinalDay: true,
      waveHeight: null,
      fCount: null,
    }),
  ];
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));
  const winRows = byKey(
    m.buildConditionRows(condRecords, { venueCode: 4, metric: "winRate" }),
  );
  const stRows = byKey(
    m.buildConditionRows(condRecords, { venueCode: 4, metric: "avgSt" }),
  );
  check(
    "buildConditionRows: 平均STの n は ST を計測できた走数（avgStN）。全走数と混ぜない",
    [stRows.national.n, r2(stRows.national.value), winRows.national.n],
    [2, 0.15, 3],
  );
  check(
    "buildConditionRows: 波は 5cm 以上（>=）を荒れとする。波高が取れない走は baseN に入れない",
    [winRows.wave5.n, winRows.wave5.baseN, winRows.wave5.value],
    [1, 2, 100],
  );
  // 江戸川（03）は波高を5cm刻みで記録し、最小が5cm。全走が「5cm以上」になるので、
  // 波の行の分子・母数の両方から外し、外した数を返す（BOA-584）
  const withEdogawa = byKey(
    m.buildConditionRows(
      [
        ...condRecords,
        rec({
          raceId: "2026-09-13-03-01",
          boatNumber: 1,
          ranks: [1, 2, 3],
          waveHeight: 5,
          fCount: 0,
        }),
      ],
      { venueCode: 4, metric: "winRate" },
    ),
  );
  check(
    "buildConditionRows: 波の行は江戸川の走を分子・母数から外し、外した数を excludedN で返す",
    [
      withEdogawa.wave5.n,
      withEdogawa.wave5.baseN,
      withEdogawa.wave5.excludedN,
      winRows.wave5.excludedN,
    ],
    [1, 2, 1, 0],
  );
  check(
    "buildConditionRows: 初日（seriesDay=1）・最終日（isFinalDay=true）",
    [winRows.firstDay.n, winRows.finalDay.n, winRows.finalDay.value],
    [1, 1, 0],
  );
  // 初日・最終日も、他行と母数が違うので baseN（日目を判定できた走数）を返す。
  // race_conditions は 2026-02 以降しか無く、この2行だけ期間が短い（BOA-499）
  const partialDay = [
    ...condRecords,
    rec({
      raceId: "2025-11-10-04-01",
      boatNumber: 1,
      ranks: [1, 2, 3],
      startTiming: 0.12,
      seriesDay: null,
      isFinalDay: null,
      waveHeight: null,
      fCount: null,
    }),
  ];
  const dayRows = byKey(
    m.buildConditionRows(partialDay, { venueCode: 4, metric: "winRate" }),
  );
  check(
    "buildConditionRows: 初日・最終日は baseN を返し、日目が無い走は入れない（BOA-499）",
    [
      winRows.firstDay.baseN,
      winRows.finalDay.baseN,
      dayRows.firstDay.baseN,
      dayRows.finalDay.baseN,
      dayRows.national.n,
    ],
    [3, 3, 3, 3, 4],
  );
  check(
    "buildConditionRows: F数が取れていない走（null）は F持ち時にも F無し時にも入れない",
    [winRows.fHolding.n, winRows.fClean.n, winRows.fHolding.baseN],
    [1, 1, 2],
  );
  check(
    "buildConditionRows: F持ち時・F無し時は指標に関わらず平均STも返す",
    [r2(winRows.fHolding.avgSt), winRows.fClean.avgSt, winRows.fClean.avgStN],
    [0.1, null, 0],
  );
  const unfetched = condRecords.map(
    ({ seriesDay, isFinalDay, waveHeight, ...rest }) => rest,
  );
  const unfetchedRows = byKey(
    m.buildConditionRows(unfetched, { venueCode: 4, metric: "winRate" }),
  );
  check(
    "buildConditionRows: race_conditions の取得失敗（全件 undefined）は n=0 ではなく unavailable",
    [
      unfetchedRows.firstDay.unavailable,
      unfetchedRows.finalDay.unavailable,
      unfetchedRows.wave5.unavailable,
    ],
    [true, true, true],
  );
  const missingRows = byKey(
    m.buildConditionRows(
      condRecords.map((r) => ({
        ...r,
        seriesDay: null,
        isFinalDay: null,
        waveHeight: null,
      })),
      { venueCode: 4, metric: "winRate" },
    ),
  );
  check(
    "buildConditionRows: 欠測（null）は取得失敗ではない（unavailable=false、n=0、値は null）",
    [
      missingRows.firstDay.unavailable,
      missingRows.firstDay.n,
      missingRows.firstDay.value,
    ],
    [false, 0, null],
  );
  check(
    "buildConditionRows: records が配列でなくても落ちない",
    m.buildConditionRows(null, { venueCode: 4, metric: "winRate" }).length,
    m.CONDITION_ROWS.length,
  );

  // --- buildMeetResults: 同じ日の後のレースを「今節のこれまで」に入れない（2026-09-20 桐生5R）
  const meetRecords = [
    rec({ raceId: "2026-09-12-01-03", boatNumber: 1 }), // 前節（間が空いている）
    rec({ raceId: "2026-09-18-01-02", boatNumber: 1 }), // 今節1日目
    rec({ raceId: "2026-09-19-01-08", boatNumber: 1 }), // 今節2日目
    rec({ raceId: "2026-09-19-02-04", boatNumber: 1 }), // 別会場（地続き）
    rec({ raceId: "2026-09-20-01-01", boatNumber: 1 }), // 今節3日目・表示中より前のレース
    rec({ raceId: "2026-09-20-01-09", boatNumber: 1 }), // 今節3日目・表示中より後のレース
  ];
  check(
    "buildMeetResults: 表示中のレース(5R)より前だけ。同じ日の9Rは入れない（桐生5Rで発生）",
    m
      .buildMeetResults(meetRecords, {
        raceId: "2026-09-20-01-05",
        venueCode: 1,
      })
      .map((r) => r.raceId),
    ["2026-09-18-01-02", "2026-09-19-01-08", "2026-09-20-01-01"],
  );
  check(
    "buildMeetResults: 過去のレースを開いたとき、それより後の節を今節にしない",
    m
      .buildMeetResults(meetRecords, {
        raceId: "2026-09-12-01-05",
        venueCode: 1,
      })
      .map((r) => r.raceId),
    ["2026-09-12-01-03"],
  );
  check(
    "buildMeetResults: 初日の朝（今節の結果が1走も無い）に前節を今節として出さない",
    m.buildMeetResults(meetRecords, {
      raceId: "2026-09-26-01-01",
      venueCode: 1,
    }),
    [],
  );
  check(
    "buildMeetResults: 会場コードが無ければ空",
    m.buildMeetResults(meetRecords, {
      raceId: "2026-09-20-01-05",
      venueCode: null,
    }),
    [],
  );

  // --- buildMeetTrend: 差は画面に出す桁で取る（0.1325 − 0.1475 → 表示 0.13 と 0.15 なら −0.02）
  const meetRows = [
    rec({
      raceId: "2026-09-19-01-01",
      boatNumber: 1,
      startTiming: 0.13,
      exhibitionRank: 4,
      exhibitionTime: 6.8,
    }),
    rec({
      raceId: "2026-09-20-01-01",
      boatNumber: 1,
      startTiming: 0.135,
      exhibitionRank: 2,
      exhibitionTime: 6.7,
    }),
  ];
  const baseRows = [
    rec({ raceId: "2026-09-01-02-01", boatNumber: 1, startTiming: 0.145 }),
    rec({ raceId: "2026-09-02-02-01", boatNumber: 1, startTiming: 0.15 }),
  ];
  const trend = m.buildMeetTrend(meetRows, [...baseRows, ...meetRows]);
  check(
    "buildMeetTrend: ST差は表示桁（小数2桁）に丸めてから引く（0.13 vs 0.15 → −0.02）",
    [trend.st.meetAvg, trend.st.baseAvg, trend.st.diff],
    [0.13, 0.15, -0.02],
  );
  check(
    "buildMeetTrend: 通常値の母数から今節の走を除く",
    [trend.st.meetN, trend.st.baseN],
    [2, 2],
  );
  check(
    "buildMeetTrend: 展示は順位の推移。負なら上向き",
    [
      trend.exhibition.first,
      trend.exhibition.last,
      trend.exhibition.diff,
      trend.exhibition.n,
    ],
    [4, 2, -2, 2],
  );
  check(
    "buildMeetTrend: 展示が1走だけなら推移ではないので差は null",
    m.buildMeetTrend([meetRows[0]], meetRows).exhibition.diff,
    null,
  );
  check(
    "buildMeetTrend: 今節0走でも落ちない（差は null）",
    [
      m.buildMeetTrend([], baseRows).st.diff,
      m.buildMeetTrend(null, null).exhibition.n,
    ],
    [null, 0],
  );

  // --- periodsEndedBefore（BOA-326）
  check(
    "periodsEndedBefore: 5〜10月のレースの前期は (Y,2)、そこから4期さかのぼる",
    m.periodsEndedBefore("2026-09-29", 4),
    [
      {
        periodYear: 2026,
        periodNo: 2,
        calcFrom: "2025-11-01",
        calcTo: "2026-04-30",
      },
      {
        periodYear: 2026,
        periodNo: 1,
        calcFrom: "2025-05-01",
        calcTo: "2025-10-31",
      },
      {
        periodYear: 2025,
        periodNo: 2,
        calcFrom: "2024-11-01",
        calcTo: "2025-04-30",
      },
      {
        periodYear: 2025,
        periodNo: 1,
        calcFrom: "2024-05-01",
        calcTo: "2024-10-31",
      },
    ],
  );
  check(
    "periodsEndedBefore: 期の境目（4/30・5/1・10/31・11/1・1月）",
    ["2026-04-30", "2026-05-01", "2026-10-31", "2026-11-01", "2027-01-15"].map(
      (d) => {
        const [p] = m.periodsEndedBefore(d, 1);
        return `${p.periodYear}-${p.periodNo}`;
      },
    ),
    ["2026-1", "2026-2", "2026-2", "2027-1", "2027-1"],
  );
  check(
    "periodsEndedBefore: 日付が無い・壊れていれば空",
    [m.periodsEndedBefore("", 4), m.periodsEndedBefore(null, 4)],
    [[], []],
  );

  // --- pickPeriodStats
  const RD = "2026-09-29"; // 前期 = (2026,2)、直近2年 = (2025,1)〜(2026,2)
  const ok = (rows) => ({ rows, latestImported: true });
  check(
    "pickPeriodStats: 該当選手が無い・取得結果が権限エラー（state付き）なら null",
    [
      m.pickPeriodStats(
        ok([{ racer_id: 1, period_year: 2026, period_no: 2 }]),
        2,
        RD,
      ),
      m.pickPeriodStats({ state: "forbidden", rows: [] }, 1, RD),
    ],
    [null, null],
  );
  check(
    "pickPeriodStats: 前期を取り込み済みなのにその選手の前期が無ければ、古い期があっても null（選手ごとの欠けでは前々期に切り替えない）",
    m.pickPeriodStats(
      ok([
        { racer_id: 1, period_year: 2026, period_no: 1, finals: 3, wins: 1 },
      ]),
      1,
      RD,
    ),
    null,
  );
  check(
    "pickPeriodStats: 出走0の新人（win_rate=NULL）は null のまま（0 にしない）",
    m.pickPeriodStats(
      ok([
        {
          racer_id: 4320,
          period_year: 2026,
          period_no: 2,
          win_rate: null,
          top2_rate: 0,
          starts: 0,
          finals: 0,
          wins: 0,
        },
      ]),
      4320,
      RD,
    ),
    {
      winRate: null,
      top2Rate: 0,
      avgSt: null,
      starts: 0,
      calcFrom: null,
      calcTo: null,
      finals: 0,
      wins: 0,
      recent: { finals: 0, wins: 0, from: "2024-05-01", to: "2026-04-30" },
      fallback: false,
      pending: null,
    },
  );
  // 2026-09-29 13場12R 1号艇 馬場貴也（4262）の本番値。前期 優出5・優勝1、直近2年 優出22・優勝6
  // （racer_period_stats の各期の値をそのまま。2026-10-02 に本番から取得）
  const baba = [
    [2026, 2, 5, 1],
    [2026, 1, 5, 3],
    [2025, 2, 6, 0],
    [2025, 1, 6, 2],
    [2024, 2, 6, 3], // 範囲外（2年より前）。足さない
  ].map(([py, pn, finals, wins]) => ({
    racer_id: 4262,
    period_year: py,
    period_no: pn,
    finals,
    wins,
  }));
  const babaPicked = m.pickPeriodStats(
    ok([
      ...baba,
      { racer_id: 9999, period_year: 2026, period_no: 2, finals: 50, wins: 50 },
    ]),
    4262,
    RD,
  );
  check(
    "pickPeriodStats: 前期の優出・優勝と、前期を含む4期の合計（範囲外の期・他の選手は足さない）",
    [
      babaPicked.finals,
      babaPicked.wins,
      babaPicked.recent,
      babaPicked.fallback,
    ],
    [
      5,
      1,
      { finals: 22, wins: 6, from: "2024-05-01", to: "2026-04-30" },
      false,
    ],
  );

  // 期替わり直後（2026-11-05）: 前期 (2027,1)=2026-05-01〜10-31 の fan がまだ公開されていない
  const RD_NOV = "2026-11-05";
  const fb = m.pickPeriodStats(
    { rows: baba, latestImported: false },
    4262,
    RD_NOV,
  );
  check(
    "pickPeriodStats: 前期を表として取り込んでいなければ、前々期と、前々期で終わる4期の合計を出し、公開待ちの期を返す",
    [fb.fallback, fb.finals, fb.wins, fb.recent, fb.pending],
    [
      true,
      5,
      1,
      // (2026,2)〜(2025,1) の4期。(2024,2) は範囲外
      { finals: 22, wins: 6, from: "2024-05-01", to: "2026-04-30" },
      { calcFrom: "2026-05-01", calcTo: "2026-10-31" },
    ],
  );
  check(
    "pickPeriodStats: 取り込み済み（latestImported=true）なら、前期の行が無い選手は前々期に切り替えず null",
    m.pickPeriodStats({ rows: baba, latestImported: true }, 4262, RD_NOV),
    null,
  );
  check(
    "pickPeriodStats: 前々期の行も無ければ null（前々々期までは遡らない）",
    m.pickPeriodStats(
      {
        rows: [
          { racer_id: 1, period_year: 2026, period_no: 1, finals: 1, wins: 0 },
        ],
        latestImported: false,
      },
      1,
      RD_NOV,
    ),
    null,
  );
}

// ---------------------------------------------------------------------------
// 2. raceStatus.js
// ---------------------------------------------------------------------------
function suiteRaceStatus(m, check) {
  const { RACE_STATUS: S, getRaceStatus } = m;
  check(
    "getRaceStatus: 過去日付ビュー（nowHHMM=null）で結果が無いレースは UPCOMING（1a91058b）",
    getRaceStatus({ startTime: "10:30" }, null),
    S.UPCOMING,
  );
  check(
    "getRaceStatus: 結果確定は時刻に関わらず FINISHED",
    [
      getRaceStatus({ startTime: "10:30", result: { finished: true } }, null),
      getRaceStatus(
        { startTime: "23:59", result: { finished: true } },
        "08:00",
      ),
    ],
    [S.FINISHED, S.FINISHED],
  );
  check(
    "getRaceStatus: 本日ビューで startTime 欠損は UPCOMING（終了扱いにしない、94ffcb99）",
    [
      getRaceStatus({}, "15:00"),
      getRaceStatus({ startTime: "" }, "15:00"),
      getRaceStatus(null, "15:00"),
    ],
    [S.UPCOMING, S.UPCOMING, S.UPCOMING],
  );
  check(
    "getRaceStatus: 締切前は UPCOMING、締切時刻ちょうど以降は AWAITING_RESULT",
    [
      getRaceStatus({ startTime: "15:01" }, "15:00"),
      getRaceStatus({ startTime: "15:00" }, "15:00"),
      getRaceStatus({ startTime: "09:59" }, "15:00"),
    ],
    [S.UPCOMING, S.AWAITING_RESULT, S.AWAITING_RESULT],
  );
}

// ---------------------------------------------------------------------------
// 3. courseGridStats.js
// ---------------------------------------------------------------------------
function suiteCourseGridStats(m, check) {
  const records = [
    // 1号艇で2コースに入った走（艇番ではなく実進入コースで数える）
    rec({
      raceId: "2026-09-10-04-01",
      boatNumber: 1,
      actualCourse: 2,
      ranks: [1, 2, 3],
    }),
    rec({
      raceId: "2026-09-11-04-01",
      boatNumber: 2,
      actualCourse: 2,
      ranks: [1, 3, 4],
    }),
    rec({
      raceId: "2026-09-12-04-01",
      boatNumber: 3,
      actualCourse: 3,
      ranks: [3, 1, 2],
    }),
    // 実進入コースが取れていない走（2025-12-04以前・当日）
    rec({
      raceId: "2026-09-13-04-01",
      boatNumber: 1,
      actualCourse: null,
      ranks: [1, 2, 3],
    }),
    rec({
      raceId: "2026-09-14-04-01",
      boatNumber: 1,
      actualCourse: null,
      ranks: [1, 2, 3],
    }),
  ];

  // de872e51: course が数値でないときに actualCourse===null の走を「今日のコース」として数えていた
  const nullCourse = m.buildTodayCourseRows(records, {
    venueCode: 4,
    course: null,
  });
  check(
    "buildTodayCourseRows: 想定コースが null なら全行 n=0（actualCourse=null の走を数えない、de872e51）",
    nullCourse.map((r) => r.n),
    [0, 0, 0, 0, 0, 0],
  );
  check(
    "buildTodayCourseRows: 想定コースが undefined でも同じ",
    m.buildTodayCourseRows(records, { venueCode: 4, course: undefined })[0]
      .metrics,
    { winRate: null, top2Rate: null, top3Rate: null },
  );
  const today2 = m.buildTodayCourseRows(records, {
    venueCode: 4,
    course: 2,
  })[0];
  check(
    "buildTodayCourseRows: 実進入2コースの2走（艇番1と2）で3指標を同時に出す",
    [
      today2.n,
      today2.metrics.winRate,
      today2.metrics.top2Rate,
      today2.metrics.top3Rate,
    ],
    [2, 50, 50, 50],
  );

  const grid = m.buildCourseGrid(records, { venueCode: 4, metric: "winRate" });
  check(
    "buildCourseGrid: 列は艇番ではなく実進入コース。null の走はどの列にも入らない",
    grid[0].cells.map((c) => c.n),
    [0, 2, 1, 0, 0, 0],
  );
  check(
    "buildCourseGrid: n=0 のセルは value=null（0% と区別する）",
    [grid[0].cells[0].value, grid[0].cells[2].value],
    [null, 100],
  );

  check(
    "computeWakuNariRate: 実進入コースが取れた走だけを母数にする",
    m.computeWakuNariRate(records),
    { rate: (2 / 3) * 100, n: 3 },
  );
  check("computeWakuNariRate: 0件は null", m.computeWakuNariRate([]), {
    rate: null,
    n: 0,
  });

  check(
    "getCourseRecentRuns: 実進入コースで絞り、古い順（帯の「古い→新しい」と同じ向き。BOA-601）",
    m
      .getCourseRecentRuns(records, {
        venueCode: 4,
        rowKey: "current",
        course: 2,
      })
      .map((r) => r.raceId),
    ["2026-09-10-04-01", "2026-09-11-04-01"],
  );
  // 同じ日の2走は、records が日付だけで並んでいても R の順にそろえる（ファン評価2周目）
  check(
    "getCourseRecentRuns: 同じ日の2走は R の小さい順（入力が日の中で逆順でも）",
    m
      .getCourseRecentRuns(
        [
          rec({ raceId: "2026-09-12-04-09", boatNumber: 2, actualCourse: 2 }),
          rec({ raceId: "2026-09-12-04-04", boatNumber: 2, actualCourse: 2 }),
        ],
        { venueCode: 4, rowKey: "current", course: 2 },
      )
      .map((r) => r.raceId),
    ["2026-09-12-04-04", "2026-09-12-04-09"],
  );
  // 「直近1ヶ月」の起点をレースの日にそろえる（BOA-603）。今日（2026-10-01）を
  // 起点にすると、9/5 のレースでは 8/10 の走が期間の外に落ちる
  const periodRecs = [
    rec({ raceId: "2026-08-10-04-01", boatNumber: 2, actualCourse: 2 }),
    rec({ raceId: "2026-09-03-04-01", boatNumber: 2, actualCourse: 2 }),
  ];
  check(
    "getCourseRecentRuns: 直近1ヶ月の起点に now（レースの日）を使う",
    [
      m
        .getCourseRecentRuns(periodRecs, {
          venueCode: 4,
          rowKey: "last1m",
          course: 2,
          now: new Date("2026-09-05T12:00:00+09:00"),
        })
        .map((r) => r.raceId),
      m
        .getCourseRecentRuns(periodRecs, {
          venueCode: 4,
          rowKey: "last1m",
          course: 2,
          now: new Date("2026-10-01T12:00:00+09:00"),
        })
        .map((r) => r.raceId),
    ],
    // 古い順（BOA-601。帯の左が古い）
    [["2026-08-10-04-01", "2026-09-03-04-01"], ["2026-09-03-04-01"]],
  );
}

// ---------------------------------------------------------------------------
// 4. venueDayTrend.js
// ---------------------------------------------------------------------------
function suiteVenueDayTrend(m, check) {
  // e1dad236: 上位3件で打ち切っていたため「確定12Rの決まり手は 逃げ4・差し3・まくり2」＝合計9
  // になっていた（桐生2026-08-11の実例）
  const summary = {
    raceCount: 12,
    nigeRate: 33.3,
    techniqueCounts: { 逃げ: 4, 差し: 3, まくり: 2, 抜き: 2, まくり差し: 1 },
    byRace: {},
  };
  const trend = m.buildDayTrend(summary);
  check(
    "buildDayTrend: 決まり手を打ち切らない（5種類なら5種類、e1dad236）",
    trend.techniques.length,
    5,
  );
  check(
    "buildDayTrend: 並べた決まり手の合計＝techniqueTotal（桐生2026-08-11で 9≠12 になった）",
    [trend.techniques.reduce((a, t) => a + t.count, 0), trend.techniqueTotal],
    [12, 12],
  );
  check(
    "sortTechniqueCounts: 同数は名前順で決める（行順に依存させない）",
    m
      .sortTechniqueCounts({ 差し: 2, まくり: 2, 逃げ: 3 })
      .map((t) => t.technique),
    ["逃げ", "まくり", "差し"],
  );
  check("sortTechniqueCounts: null は空", m.sortTechniqueCounts(null), []);

  const byRace = {
    "2026-09-23-01-01": { winningTechnique: "逃げ" },
    "2026-09-23-01-02": { winningTechnique: "まくり" },
    "2026-09-23-01-03": { winningTechnique: "逃げ" },
    "2026-09-23-01-05": { winningTechnique: "逃げ", winnerCourse: null },
    "2026-09-23-01-10": { winningTechnique: "逃げ" },
    "2026-09-23-01-11": { winningTechnique: null },
  };
  check(
    "techniqueOrdinal: 当該レースより前の同じ決まり手の数+1（後のレースは数えない）",
    m.techniqueOrdinal(byRace, "2026-09-23-01-05"),
    3,
  );
  check(
    "techniqueOrdinal: 10R は 01〜09R の後（race_id の固定長で辞書順＝レース番号順）",
    m.techniqueOrdinal(byRace, "2026-09-23-01-10"),
    4,
  );
  check(
    "techniqueOrdinal: 決まり手が無ければ null",
    [
      m.techniqueOrdinal(byRace, "2026-09-23-01-11"),
      m.techniqueOrdinal(byRace, "2026-09-23-01-12"),
    ],
    [null, null],
  );
  check(
    "buildDayTrend: このレースの決まり手・何本目・コース（当日は null）",
    m.buildDayTrend({ ...summary, byRace }, "2026-09-23-01-05").thisRace,
    { technique: "逃げ", course: null, ordinal: 3 },
  );
  check(
    "buildDayTrend: 空の summary でも落ちない",
    m.buildDayTrend(undefined),
    {
      raceCount: 0,
      techniqueTotal: 0,
      nigeRate: null,
      techniques: [],
      thisRace: null,
    },
  );
}

// ---------------------------------------------------------------------------
// 5. weatherInfo.js
// ---------------------------------------------------------------------------
function suiteWeatherInfo(m, check) {
  check(
    "formatObservedTime: UTC の ISO 文字列を JST の HH:MM にする（0aab1d3d）",
    m.formatObservedTime("2026-09-20T01:05:00Z"),
    "10:05",
  );
  check(
    "formatObservedTime: JST 0時台は 00:MM（24:MM にしない）",
    m.formatObservedTime("2026-09-19T15:07:00Z"),
    "00:07",
  );
  check(
    "formatObservedTime: 無い・時刻として読めない値は null（例外にしない）",
    [
      m.formatObservedTime(null),
      m.formatObservedTime(""),
      m.formatObservedTime("not-a-date"),
    ],
    [null, null, null],
  );
  const t = (key, fallback) => `${key}|${fallback}`;
  check(
    "translateWeather / translateWindDirection: 既知は i18n キー、未知はそのまま返す",
    [
      m.translateWeather(t, "晴"),
      m.translateWeather(t, "霧"),
      m.translateWindDirection(t, "北北東"),
      m.translateWindDirection(t, "無風"),
    ],
    [
      "beforeInfo.weather.sunny|晴",
      "霧",
      "beforeInfo.windDirection.nne|北北東",
      "無風",
    ],
  );
}

// ---------------------------------------------------------------------------
// 6. dateUtils.js
// ---------------------------------------------------------------------------
function suiteDateUtils(m, check) {
  // isRaceBeforeTodayJST（BOA-608）: 過去のレースだけ「今日時点の集計」と注記する
  const noon = new Date("2026-10-01T12:00:00+09:00");
  check(
    "isRaceBeforeTodayJST: 前日以前は true、今日と読めない race_id は false",
    [
      m.isRaceBeforeTodayJST("2026-09-30-09-05", noon),
      m.isRaceBeforeTodayJST("2026-10-01-09-05", noon),
      m.isRaceBeforeTodayJST(null, noon),
      m.isRaceBeforeTodayJST("abc", noon),
    ],
    [true, false, false, false],
  );

  // --- isWithinDays: ブログ一覧（src/pages/Blog.jsx）の NEW バッジ（7日以内）（BOA-554）
  // 「JST の今日を含む直近7日」= JST 2026-09-29 なら 09-23〜09-29。09-22 と未来の 09-30 は含めない。
  // new Date("YYYY-MM-DD") は UTC 0時なので、JST にずらした現在時刻との差は実行環境の TZ に
  // 依存しない。JST 早朝（UTC では前日）と昼の両方で、古い側・新しい側の境界の前後を見る
  const dates = [
    "2026-09-21",
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-28",
    "2026-09-29",
    "2026-09-30",
  ];
  for (const [label, iso] of [
    ["JST 03:00（UTC 前日 18:00）", "2026-09-28T18:00:00Z"],
    ["JST 12:00（UTC 同日 03:00）", "2026-09-29T03:00:00Z"],
  ]) {
    check(
      `isWithinDays: ${label} の7日以内は JST 09-23〜09-29（6日前〜今日）。7日前・明日は含めない（BOA-554）`,
      dates.filter((d) => m.isWithinDays(d, 7, new Date(iso))),
      ["2026-09-23", "2026-09-24", "2026-09-28", "2026-09-29"],
    );
  }
  check("isWithinDays: 日付が空なら false", m.isWithinDays("", 7), false);
}

// --- prevResult（BOA-569 → BOA-610）: 今節の前走の読み方。
// 前走は同じ会場・同じ節でこのレースより前の最後の走（race_results の1行と本番STの記号）
function suitePrevResult(m, check) {
  // 2026-09-29 児島10R の5号艇 西村拓也: 4コースから2着。race_results の course_1〜6 は
  // 1〜6 のまま（進入順を表していない）。本番STの entry_course と actual_course_5 が 4
  const result = {
    rank1: 1,
    rank2: 5,
    rank3: 3,
    rank4: 4,
    rank5: 2,
    rank6: 6,
    course_1: 1,
    course_2: 2,
    course_3: 3,
    course_4: 4,
    course_5: 5,
    course_6: 6,
    actual_course_4: 5,
    actual_course_5: 4,
  };
  const prev = {
    boat_number: 1,
    raceId: "2026-09-29-16-10",
    boatNumber: 5,
    result,
    finishMark: "2",
    entryCourse: 4,
  };
  check(
    "meetPrevRunState: 着順と進入コース。進入は entry_course（course_N や枠番ではない。BOA-610 ファン評価1周目 P0）",
    m.meetPrevRunState(prev),
    { kind: "rank", rank: 2, course: 4, raceId: "2026-09-29-16-10" },
  );
  check(
    "meetPrevRunState: entry_course が無ければ actual_course_<艇番>、どちらも無ければ枠番で代用せず null",
    [
      m.meetPrevRunState({ ...prev, entryCourse: null }).course,
      m.meetPrevRunState({
        ...prev,
        entryCourse: null,
        result: { ...result, actual_course_5: null },
      }).course,
    ],
    [4, null],
  );
  check(
    "meetPrevRunState: 着順が付かない走は公式の記号。返還艇が着順の列にいても記号を先に見る（BOA-576）",
    [
      m.meetPrevRunState({ ...prev, finishMark: "Ｆ" }),
      m.meetPrevRunState({ ...prev, finishMark: "エ" }),
      m.meetPrevRunState({ ...prev, finishMark: "？" }),
    ],
    [
      {
        kind: "mark",
        mark: "F",
        markKey: "flying",
        course: 4,
        raceId: "2026-09-29-16-10",
      },
      {
        kind: "mark",
        mark: "エ",
        markKey: "engineStall",
        course: 4,
        raceId: "2026-09-29-16-10",
      },
      {
        kind: "mark",
        mark: "？",
        markKey: null,
        course: 4,
        raceId: "2026-09-29-16-10",
      },
    ],
  );
  check(
    "meetPrevRunState: 今節の走が無ければ「今節初戦」",
    m.meetPrevRunState({ boat_number: 1, firstOfMeet: true }),
    { kind: "firstOfMeet" },
  );
  check(
    "meetPrevRunState: 前走の結果がまだ無ければ結果待ち（その走のレースIDつき）。行が無い・艇が結果に無ければ不明（「今節初戦」にしない）",
    [
      m.meetPrevRunState({ ...prev, result: null, finishMark: null }),
      m.meetPrevRunState(null),
      m.meetPrevRunState({ ...prev, boatNumber: 7, finishMark: null }),
    ],
    [
      { kind: "pending", raceId: "2026-09-29-16-10" },
      { kind: "unknown" },
      { kind: "unknown" },
    ],
  );
  check(
    "meetPrevRunWhenParams: 前走の日付とR番号。形が違えば null",
    [
      m.meetPrevRunWhenParams("2026-09-29-16-10"),
      m.meetPrevRunWhenParams("2026-10-01-02-01"),
      m.meetPrevRunWhenParams("2026-09-29"),
      m.meetPrevRunWhenParams(null),
    ],
    [
      { month: 9, day: 29, race: 10 },
      { month: 10, day: 1, race: 1 },
      null,
      null,
    ],
  );
  check(
    "finishMarkKeyOf: 履歴表とデータ出走表で同じ key に引く。数字・空・知らない記号は null（BOA-569 ファン評価3周目）",
    [
      m.finishMarkKeyOf("エ"),
      m.finishMarkKeyOf("落"),
      m.finishMarkKeyOf("Ｌ"),
      m.finishMarkKeyOf("3"),
      m.finishMarkKeyOf(""),
      m.finishMarkKeyOf(null),
    ],
    ["engineStall", "fell", "late", null, null, null],
  );
}

/**
 * groupIntoMeetBeforeRace（BOA-591）。直前情報タブの今節展示情報と今節タブが共有する
 * 「表示中レースより前の今節」の切り出し。入力は1選手分（モーター番号で引いた形）
 */
function suiteMeetGrouping(m, check) {
  const rows = (ids) => ids.map((race_id) => ({ race_id }));
  const ids = (xs) => xs.map((x) => x.race_id);
  const entries = rows([
    "2026-07-05-07-12", // 別会場・2ヶ月前（同じモーター番号）
    "2026-09-12-01-03", // 同じ会場の前節（間が空いている）
    "2026-09-17-16-03", // 別会場・地続き
    "2026-09-18-01-02", // 今節1日目
    "2026-09-19-01-08", // 今節2日目
    "2026-09-19-02-04", // 別会場・地続き
    "2026-09-20-01-01", // 今節3日目・表示中より前
    "2026-09-20-01-09", // 今節3日目・表示中より後
  ]);
  check(
    "groupIntoMeetBeforeRace: 同じ会場・同じ節で、表示中のレースより前だけ",
    ids(m.groupIntoMeetBeforeRace(entries, "2026-09-20-01-05")),
    ["2026-09-18-01-02", "2026-09-19-01-08", "2026-09-20-01-01"],
  );
  check(
    "groupIntoMeetBeforeRace: 節の初戦で、別会場の前の節を拾わない（2026-09-21 津1R）",
    ids(
      m.groupIntoMeetBeforeRace(
        rows(["2026-07-05-07-12", "2026-07-06-07-09"]),
        "2026-09-21-09-01",
      ),
    ),
    [],
  );
  check(
    "groupIntoMeetBeforeRace: 節の初戦で、同じ会場の前の節を拾わない",
    ids(m.groupIntoMeetBeforeRace(entries, "2026-09-26-01-01")),
    [],
  );
}

// --- horizontalScrollHintState: 横スクロールの手がかり（「›」・フェード）の出し方
// （#1130 ファン評価。全コース表で5px残りでも40pxのフェードと「›」が最後の列を覆い、
// 4px以下の残りでは何も出なかった）
function suiteHscrollHint(m, check) {
  const st = (scrollWidth, clientWidth, scrollLeft) =>
    m.horizontalScrollHintState({ scrollWidth, clientWidth, scrollLeft });
  check("hscroll: 収まっていれば何も出さない", st(300, 300, 0), {
    hasMore: false,
    hasLess: false,
  });
  check("hscroll: 残り1px以下は何も出さない", st(301, 300, 0), {
    hasMore: false,
    hasLess: false,
  });
  // 12px以下の残りで「›」を出さず細いフェードだけにしていた版では、380pxの枠別の全コース表で
  // 「(n=20)」が「(n=2」に読めた（BOA-735、ユーザー判断で境目を下げた）
  check("hscroll: 残り4pxでも「›」を出す", st(320, 316, 0), {
    hasMore: true,
    hasLess: false,
  });
  check("hscroll: 残り20pxは「›」を出す", st(336, 316, 0), {
    hasMore: true,
    hasLess: false,
  });
  check(
    "hscroll: 左に12px以下しか送っていなければ「‹」は出さない（PR #1192 ファン評価2周目）",
    st(320, 300, 3),
    { hasMore: true, hasLess: false },
  );
  check(
    "hscroll: 1回に送る幅は、固定の左の列を引いた見える幅の8割",
    [
      m.horizontalScrollStep({ clientWidth: 312, stickyWidth: 90 }),
      m.horizontalScrollStep({ clientWidth: 312, stickyWidth: 0 }),
      m.horizontalScrollStep({ clientWidth: 60, stickyWidth: 50 }),
    ],
    [178, 250, 40],
  );
  // 送る先を列の境目にそろえる（PR #1202 ファン評価2周目）。列の境目（固定の列を引いた位置）は 0・60・120・180・240
  const starts = [0, 60, 120, 180, 240];
  const snap = (current, step, direction, max = 263) =>
    m.snapScrollTarget({ current, step, direction, max, columnStarts: starts });
  check(
    "hscroll: 送る先は、目安（今の位置＋8割）を越えない、いちばん遠い列の境目",
    [
      snap(0, 218, 1),
      snap(120, 100, 1),
      snap(240, 100, -1),
      snap(180, 218, -1),
    ],
    [180, 180, 180, 0],
  );
  check(
    "hscroll: 1列も越えないときは次の列の境目、端を越えるときは端",
    [snap(0, 40, 1), snap(240, 40, 1), snap(200, 300, 1), snap(130, 5, -1)],
    [60, 263, 263, 120],
  );
  // 右端の位置も列の境目にそろえる余白（PR #1202 ファン評価3周目）
  check(
    "hscroll: 右端が列の途中なら、次の列の境目まで届く余白を足す",
    m.tailPaddingFor({ naturalMax: 126, columnStarts: [0, 60, 146, 220] }),
    20,
  );
  check(
    "hscroll: 右端がすでに列の境目、溢れが1px以下、先に列が無いときは足さない",
    [
      m.tailPaddingFor({ naturalMax: 146, columnStarts: [0, 60, 146, 220] }),
      m.tailPaddingFor({ naturalMax: 1, columnStarts: [0, 30] }),
      m.tailPaddingFor({ naturalMax: 300, columnStarts: [0, 60, 146, 220] }),
    ],
    [0, 0, 0],
  );
  check(
    "hscroll: 少しだけ（10px）溢れる表にも、次の列の境目まで届く余白を足す（BOA-735）",
    m.tailPaddingFor({ naturalMax: 10, columnStarts: [0, 30] }),
    20,
  );
  check("hscroll: 右端まで送ったら「›」は消え、「‹」が出る", st(357, 301, 56), {
    hasMore: false,
    hasLess: true,
  });
}

// --- nextOpenDate（BOA-225）: 非開催会場の次開催日。race_series の 2026-10-02 時点の形
function suiteNextOpenDate(m, check) {
  const today = "2026-10-02";
  const rows = [
    // 平和島: 期間中（最終日が翌日）。後ろに次の節があっても次開催は出さない
    { venue_code: 4, start_date: "2026-09-28", end_date: "2026-10-03" },
    { venue_code: 4, start_date: "2026-10-10", end_date: "2026-10-15" },
    // 桐生: 今日が節の最終日。期間中なので出さない
    { venue_code: 1, start_date: "2026-09-27", end_date: "2026-10-02" },
    // 戸田: 次の節が2つ。早い方
    { venue_code: 2, start_date: "2026-10-20", end_date: "2026-10-25" },
    { venue_code: 2, start_date: "2026-10-08", end_date: "2026-10-13" },
    // 常滑: 明日が初日
    { venue_code: 8, start_date: "2026-10-03", end_date: "2026-10-08" },
  ];
  const got = m.computeNextOpenDates(rows, today);
  check(
    "computeNextOpenDates: 期間中の会場（最終日を含む）は出さず、未来の節は最も早い開始日",
    Object.fromEntries([...got].sort((a, b) => a[0] - b[0])),
    { 2: "2026-10-08", 8: "2026-10-03" },
  );
  check(
    "computeNextOpenDates: 行が無ければ空",
    m.computeNextOpenDates([], today).size,
    0,
  );
  check(
    "formatMonthDay: ゼロ埋めしない M/D",
    m.formatMonthDay("2026-10-05"),
    "10/5",
  );
}

// --- pickHitPattern: 的中レースで見せる「当たった候補」（PR #1197 ファン評価3周目）
function suiteTurnPrediction(m, check) {
  const patterns = [
    { winnerCourse: 1, technique: "nige", probability: 0.44 },
    { winnerCourse: 2, technique: "makuri", probability: 0.09 },
    { winnerCourse: 2, technique: "sashi", probability: 0.07 },
  ];
  check(
    "pickHitPattern: 同じ艇の候補が複数あれば、実際の決まり手と同じ候補を選ぶ",
    m.pickHitPattern(patterns, 2, "差し"),
    patterns[2],
  );
  check(
    "pickHitPattern: 実際の決まり手の候補が無ければ、同じ艇の最初の候補",
    m.pickHitPattern(patterns, 2, "抜き"),
    patterns[1],
  );
  check(
    "pickHitPattern: 決まり手が分からないときも同じ艇の最初の候補",
    m.pickHitPattern(patterns, 2, null),
    patterns[1],
  );
  check(
    "pickHitPattern: 1着の艇の候補が無ければ null",
    m.pickHitPattern(patterns, 5, "まくり"),
    null,
  );
}

// --- volatilityDisplayValue: イン崩れ指数の表示の数値がラベルの境目をまたがない（PR #1186 ファン評価）
function suiteVolatilityLevel(m, check) {
  const show = (p) => [m.getVolatilityLevel(p), m.volatilityDisplayValue(p)];
  check("volatility: 0.6975 は標準で69（四捨五入の70にしない）", show(0.6975), [
    "standard",
    69,
  ]);
  check("volatility: 0.7037 はイン崩れ確率高で70", show(0.7037), ["high", 70]);
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

const SUITES = {
  nextOpenDate: suiteNextOpenDate,
  prevResult: suitePrevResult,
  basicInfoStats: suiteBasicInfoStats,
  raceStatus: suiteRaceStatus,
  courseGridStats: suiteCourseGridStats,
  venueDayTrend: suiteVenueDayTrend,
  weatherInfo: suiteWeatherInfo,
  dateUtils: suiteDateUtils,
  meetGrouping: suiteMeetGrouping,
  turnPrediction: suiteTurnPrediction,
  volatilityLevel: suiteVolatilityLevel,
  hscrollHint: suiteHscrollHint,
};

// ---------------------------------------------------------------------------
// 変異検証: 要を1つずつ壊したコピーで、同じ検証が失敗すること
// ---------------------------------------------------------------------------
// [対象, 名前, 置換元, 置換先]。置換元が見つからなければ（元ファイルが変わった）失敗にする
const MUTANTS = [
  [
    "hscrollHint",
    "右端に余白を足さない（PR #1202 ファン評価3周目の退行）",
    "return next === undefined ? 0 : Math.ceil(next - naturalMax);",
    "return 0;",
  ],
  [
    "hscrollHint",
    "送る先を列の境目にそろえない（PR #1202 ファン評価2周目の退行）",
    "if (within.length > 0) return within[within.length - 1];",
    "if (within.length > 0) return raw;",
  ],
  [
    "turnPrediction",
    "実際の決まり手を見ずに、同じ艇の最初の候補を選ぶ（PR #1197 ファン評価3周目の退行）",
    "return exact ?? sameBoat[0] ?? null;",
    "return sameBoat[0] ?? null;",
  ],
  [
    "volatilityLevel",
    "表示の数値をラベルの範囲に収めない（PR #1186 ファン評価の退行）",
    "return Math.min(Math.max(value, 31), 69);",
    "return value;",
  ],
  [
    "hscrollHint",
    "送る幅から固定の左の列を引かない（PR #1192 ファン評価2周目の退行）",
    "Math.round((clientWidth - stickyWidth) * 0.8)",
    "Math.round(clientWidth * 0.8)",
  ],
  [
    "hscrollHint",
    "少しだけ溢れるときに「›」を出さない（BOA-735 の退行）",
    "hasMore: remaining > HSCROLL_MORE_MIN,",
    "hasMore: remaining > 12,",
  ],
  [
    "hscrollHint",
    "「‹」を指が少し触れただけで出す（PR #1192 ファン評価2周目の退行）",
    "export const HSCROLL_LESS_MIN = 12;",
    "export const HSCROLL_LESS_MIN = 1;",
  ],
  [
    "hscrollHint",
    "少しだけ溢れる表に右の余白を足さない（BOA-735 の退行）",
    "if (naturalMax <= HSCROLL_MORE_MIN) return 0;",
    "if (naturalMax <= 12) return 0;",
  ],
  [
    "basicInfoStats",
    "枠番に実進入コースを出す（57a9b159 の退行）",
    "boatNumber: r.boatNumber,",
    "boatNumber: r.actualCourse ?? r.boatNumber,",
  ],
  [
    "basicInfoStats",
    "4着の判定を外す（d3817581 の退行）",
    "if (r.rank4 === r.boatNumber) return 4;",
    "",
  ],
  [
    "basicInfoStats",
    "レース名を null 固定に戻す（6a126cb8 の退行）",
    "raceTitle: r.raceTitle,",
    "raceTitle: null,",
  ],
  [
    "meetGrouping",
    "今節を日付単位で切る（桐生5Rの退行）",
    "e.race_id < beforeRaceId,",
    "e.race_id.slice(0, 10) <= beforeRaceId.slice(0, 10),",
  ],
  [
    "meetGrouping",
    "今節の会場絞り込みを外す（BOA-591 の退行）",
    "e.race_id.slice(11, 13) === venue &&",
    "",
  ],
  [
    "meetGrouping",
    "表示中のレースを目印に足さない（BOA-591 の退行）",
    "groupIntoCurrentMeet([...upto, ANCHOR])",
    "groupIntoCurrentMeet(upto)",
  ],
  [
    "basicInfoStats",
    "条件別の平均STの母数を全走数にする",
    'metric === "avgSt" ? rates.avgStN : rates.n',
    "rates.n",
  ],
  [
    "basicInfoStats",
    "F数 null を F無し時に混ぜる",
    'typeof r.fCount === "number"',
    "true",
  ],
  [
    "basicInfoStats",
    "波の閾値を > にする",
    "r.waveHeight >= ROUGH_WAVE_CM",
    "r.waveHeight > ROUGH_WAVE_CM",
  ],
  [
    "basicInfoStats",
    "取得失敗を n=0 に化けさせる",
    "return rows.every((r) => r[field] === undefined);",
    "return false;",
  ],
  [
    "basicInfoStats",
    "ST差を生値で引く",
    "round2(meetSt - baseSt)",
    "round2(meetRates.avgSt - baseRates.avgSt)",
  ],
  ["basicInfoStats", "通常値に今節を含める", "!meetIds.has(r.raceId)", "true"],
  [
    "basicInfoStats",
    "展示1走でも差を出す",
    "exhibitions.length >= 2 ? last - first",
    "exhibitions.length >= 1 ? last - first",
  ],
  [
    "basicInfoStats",
    "平均STに null を混ぜる",
    "if (r.startTiming !== null && r.startTiming !== undefined) {",
    "if (true) {",
  ],
  [
    "basicInfoStats",
    "会場ランキングの平均STを降順にする",
    'return metric === "avgSt" ? av - bv : bv - av;',
    "return bv - av;",
  ],
  [
    "basicInfoStats",
    "会場ランキングの平均STの母数を n にする",
    'metric === "avgSt" ? row.avgStN >= 5 : row.n >= 5',
    "row.n >= 5",
  ],
  [
    "basicInfoStats",
    "G2 を SG・G1 に入れる",
    'raceGrade === "SG" || raceGrade === "G1"',
    'raceGrade === "SG" || raceGrade === "G1" || raceGrade === "G2"',
  ],
  [
    "basicInfoStats",
    "期間の境界を toISOString（UTC）で切る（BOA-469 の退行）",
    "const cutoffStr = getDaysAgoJST(days, now);",
    'const cutoff = new Date(now);\n    cutoff.setDate(cutoff.getDate() - days);\n    const cutoffStr = cutoff.toISOString().split("T")[0];',
  ],
  [
    "raceStatus",
    "過去日付ビューを結果反映待ちにする（1a91058b の退行）",
    "if (nowHHMM == null) return RACE_STATUS.UPCOMING;",
    "if (nowHHMM == null) return RACE_STATUS.AWAITING_RESULT;",
  ],
  [
    "raceStatus",
    "startTime 欠損の保護を外す（94ffcb99 の退行）",
    "if (!race?.startTime) return RACE_STATUS.UPCOMING;",
    "",
  ],
  [
    "raceStatus",
    "締切時刻ちょうどを締切前にする",
    "race.startTime > nowHHMM",
    "race.startTime >= nowHHMM",
  ],
  [
    "courseGridStats",
    "想定コース null を素通りさせる（de872e51 の退行）",
    "Number.isInteger(course) && ",
    "",
  ],
  [
    "courseGridStats",
    "グリッドを艇番で数える",
    "const inCourse = filtered.filter((r) => r.actualCourse === course);",
    "const inCourse = filtered.filter((r) => r.boatNumber === course);",
  ],
  [
    "courseGridStats",
    "枠なり率の母数に null を入れる",
    "(r) => r.actualCourse !== null && r.actualCourse !== undefined,",
    "(r) => true,",
  ],
  [
    "courseGridStats",
    "直近走を新しい順に戻す（BOA-601 の退行: 帯の「古い→新しい」と逆になる）",
    ".slice(-count)\n  );",
    ".slice(-count)\n      .reverse()\n  );",
  ],
  [
    "venueDayTrend",
    "決まり手を上位3件で打ち切る（e1dad236 の退行）",
    "sortTechniqueCounts(summary?.techniqueCounts);",
    "sortTechniqueCounts(summary?.techniqueCounts).slice(0, 3);",
  ],
  [
    "venueDayTrend",
    "同数のタイブレークを外す",
    " || a.technique.localeCompare(b.technique)",
    "",
  ],
  [
    "venueDayTrend",
    "後のレースも何本目に数える",
    "if (id >= raceId) continue;",
    "if (id === raceId) continue;",
  ],
  [
    "weatherInfo",
    "観測時刻を UTC で出す",
    'timeZone: "Asia/Tokyo",',
    'timeZone: "UTC",',
  ],
  [
    "weatherInfo",
    "読めない時刻の保護を外す",
    "if (Number.isNaN(date.getTime())) return null;",
    "",
  ],
  [
    "dateUtils",
    "isWithinDays を JST にずらさない（UTC の現在時刻と比べる）",
    "const jstNow = getJSTNow(now);\n  const diffMs",
    "const jstNow = now;\n  const diffMs",
  ],
  ["dateUtils", "isWithinDays の未来日の除外を外す", " && diffDays >= 0;", ";"],
  [
    "nextOpenDate",
    "節の期間中の会場にも次開催を出す",
    "for (const code of inSeries) next.delete(code);",
    "",
  ],
  [
    "nextOpenDate",
    "次の節の早い方を選ばない",
    "row.start_date < current",
    "row.start_date > current",
  ],
  [
    "prevResult",
    "今節の前走で記号を見ずに着順を出す（BOA-576 の退行）",
    "if (mark !== null && !/^[0-9]$/.test(mark)) {",
    "if (false) {",
  ],
  [
    "prevResult",
    "進入コースの代わりに艇番を出す（BOA-610 ファン評価1周目 P0 の退行）",
    "toCourse(entry.entryCourse) ??",
    "Number(boatNumber) ??",
  ],
];

const MUTANT_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "frontend-pure-mutants-"),
);

// 壊したコピーは一時ディレクトリに置く（src/ を汚さない）。相対 import は元ファイルの
// 場所から解決した絶対URLに書き換える
async function loadMutant(index, target, from, to) {
  const srcPath = path.join(ROOT, TARGETS[target]);
  const source = fs.readFileSync(srcPath, "utf8");
  if (!source.includes(from)) {
    throw new Error(
      `変異の対象が見つかりません（${TARGETS[target]}）: ${from.slice(0, 60)}`,
    );
  }
  const mutated = source
    .replace(from, to)
    .replace(/from "(\.{1,2}\/[^"]+)"/g, (_, spec) => {
      const href = pathToFileURL(
        path.resolve(path.dirname(srcPath), spec),
      ).href;
      return `from "${href}"`;
    });
  const file = path.join(MUTANT_DIR, `m${index}-${target}.mjs`);
  fs.writeFileSync(file, mutated);
  return import(pathToFileURL(file).href);
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------
let failures = 0;

for (const [target, suite] of Object.entries(SUITES)) {
  console.log(`\n## ${TARGETS[target]}`);
  const mod = await import(
    pathToFileURL(path.join(ROOT, TARGETS[target])).href
  );
  suite(mod, (label, actual, expected) => {
    const a = show(actual);
    const e = show(expected);
    if (a === e) {
      console.log(`✅ ${label}`);
    } else {
      failures++;
      console.error(`❌ ${label}\n  expected: ${e}\n  actual:   ${a}`);
    }
  });
}

console.log("\n## 変異検証");
for (const [i, [target, name, from, to]] of MUTANTS.entries()) {
  let killed = false;
  let detail = "検出されなかった（この変異を入れても検証が通る）";
  try {
    const mod = await loadMutant(i, target, from, to);
    let failed = 0;
    try {
      SUITES[target](mod, (_label, actual, expected) => {
        if (show(actual) !== show(expected)) failed++;
      });
    } catch {
      failed++; // 変異したモジュールが例外を投げた場合も検出とみなす
    }
    killed = failed > 0;
  } catch (error) {
    detail = error.message;
  }
  if (killed) {
    console.log(`✅ 変異検証（${target}）: 「${name}」を検出できる`);
  } else {
    failures++;
    console.error(`❌ 変異検証（${target}）: 「${name}」\n  ${detail}`);
  }
}

fs.rmSync(MUTANT_DIR, { recursive: true, force: true });

console.log(failures === 0 ? "\n✅ 全テスト成功" : `\n❌ ${failures}件失敗`);
process.exit(failures === 0 ? 0 : 1);
