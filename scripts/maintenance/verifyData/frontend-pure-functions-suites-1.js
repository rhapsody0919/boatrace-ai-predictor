/**
 * verify-frontend-pure-functions.js の検査の一部（suiteFinishPosition・suiteRaceStatus・suiteVenueDayTrend・suiteWeatherInfo・suiteDateUtils・suiteMeetGrouping・suiteNextOpenDate・suiteTurnPrediction）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { rec } from "./frontend-pure-functions-common.js";

// ---------------------------------------------------------------------------
// 0. finishPosition.js（src/pure。basicInfoStats.js から移した）
// ---------------------------------------------------------------------------
export function suiteFinishPosition(m, check) {
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
export function suiteRaceStatus(m, check) {
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
export function suiteVenueDayTrend(m, check) {
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
export function suiteWeatherInfo(m, check) {
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
export function suiteDateUtils(m, check) {
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
export function suiteMeetGrouping(m, check) {
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
export function suiteNextOpenDate(m, check) {
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
export function suiteTurnPrediction(m, check) {
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
