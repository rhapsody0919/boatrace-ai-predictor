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
 *   5. src/utils/weatherInfo.js（移す前は src/components/race/weatherInfo.js）… 気象の観測時刻の表示
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
import { show, rec } from "./verifyData/frontend-pure-functions-common.js";
import { suiteBasicInfoStats } from "./verifyData/frontend-pure-functions-basic-info1.js";
import { suiteCourseGridStats, suiteSixBoatCourseStats } from "./verifyData/frontend-pure-functions-course-six.js";
import { suitePrevResult, suiteHscrollHint, suiteVolatilityHighlights } from "./verifyData/frontend-pure-functions-prev-hscroll-vol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

// RA41（BOA-1501）で src/components/race から src/pure へ移す3本は、移す前後のどちらでも本体のある方を見る
// （移した後の元の場所は export * の殻で、変異の文字列が無いため）。移した後に元の場所の分岐は外す
const bodyOf = (pure, old) =>
  fs.existsSync(path.join(ROOT, pure)) ? pure : old;

const TARGETS = {
  motorMeetParts: "src/utils/motorMeetParts.js",
  meetStRank: "src/components/race/meetStRank.js",
  semifinalCount: "src/pure/semifinalCount.js",
  finishPosition: "src/pure/finishPosition.js",
  basicInfoStats: bodyOf(
    "src/pure/basicInfoStats.js",
    "src/components/race/basicInfoStats.js",
  ),
  raceStatus: "src/utils/raceStatus.js",
  courseGridStats: bodyOf(
    "src/pure/courseGridStats.js",
    "src/components/race/courseGridStats.js",
  ),
  sixBoatCourseStats: bodyOf(
    "src/pure/sixBoatCourseStats.js",
    "src/components/race/sixBoatCourseStats.js",
  ),
  venueDayTrend: "src/components/race/venueDayTrend.js",
  weatherInfo: bodyOf("src/utils/weatherInfo.js", "src/components/race/weatherInfo.js"),
  dateUtils: "src/utils/dateUtils.js",
  prevResult: "src/utils/prevResult.js",
  nextOpenDate: "src/utils/nextOpenDate.js",
  meetGrouping: "src/utils/meetGrouping.js",
  meetGroupingPure: "src/pure/meetGrouping.js",
  turnPrediction: "src/utils/turnPrediction.js",
  volatilityLevel: "src/utils/volatilityLevel.js",
  hscrollHint: "src/utils/horizontalScrollHint.js",
  volatilityHighlights: "src/utils/volatilityHighlights.js",
  inCautionLevel: "src/utils/inCautionLevel.js",
  cautionEvents: "src/utils/cautionEvents.js",
  inCautionAccuracy: "src/utils/inCautionAccuracy.js",
};

