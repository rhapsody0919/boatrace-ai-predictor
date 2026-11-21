/**
 * verify-race-result-parser.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { buildRaceResultRow, runForRaces } from "../../daily/scrape-results.js";
import * as realParser from "../../lib/raceResultParser.js";
import * as realRows from "../../lib/raceResultRows.js";
import { clearResultSchemaCache } from "../../lib/raceResultSchema.js";

let check, same, readFixture, full, RACES, fetchHtmlFor;

// ---------------------------------------------------------------------------
// (e) 書き込み経路: 077〜079の未適用・適用済みの両方
// ---------------------------------------------------------------------------

export const LEGACY_TIMING_COLUMNS = [
  "race_id",
  "boat_number",
  "start_timing",
  "is_flying",
  "is_late_start",
  "created_at",
  "updated_at",
];

export const NEW_TIMING_COLUMNS = [
  "finish_mark",
  "finish_rank",
  "entry_course",
  "race_seconds",
];

export const NEW_RESULT_COLUMNS = ["race_status", "refund_boats", "remark"];

export const PAYOUT_COLUMNS = [
  "race_id",
  "bet_type",
  "seq",
  "combination",
  "payout",
  "payout_status",
  "popularity",
  "created_at",
  "updated_at",
];

export const RACE_F4 = "2026-09-19-02-09";

export const RACE_ABSENT = "2026-09-16-23-12";

export async function runLive(
  db,
  races = RACES.filter(
    (r) => r.race_id === RACE_F4 || r.race_id === RACE_ABSENT,
  ),
) {
  clearResultSchemaCache(db);
  const outcomes = await runForRaces(races, {
    date: "2026-09-19",
    mode: "live",
    fetchHtml: fetchHtmlFor,
    client: db,
    now: () => new Date("2026-09-19T08:00:00Z"),
  });
  return outcomes;
}

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const f4 = full("raceresult-2026-09-19-02-09-refund-f4.html");
  const payout = (bet, seq = 1) =>
    f4.payouts.find((p) => p.bet_type === bet && p.seq === seq);
  check(
    "返還・不成立: 戸田9R（F4艇）で、単勝¥100・2連単1-2¥100（人気1）は払戻、3連単・3連複・2連複・拡連複・複勝は不成立（払戻なし）",
    payout("win").payout === 100 &&
      payout("win").payout_status === "paid" &&
      payout("2tan").combination === "1-2" &&
      payout("2tan").popularity === 1 &&
      ["3tan", "3fuku", "2fuku", "wide", "place"].every(
        (b) =>
          payout(b).payout_status === "no_race" && payout(b).payout === null,
      ),
  );
  const row = buildRaceResultRow("R", realRows.toLegacyResult(f4));
  check(
    "返還・不成立: 戸田9Rの race_results の行は、payout_trifecta(3連複)・payout_trio(3連単)が NULL（旧実装は100）、payout_win・payout_exacta は100",
    row.payout_trifecta === null &&
      row.payout_trio === null &&
      row.payout_win === 100 &&
      row.payout_exacta === 100,
  );
  const abs = full("raceresult-2026-09-16-23-12-absent.html");
  const absRow = buildRaceResultRow("R", realRows.toLegacyResult(abs));
  check(
    "BOA-362: 唐津12Rの1号艇（欠場）が rank6 に入らない（旧実装は rank6=1）。rank1〜5 は 2-3-5-6-4",
    absRow.rank6 === null &&
      same(
        [absRow.rank1, absRow.rank2, absRow.rank3, absRow.rank4, absRow.rank5],
        [2, 3, 5, 6, 4],
      ),
  );
  const nr = full("raceresult-2026-08-07-24-01-no-race-6f.html");
  check(
    "不成立: 6艇全てフライングのレースは全勝式が不成立で、race_results の払戻列が全て NULL",
    nr.race_status === "no_race" &&
      (() => {
        const r = buildRaceResultRow("R", realRows.toLegacyResult(nr));
        return [
          "payout_win",
          "payout_place_1",
          "payout_place_2",
          "payout_trifecta",
          "payout_trio",
          "payout_exacta",
          "payout_quinella",
          "payout_wide_1",
        ].every((c) => r[c] === null);
      })(),
  );
  const tk = full("raceresult-2026-09-17-13-11-tokubarai.html");
  check(
    "特払: 単勝は special（払戻70）、複勝の1着艇は no_amount（払戻NULL）。race_results の payout_win=70・payout_place_1=NULL（旧実装と同じ）",
    tk.payouts.find((p) => p.bet_type === "win").payout_status === "special" &&
      tk.payouts.find((p) => p.bet_type === "win").payout === 70 &&
      tk.payouts.find((p) => p.bet_type === "place" && p.seq === 1)
        .payout_status === "no_amount" &&
      (() => {
        const r = buildRaceResultRow("R", realRows.toLegacyResult(tk));
        return (
          r.payout_win === 70 &&
          r.payout_place_1 === null &&
          r.payout_place_2 === 150
        );
      })(),
  );
  return { tk };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ tk }) {
  // BOA-383: 2026-09-18 江戸川11R の2連複（特払70）が race_results で NULL だった。組番で引く勝式（2連単・2連複・
  // 拡連複・複勝）は、組番の無い特払を拾えなかった。同じフィクスチャの払戻を1勝式ずつ特払に置き換えて確かめる
  const asSpecial = (betType, seq) => ({
    ...tk,
    payouts: tk.payouts.map((p) =>
      p.bet_type === betType && p.seq === seq
        ? {
            ...p,
            combination: null,
            payout: 70,
            payout_status: "special",
            popularity: null,
          }
        : p,
    ),
  });
  const specialRow = (betType, seq) =>
    buildRaceResultRow("R", realRows.toLegacyResult(asSpecial(betType, seq)));
  // 複勝の特払: 1着艇（2号艇）の空欄を通常の払戻にし、2着艇（1号艇）を特払にする
  const placeSpecial = asSpecial("place", 2);
  const placeRow = buildRaceResultRow(
    "R",
    realRows.toLegacyResult({
      ...placeSpecial,
      payouts: placeSpecial.payouts.map((p) =>
        p.bet_type === "place" && p.seq === 1
          ? { ...p, payout: 110, payout_status: "paid" }
          : p,
      ),
    }),
  );
  check(
    "特払（組番で引く勝式）: 2連単・2連複・拡連複・複勝の特払70が、旧列にも入る（BOA-383。plan.md「特払は70（旧と同じ）」）",
    specialRow("2tan", 1).payout_exacta === 70 &&
      specialRow("2fuku", 1).payout_quinella === 70 &&
      specialRow("wide", 1).payout_wide_1 === 70 &&
      specialRow("wide", 1).payout_wide_2 === 320 &&
      specialRow("wide", 1).payout_wide_3 === 130 &&
      placeRow.payout_place_1 === 110 &&
      placeRow.payout_place_2 === 70,
  );
  check(
    "特払（複勝）: 組番で引けない艇が2つ（1着艇は空欄・2着艇は特払）なら、どちらの特払か区別できないので両方 NULL のまま（1着艇の空欄に70を入れない）",
    specialRow("place", 2).payout_place_1 === null &&
      specialRow("place", 2).payout_place_2 === null,
  );
  const wideAmbiguous = asSpecial("wide", 1);
  const wideRow = buildRaceResultRow(
    "R",
    realRows.toLegacyResult({
      ...wideAmbiguous,
      payouts: wideAmbiguous.payouts.filter(
        (p) => !(p.bet_type === "wide" && p.seq === 2),
      ),
    }),
  );
  check(
    "特払（拡連複）: 組番で引けない組が2つあれば、どちらにも特払の額を入れない（引ける組の 1-3=130 はそのまま）",
    wideRow.payout_wide_1 === null &&
      wideRow.payout_wide_2 === null &&
      wideRow.payout_wide_3 === 130,
  );
  const dh = full("raceresult-2025-12-11-17-01-dead-heat-1st.html");
  check(
    "同着: 1着同着の払戻は、3連単が2口（1-2-5=780円・2-1-5=2,430円）、単勝・複勝も2口。旧列（payout_trio）は先頭の1口だけ",
    dh.payouts.filter((p) => p.bet_type === "3tan").length === 2 &&
      dh.payouts.find((p) => p.bet_type === "3tan" && p.seq === 2).payout ===
        2430 &&
      dh.payouts.filter((p) => p.bet_type === "win").length === 2 &&
      buildRaceResultRow("R", realRows.toLegacyResult(dh)).payout_trio === 780,
  );
  const lt = full("raceresult-2026-06-01-05-05-late-start.html");
  const ltBoat = lt.boats.find((b) => b.boat_number === 2);
  return { lt, ltBoat };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ lt, ltBoat }) {
  check(
    "出遅れ: 着欄「Ｌ」（NFKCでL）の艇は、STが数値でなく（NULL）is_late_start=true・返還艇。旧実装はこの艇の行を作らなかった",
    ltBoat.finish_mark === "L" &&
      ltBoat.start_timing === null &&
      ltBoat.is_late_start === true &&
      lt.refund_boats.includes(2) &&
      realRows.buildTimingRows("R", realRows.toLegacyResult(lt), {
        extended: false,
      }).length === 4 &&
      realRows.buildTimingRows("R", realRows.toLegacyResult(lt), {
        extended: true,
      }).length === 6,
  );
  const sec = full("raceresult-2026-09-19-02-09-refund-f4.html").boats[0];
  check(
    `レースタイム: 1'50"7 は 110.7秒`,
    sec.race_seconds === 110.7 && sec.race_time === `1'50"7`,
  );
  check(
    "着欄の表記の種類: 実ページで確認した F・L・欠・落・転・沈・妨・エ・_（全角の「＿」）が FINISH_MARKS に定義されている",
    ["F", "L", "欠", "落", "転", "沈", "妨", "エ", "_"].every(
      (k) => realParser.FINISH_MARKS[k]?.observed === true,
    ),
  );
  check(
    "返還される艇: F・L・欠は返還、落・転・沈・妨・エは返還されない（実ページの返還表と一致）",
    ["F", "L", "欠"].every((k) => realParser.FINISH_MARKS[k].refunded) &&
      ["落", "転", "沈", "妨", "エ"].every(
        (k) => !realParser.FINISH_MARKS[k].refunded,
      ) &&
      same(
        full("raceresult-2026-09-10-05-12-fall-capsize-f.html").refund_boats,
        [6],
      ),
  );
}

function scene4() {
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
  // 未公開ページ・壊れたHTML
  {
    const none = realParser.parseRaceResultPage(
      readFixture("raceresult-unpublished-2026-09-25-05-01.html"),
    );
    check(
      "未公開ページ: 例外にせず空の項目を返し、旧形式への変換は null（着順・払戻が無い）",
      none.boats.length === 0 &&
        none.payouts.length === 0 &&
        none.race_status === null &&
        realRows.toLegacyResult(none) === null,
    );
    const weird = readFixture("raceresult-2026-09-19-05-01.html").replace(
      ">１</td>",
      ">怪</td>",
    );
    const w = realParser.parseRaceResultPage(weird);
    check(
      "未知の着欄の表記は、握りつぶさず anomalies に残す（着欄「怪」）",
      w.anomalies.some((a) => a.includes("怪")) &&
        w.boats[0].finish_mark === "怪" &&
        w.boats[0].finish_rank === null,
    );
    const weirdPayout = readFixture("raceresult-2026-09-19-05-01.html")
      .replace('<td rowspan="2">3連単</td>', '<td rowspan="2">3連単</td>')
      .replace(
        /<span class="numberSet1_number is-type1">1<\/span><span class="numberSet1_text">-<\/span><span class="numberSet1_number is-type6">6<\/span><span class="numberSet1_text">-<\/span><span class="numberSet1_number is-type2">2<\/span>/,
        "謎の表記",
      );
    const wp = realParser.parseRaceResultPage(weirdPayout);
    check(
      "未知の組番の表記は、握りつぶさず anomalies に残す",
      wp.anomalies.some((a) => a.includes("未知の組番")),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・readFixture・full） */
export function runRaceResultParserScenes2(env) {
  ({ check, same, readFixture, full } = env);
  scene4();
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・readFixture・full） */
export function runRaceResultParserScenes3(env) {
  ({ check, same, readFixture, full } = env);

}

/** verify から呼ぶ入口。env は verify 側の束縛（check・same・readFixture・full・RACES・fetchHtmlFor） */
export function runRaceResultParserScenes4(env) {
  ({ check, same, readFixture, full, RACES, fetchHtmlFor } = env);

}
