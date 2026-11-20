/**
 * verify-race-result-parser.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-race-result-parser.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  analyzeRaceFromDb,
  summarizeDbFindings,
  isRefundedKFinish,
  parseRaceId,
  kDayToRaceFacts,
  compareRaceWithKDay,
} from "../../lib/raceResultAudit.js";

let printOut, check, show, same, K190415_TEXT;

/** 元の verify の1つの塊 { } を割った 1/4 */
function scene1() {
  const base = {
    race_id: "2026-09-19-02-09",
    rank1: 1,
    rank2: 2,
    rank3: 3,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trio: 100,
    payout_trifecta: 100,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 3,
    actual_course_4: 4,
    actual_course_5: 6,
    actual_course_6: 5,
    fBoats: [3, 4, 5, 6],
  };
  const a = analyzeRaceFromDb(base);
  check(
    "監査（DBのみ）: F4艇のレース（rank1〜6=1〜6・3連単/3連複=100）を、rank4〜6の汚染・rank1〜3の汚染（完走2艇）・3連単100・疑いの払戻として検出",
    same(a.rank456Polluted, [4, 5, 6]) &&
      same(a.rank123Polluted, [3]) &&
      a.trio100 &&
      a.suspectPayoutColumns.length === 2 &&
      a.finishers === 2,
  );
  const abs = analyzeRaceFromDb({
    race_id: "2026-09-16-23-12",
    rank1: 2,
    rank2: 3,
    rank3: 5,
    rank4: 6,
    rank5: 4,
    rank6: 1,
    actual_course_1: null,
    actual_course_2: 1,
    actual_course_3: 2,
    actual_course_4: 3,
    actual_course_5: 4,
    actual_course_6: 5,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: BOA-362（唐津12R、欠場の1号艇が rank6）を absentInRanks=[6] として検出",
    same(abs.absentBoats, [1]) && same(abs.absentInRanks, [6]),
  );
  const ok = analyzeRaceFromDb({
    race_id: "2026-09-19-05-01",
    rank1: 1,
    rank2: 6,
    rank3: 2,
    rank4: 3,
    rank5: 5,
    rank6: 4,
    payout_trio: 1480,
    payout_trifecta: 330,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 4,
    actual_course_4: 5,
    actual_course_5: 6,
    actual_course_6: 3,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: 正常なレースは検出しない",
    ok.rank456Polluted.length === 0 &&
      ok.rank123Polluted.length === 0 &&
      !ok.trio100 &&
      ok.suspectPayoutColumns.length === 0,
  );
  return { a, abs, ok };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
function scene2({ a, abs, ok }) {
  const legit = analyzeRaceFromDb({
    race_id: "2026-06-25-22-07",
    rank1: 2,
    rank2: 1,
    rank3: 4,
    rank4: 3,
    rank5: 5,
    rank6: 6,
    payout_trio: 1020,
    payout_trifecta: 100,
    actual_course_1: 1,
    actual_course_2: 2,
    actual_course_3: 3,
    actual_course_4: 4,
    actual_course_5: 5,
    actual_course_6: 6,
    fBoats: [],
  });
  check(
    "監査（DBのみ）: 非完走艇の無いレースの3連複100円（低配当の正しい払戻）は、疑いにしない",
    legit.suspectPayoutColumns.length === 0 &&
      !legit.trio100 &&
      legit.trifecta100,
  );
  const sum = summarizeDbFindings([a, abs, ok, legit], 4);
  check(
    "監査の集計: 対象4件のうち、疑いは2件（F4艇・欠場）。月別・会場別の内訳を持つ",
    sum.flagged === 2 &&
      sum.flaggedByMonth["2026-09"] === 2 &&
      sum.flaggedByVenue["02"] === 1 &&
      sum.flaggedByVenue["23"] === 1,
  );
  // Kファイルの生の着欄と race_id の契約（範囲の判断が未定の入力は下の KNOWN_GAPS）
  for (const [input, expected] of [
    ["01", false], ["06", false], ["F", true],
    ["L", true], ["L0", true], ["L1", true],
    ["K", true], ["K0", true], ["K1", true],
    ["S0", false], ["S1", false], ["S2", false],
    ["F1", false], ["L10", false], ["K12", false],
    [" F", false], ["F ", false], ["f", false], ["Ｆ", false],
    ["", false], ["00", false], ["07", false], ["転", false],
  ]) {
    const actual = isRefundedKFinish(input);
    check(
      `isRefundedKFinish: ${show(input)} → ${expected}`,
      same(actual, expected),
      show({ actual, expected }),
    );
  }
  const refundedMarks = ["01", "F", "L0", "L1", "K0", "K1", "S0", "S1", "S2"]
    .filter(isRefundedKFinish);
  check(
    "isRefundedKFinish: 返還の集合は F・L0・L1・K0・K1（Sは返還しない）",
    same(refundedMarks, ["F", "L0", "L1", "K0", "K1"]),
    show(refundedMarks),
  );
  for (const [input, expected] of [
    ["2026-10-25-01-12", { date: "2026-10-25", venue: 1, race: 12 }],
    ["2026-10-25-24-01", { date: "2026-10-25", venue: 24, race: 1 }],
  ]) {
    const actual = parseRaceId(input);
    check(
      `parseRaceId: ${show(input)} → 日付・数値の会場とレース番号`,
      same(actual, expected),
      show({ actual, expected }),
    );
  }
}

/** 元の verify の1つの塊 { } を割った 3/4 */
function scene3() {
  for (const input of [
    "2026-10-25-1-12", "2026-10-25-01-1", "2026-10-25-01-12 ",
    "2026-10-25", null,
  ]) {
    let error = null;
    try {
      parseRaceId(input);
    } catch (e) {
      error = e;
    }
    check(
      `parseRaceId: ${show(input)} は形式不正の例外`,
      error instanceof Error && /race_id の形式が不正です/.test(error.message),
      show(error?.message ?? "例外なし"),
    );
  }
  // 未決定の仕様は assert せず、入力・今の値・判断が必要な点を表示する。
  const KNOWN_GAPS = [
    {
      fn: "parseRaceId", input: "2026-10-25-00-00",
      specification: "会場・レース番号の範囲検査は未定（現在は0を通す）",
      observe: () => parseRaceId("2026-10-25-00-00"),
    },
    {
      fn: "parseRaceId", input: "2026-13-40-99-99",
      specification: "暦・会場・レース番号の範囲検査は未定（現在は範囲外を通す）",
      observe: () => parseRaceId("2026-13-40-99-99"),
    },
    ...[null, undefined].map((input) => ({
      fn: "isRefundedKFinish", input: show(input) ?? "undefined",
      specification: "非文字列入力の契約は未定（現在はRegExp.testの文字列化によりfalse）",
      observe: () => isRefundedKFinish(input),
    })),
  ];
  printOut(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（合否に含めない）`);
  for (const { fn, input, specification, observe } of KNOWN_GAPS) {
    let actual;
    try {
      actual = observe();
    } catch (e) {
      actual = { error: e.message };
    }
    printOut(show({ fn, input, specification, actual }));
  }
  // Kファイルとの突合（実ファイル由来のフィクスチャ）
  const kText = K190415_TEXT;
  const facts = kDayToRaceFacts(kText, "2019-04-15");
  const f = facts.get("2019-04-15-07-01");
  check(
    "Kファイル突合: 蒲郡1R（F4艇）の確定情報（完走=3→1、返還艇=2・4・5・6、不成立=複勝・2連複・拡連複・3連単・3連複）",
    same(f.finisherBoats, [3, 1]) &&
      same(f.refundBoats, [2, 4, 5, 6]) &&
      same([...f.noRaceKinds].sort(), [
        "2fuku",
        "3fuku",
        "3tan",
        "place",
        "wide",
      ]),
    show(f),
  );
  const polluted = {
    race_id: "2019-04-15-07-01",
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_trifecta: 100,
    payout_trio: 100,
    payout_quinella: 100,
    payout_win: 280,
  };
  const defects = compareRaceWithKDay(polluted, f);
  return { f, defects };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
function scene4({ f, defects }) {
  check(
    "Kファイル突合: 蒲郡1Rの汚れた行（非完走艇が rank3〜6、不成立の3連単・3連複・2連複が100）を、rank456・refund_payout（3連単・3連複・2連複）として確定",
    defects.some((d) => d.kind === "rank456") &&
      ["3tan", "3fuku", "2fuku"].every((b) =>
        defects.some((d) => d.kind === "refund_payout" && d.bet === b),
      ),
    show(defects),
  );
  const clean = {
    race_id: "2019-04-15-07-01",
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: null,
    rank5: null,
    rank6: null,
    payout_win: 280,
  };
  check(
    "Kファイル突合: 修正後の行（rank4〜6=NULL・払戻100なし）は誤りなし。rank1〜3 は完走が2艇のため比べない",
    compareRaceWithKDay(clean, f).length === 0,
  );
}

function scene5() {
  {
    const s1 = scene1();
    scene2(s1);
    const s3 = scene3();
    scene4(s3);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・K190415_TEXT） */
export function runRaceResultParserScenes8(env) {
  ({ printOut, check, show, same, K190415_TEXT } = env);
  scene5();
}