// ---------------------------------------------------------------------------
// 0. finishPosition.js（src/pure。basicInfoStats.js から移した）
// ---------------------------------------------------------------------------
function suiteFinishPosition(m, check) {
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
    "translateWeather / translateWindDirection: 既知は i18n キー、未知はそのまま返す。風向は会場ごとに本当の方位に直す（BOA-819: 徳山の「北西」は北、多摩川は回転0）、会場が分からなければ出さない",
    [
      m.translateWeather(t, "晴"),
      m.translateWeather(t, "霧"),
      m.translateWindDirection(t, "北北東", 5),
      m.translateWindDirection(t, "北西", 18),
      m.translateWindDirection(t, "無風", 18),
      m.translateWindDirection(t, "北西", null),
    ],
    [
      "beforeInfo.weather.sunny|晴",
      "霧",
      "beforeInfo.windDirection.nne|北北東",
      "beforeInfo.windDirection.n|北",
      "無風",
      null,
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

// --- pickHitPattern: 的中レースで見せる「当たった候補」（PR #1197、BOA-724 で確率の一番高い候補に）
function suiteTurnPrediction(m, check) {
  const patterns = [
    { winnerCourse: 1, technique: "nige", probability: 0.44 },
    { winnerCourse: 2, technique: "makuri", probability: 0.09 },
    { winnerCourse: 2, technique: "sashi", probability: 0.07 },
  ];
  check(
    "pickHitPattern: 同じ艇の候補が複数あっても、確率が一番高い候補（実際の決まり手では選ばない。BOA-724）",
    m.pickHitPattern(patterns, 2),
    patterns[1],
  );
  check(
    "pickHitPattern: 1号艇は本命の候補",
    m.pickHitPattern(patterns, 1),
    patterns[0],
  );
  check(
    "pickHitPattern: 1着の艇の候補が無ければ null",
    m.pickHitPattern(patterns, 5),
    null,
  );
  // isAsPredicted: 「予想通りの展開でした」を言ってよいか（BOA-724）
  const as = (
    predictedTechnique,
    actualTechnique,
    winnerBoat,
    winnerEntryCourse,
  ) =>
    m.isAsPredicted({
      predictedTechnique,
      actualTechnique,
      winnerBoat,
      winnerEntryCourse,
    });
  check(
    "isAsPredicted: 決まり手が同じで枠なりなら true",
    as("逃げ", "逃げ", 1, 1),
    true,
  );
  check(
    "isAsPredicted: 進入コースが分からなくても決まり手が同じなら true",
    as("差し", "差し", 2, null),
    true,
  );
  check(
    "isAsPredicted: 決まり手が違えば false",
    as("差し", "まくり", 2, 2),
    false,
  );
  check(
    "isAsPredicted: 艇番と違うコースから勝てば false（1号艇が2コースから）",
    as("逃げ", "逃げ", 1, 2),
    false,
  );
  check(
    "isAsPredicted: 2番手以下の候補が当たったときは false（本命は外れている）",
    m.isAsPredicted({
      predictedTechnique: "まくり",
      actualTechnique: "まくり",
      winnerBoat: 3,
      winnerEntryCourse: 3,
      isTopPick: false,
    }),
    false,
  );
  check(
    "isAsPredicted: 実際の決まり手が分からなければ false",
    as("逃げ", null, 1, 1),
    false,
  );
}

function suiteVolatilityLevel(m, check) {
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

// BOA-822 イン崩れ注意度の段・帯。帯の答えは Python の夜の集計（in_caution_bands.py）の pytest と同じ固定の入力
// （scripts/ml/analogy/tests/fixtures/in_caution_cases.json）で確かめる
const IN_CAUTION_CASES = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, "scripts/ml/analogy/tests/fixtures/in_caution_cases.json"),
    "utf8",
  ),
).gapCases;

// --- cautionEvents（BOA-822 task 27）: 注意度の GA4 イベント。生の % を送らず段のキーだけ、レース単位の面だけ race_id
function suiteCautionEvents(m, check) {
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
function suiteInCautionAccuracy(m, check) {
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

function suiteInCautionLevel(m, check) {
  for (const c of IN_CAUTION_CASES) {
    const [b1, ...others] = c.rates.map(m.rateCents);
    const top = others.filter((v) => v !== null);
    const gap = b1 === null || top.length === 0 ? null : b1 - Math.max(...top);
    check(`inCaution: ${c.name}`, [gap, m.bandOf(gap)], [c.gapCents, c.band]);
  }
  // 整数だけで四捨五入: 34.49% は 34、34.5% は 35（段は 35 から中くらい）、54.5% は 55（崩れやすい）
  const at = (nonWin, n) => [m.pctOf(nonWin, n), m.levelOf(m.pctOf(nonWin, n))];
  check("inCaution: 3449/10000 は 34%・堅め", at(3449, 10000), [34, "low"]);
  check("inCaution: 345/1000 は 35%・中くらい", at(345, 1000), [35, "mid"]);
  check("inCaution: 5449/10000 は 54%・中くらい", at(5449, 10000), [54, "mid"]);
  check("inCaution: 545/1000 は 55%・崩れやすい", at(545, 1000), [55, "high"]);
  check(
    "inCaution: 浮動小数で丸めるとずれる組（29/200=14.5%、57/200=28.5%、113/200=56.5%）も整数で四捨五入",
    [m.pctOf(29, 200), m.pctOf(57, 200), m.pctOf(113, 200)],
    [15, 29, 57],
  );
  check(
    "inCaution: 例のレース (other, −5) 22634/34842 は 65%・崩れやすい",
    at(22634, 34842),
    [65, "high"],
  );
  check(
    "inCaution: 件数0は null（0 で割らない）",
    [m.pctOf(0, 0), m.levelOf(null)],
    [null, null],
  );
  check(
    "inCaution: 帯の範囲（端は片側だけ）",
    [m.bandRange(-8), m.bandRange(-5), m.bandRange(0), m.bandRange(6)],
    [
      { from: null, to: -3.5 },
      { from: -2.5, to: -2 },
      { from: 0, to: 0.5 },
      { from: 3, to: null },
    ],
  );
  check(
    "inCaution: 符号の書き方（負は全角のマイナス、正は +、0 は符号なし）",
    [
      m.signedText(-2.12, 2),
      m.signedText(3, 1),
      m.signedText(0, 1),
      m.signedText(-0.5, 1),
    ],
    ["−2.12", "+3.0", "0.0", "−0.5"],
  );
  check(
    "inCaution: 1号艇の着順（rank1〜6 はその着の艇番、いなければ null）、日付の書き方",
    [
      m.boat1Rank({ rank1: 2, rank2: 1 }),
      m.boat1Rank({ rank1: 1 }),
      m.boat1Rank({
        rank1: 2,
        rank2: 3,
        rank3: 4,
        rank4: 5,
        rank5: 6,
        rank6: null,
      }),
      m.boat1Rank(null),
      m.slashDate("2019-04-01"),
      m.slashDate(null),
    ],
    [2, 1, null, null, "2019/4/1", ""],
  );
  check(
    "inCaution: ラウンド（準々・準優進出は other、空も other）",
    ["準優勝戦", "優勝戦", "予選", "準優進出戦", "", null].map(m.roundOf),
    ["junyu", "yusho", "other", "other", "other", "other"],
  );
}

// BOA-1155: 準優出は欠場を含む掲載回数。当社集計の開始日は呼び出し側が渡す。
function suiteSemifinalCount(m, check) {
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

function suiteMeetStRank(m, check) {
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

function suiteMotorMeetParts({ countMeetPartsChanges: count }, check) {
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

const SUITES = {
  motorMeetParts: suiteMotorMeetParts,
  meetStRank: suiteMeetStRank,
  semifinalCount: suiteSemifinalCount,
  nextOpenDate: suiteNextOpenDate,
  prevResult: suitePrevResult,
  finishPosition: suiteFinishPosition,
  basicInfoStats: suiteBasicInfoStats,
  raceStatus: suiteRaceStatus,
  courseGridStats: suiteCourseGridStats,
  sixBoatCourseStats: suiteSixBoatCourseStats,
  venueDayTrend: suiteVenueDayTrend,
  weatherInfo: suiteWeatherInfo,
  dateUtils: suiteDateUtils,
  meetGrouping: suiteMeetGrouping,
  meetGroupingPure: suiteMeetGrouping,
  turnPrediction: suiteTurnPrediction,
  volatilityLevel: suiteVolatilityLevel,
  hscrollHint: suiteHscrollHint,
  volatilityHighlights: suiteVolatilityHighlights,
  inCautionLevel: suiteInCautionLevel,
  cautionEvents: suiteCautionEvents,
  inCautionAccuracy: suiteInCautionAccuracy,
};

// ---------------------------------------------------------------------------
// 変異検証: 要を1つずつ壊したコピーで、同じ検証が失敗すること
// ---------------------------------------------------------------------------
// [対象, 名前, 置換元, 置換先]。置換元が見つからなければ（元ファイルが変わった）失敗にする
const MUTANTS = [
  ["motorMeetParts", "初日の交換を除外", "event.date >= from", "event.date > from"],
  ["motorMeetParts", "当日の交換を除外", "event.date <= to", "event.date < to"],
  ["motorMeetParts", "部品の順を逆転", "a.date.localeCompare(b.date)", "b.date.localeCompare(a.date)"],
  ["meetStRank", "当該レースを含める", "run.raceId < beforeRaceId", "run.raceId <= beforeRaceId"],
  ["meetStRank", "3走ちょうどを出さない", "n >= minRuns", "n > minRuns"],
  ["meetStRank", "同順位をなくす", "value < Math.round(row.avg * 1000)", "value <= Math.round(row.avg * 1000)"],
  ["sixBoatCourseStats", "件数の線ちょうどを警告にする",
    "entries < SIX_BOAT_WARN_ENTRIES[course]", "entries <= SIX_BOAT_WARN_ENTRIES[course]"],
  ["sixBoatCourseStats", "レース当日に終わる期を含める",
    "row.calc_to < raceDate", "row.calc_to <= raceDate"],
  [
    "semifinalCount",
    "開始日ちょうどを除外する",
    "row.race_date < startDate",
    "row.race_date <= startDate",
  ],
  [
    "semifinalCount",
    "欠場の準優出を除外する",
    "!row.race_id ||",
    "row.is_absent === true || !row.race_id ||",
  ],
  [
    "semifinalCount",
    "同じレースの重複を加算する",
    "counts.set(row.racer_id, races.size);",
    "counts.set(row.racer_id, (counts.get(row.racer_id) ?? 0) + 1);",
  ],
  [
    "inCautionAccuracy",
    "件数の少ない段にも割合を出す（公開直後に 1件で 100% が出る）",
    "n >= MIN_RATE_N ? wilsonInterval(nonWin, n) : null",
    "n > 0 ? wilsonInterval(nonWin, n) : null",
  ],
  [
    "inCautionLevel",
    "浮動小数で % を丸める（system-architect L5 の退行）",
    "return Math.floor((200 * nonWin + n) / (2 * n));",
    "return Math.round((nonWin / n) * 100);",
  ],
  [
    "inCautionLevel",
    "勝率 0.00 を勝率なしにする（design-reviewer 指摘4 の退行）",
    'if (rate === null || rate === undefined || rate === "") return null;',
    "if (!Number(rate)) return null;",
  ],
  [
    "inCautionLevel",
    "帯の下限で丸めない",
    "Math.max(Math.floor(gapCents / bandWidthCents), bandMin)",
    "Math.floor(gapCents / bandWidthCents)",
  ],
  [
    "inCautionLevel",
    "正の数に + を付けない（帯の端「+3.0以上」が「3.0以上」になる）",
    '${v < 0 ? "−" : "+"}',
    '${v < 0 ? "−" : ""}',
  ],
  [
    "inCautionLevel",
    "段の境目を以下にする（35% を堅めに入れる）",
    'if (pct < low) return "low";',
    'if (pct <= low) return "low";',
  ],
  [
    "volatilityHighlights",
    "並べる値の名前を見ずに percentile で並べる（BOA-822 の pct が並ばない）",
    ".sort((a, b) => b[key] - a[key] || byStartTime(a, b))",
    ".sort((a, b) => b.percentile - a.percentile || byStartTime(a, b))",
  ],
  [
    "volatilityHighlights",
    "同じ割合のレースを締切の順で並べない（PR #1602 レビュー、入力の順で5本目が決まる）",
    ".sort((a, b) => b[key] - a[key] || byStartTime(a, b))",
    ".sort((a, b) => b[key] - a[key])",
  ],
  [
    "volatilityHighlights",
    "締切済みのレースも締切前と一緒に選ぶ（BOA-757 の退行）",
    "const pool = allClosed ? races : open;",
    "const pool = races;",
  ],
  [
    "volatilityHighlights",
    "段階を見ずに崩れやすさの順で切る（PR #1248 ファン評価1周目の退行）",
    '.filter((r) => r.level === "high")',
    ".filter(() => true)",
  ],
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
    "2番手以下の候補が当たっても「予想通り」にする（BOA-724 A-2 (b) の退行）",
    "if (!isTopPick) return false;",
    "if (false) return false;",
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
    "端の手前の列の境目で止め、「‹」を2回押させる（BOA-742 の退行）",
    "if (direction < 0 && raw <= step / 4) return 0;",
    "if (direction < 0 && raw <= 0) return 0;",
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
    "finishPosition",
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
    "meetGroupingPure",
    "今節を日付単位で切る（桐生5Rの退行）",
    "e.race_id < beforeRaceId,",
    "e.race_id.slice(0, 10) <= beforeRaceId.slice(0, 10),",
  ],
  [
    "meetGroupingPure",
    "今節の会場絞り込みを外す（BOA-591 の退行）",
    "e.race_id.slice(11, 13) === venue &&",
    "",
  ],
  [
    "meetGroupingPure",
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
