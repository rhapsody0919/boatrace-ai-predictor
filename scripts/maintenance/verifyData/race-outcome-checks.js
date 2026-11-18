// verify-race-outcome.js の判定関数の試験の本文（越えの単位を分けるため移した。verify ではない）
// check・show は verify の側の runChecks の物を受け取る。結果の集計は runChecks に残す

// 本番の実データ（2026-09-29 に execute_sql で確認した race_results の値）
const HAMANAKO_NO_RACE = {
  finished: true,
  rank1: 4,
  rank2: 1,
  rank3: 2,
  raceStatus: "no_race",
  refundBoats: [1, 2, 3, 5, 6],
};
const TODA_PARTIAL = {
  finished: true,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  raceStatus: "partial_refund",
  refundBoats: [3, 4, 5, 6],
};
const KIRYU_PARTIAL = {
  finished: true,
  rank1: 2,
  rank2: 1,
  rank3: 4,
  raceStatus: "partial_refund",
  refundBoats: [3, 5, 6],
};
const NORMAL = {
  finished: true,
  rank1: 1,
  rank2: 2,
  rank3: 3,
  raceStatus: "normal",
  refundBoats: [],
};
// RPC未適用（raceStatus が届かない）。is_no_race は全行 false
const UNAPPLIED = {
  finished: true,
  rank1: 4,
  rank2: 1,
  rank3: 2,
  isNoRace: false,
};

const patterns = (...courses) =>
  courses.map((c) => ({
    winnerCourse: c,
    technique: "nige",
    probability: 0.3,
  }));

export function raceOutcomeKeyChecks(m, check, show) {
  // BOA-1118: キーの形・型変換・補完の優先順位を直接固定する。
  const refundCases = [
    ["null", null, []],
    ["undefined", undefined, []],
    ["空オブジェクト", {}, []],
    ["空配列", { refundBoats: [] }, []],
    ["数値の配列", { refundBoats: [1, 3] }, [1, 3]],
    ["生の行のキー", { refund_boats: [2] }, [2]],
    ["文字列の配列", { refundBoats: ["3", "5"] }, [3, 5]],
    ["空白付きの文字列", { refundBoats: [" 2 "] }, [2]],
    ["null は生の行で補完", { refundBoats: null, refund_boats: [6] }, [6]],
    ["空配列は補完しない", { refundBoats: [], refund_boats: [6] }, []],
    ["配列以外", { refundBoats: "1,2" }, []],
    ["整数以外を除外", { refundBoats: [1, "x", 2.5, 4] }, [1, 4]],
  ];
  for (const [label, input, expected] of refundCases) {
    const got = m.getRefundBoats(input);
    check(
      `getRefundBoats: ${label}`,
      show(got) === show(expected),
      `got=${show(got)}`,
    );
  }

  const winnerCases = [
    ["null", [null], null],
    ["undefined は補完しない", [undefined, 3], null],
    ["1着なしは補完しない", [{ rank1: null }, 2], null],
    ["actual_course を優先", [{ rank1: 3, actual_course_3: 2 }, 4], 2],
    [
      "actual_course が null なら補完",
      [{ rank1: 3, actual_course_3: null }, 4],
      4,
    ],
    ["actual_course が無ければ補完", [{ rank1: 3 }, 4], 4],
    ["補完値を省略", [{ rank1: 3 }], null],
    ["補完値が null", [{ rank1: 3 }, null], null],
    ["文字列の艇番", [{ rank1: "3", actual_course_3: 2 }, null], 2],
  ];
  for (const [label, args, expected] of winnerCases) {
    const got = m.winnerEntryCourseOf(...args);
    check(
      `winnerEntryCourseOf: ${label}`,
      show(got) === show(expected),
      `got=${show(got)}`,
    );
  }
}

export function raceOutcomeStatusChecks(m, check) {
  // 1. 成立状態
  check(
    "不成立: race_status='no_race' → no_race",
    m.getRaceOutcomeState(HAMANAKO_NO_RACE) === "no_race",
  );
  check(
    "一部返還 → partial_refund",
    m.getRaceOutcomeState(TODA_PARTIAL) === "partial_refund",
  );
  check("通常 → normal", m.getRaceOutcomeState(NORMAL) === "normal");
  check(
    "RPC未適用（raceStatus なし） → unknown",
    m.getRaceOutcomeState(UNAPPLIED) === "unknown",
  );
  check(
    "旧フラグ isNoRace=true だけでは不成立にしない（is_no_race は読まない）",
    m.getRaceOutcomeState({ ...UNAPPLIED, isNoRace: true }) === "unknown",
  );
  check(
    "race_results の生の行（race_status）も受ける",
    m.getRaceOutcomeState({ race_status: "no_race" }) === "no_race",
  );
  check(
    "未知の値は unknown",
    m.getRaceOutcomeState({ raceStatus: "weird" }) === "unknown",
  );
  check("null は unknown", m.getRaceOutcomeState(null) === "unknown");

  // isJudgeable
  check("不成立は判定不可", m.isJudgeable(HAMANAKO_NO_RACE) === false);
  check("一部返還は判定可", m.isJudgeable(TODA_PARTIAL) === true);
  check("RPC未適用は今までどおり判定可", m.isJudgeable(UNAPPLIED) === true);
  check(
    "rank1 が無ければ判定不可",
    m.isJudgeable({ finished: true, rank1: null }) === false,
  );
  check(
    "未確定は判定不可",
    m.isJudgeable({ finished: false, rank1: 1 }) === false,
  );

  // isBoatRefunded
  check("返還艇（戸田9R の3号艇）", m.isBoatRefunded(TODA_PARTIAL, 3) === true);
  check(
    "返還でない艇（戸田9R の1号艇）",
    m.isBoatRefunded(TODA_PARTIAL, 1) === false,
  );
  check("文字列の艇番も受ける", m.isBoatRefunded(TODA_PARTIAL, "4") === true);
  check(
    "refund_boats 未判定は返還でない",
    m.isBoatRefunded(UNAPPLIED, 1) === false,
  );
  check(
    "生の行（refund_boats）も受ける",
    m.isBoatRefunded({ refund_boats: [2] }, 2) === true,
  );
}

export function raceOutcomeTurnChecks(m, check, show) {
  // 2. 展開予測
  const noRaceJ = m.judgeTurnPrediction(patterns(1, 3, 4), HAMANAKO_NO_RACE);
  check(
    "不成立（浜名湖9/14 6R）: rank1=4 が候補にあっても判定対象外",
    noRaceJ.status === "not_judgeable" && noRaceJ.winner === null,
    show(noRaceJ),
  );
  const kiryuJ = m.judgeTurnPrediction(patterns(2, 1, 3), KIRYU_PARTIAL);
  check(
    "一部返還（桐生9/24 8R）: 1着=2号艇で的中、返還艇3号艇に印",
    kiryuJ.status === "hit" &&
      kiryuJ.winner === 2 &&
      show(kiryuJ.refundedCourses) === "[3]",
    show(kiryuJ),
  );
  const todaJ = m.judgeTurnPrediction(patterns(3, 4), TODA_PARTIAL);
  check(
    "一部返還: 候補が返還艇だけなら外れ（1着は決まっている）",
    todaJ.status === "miss" && show(todaJ.refundedCourses) === "[3,4]",
    show(todaJ),
  );
  check(
    "通常: 一致すれば的中",
    m.judgeTurnPrediction(patterns(1), NORMAL).status === "hit",
  );
  check(
    "通常: 一致しなければ外れ",
    m.judgeTurnPrediction(patterns(2, 3), NORMAL).status === "miss",
  );
  check(
    "RPC未適用: 今までどおり rank1 で判定（#949 以前と同じ）",
    m.judgeTurnPrediction(patterns(4), UNAPPLIED).status === "hit",
  );
  check(
    "予想なしは判定対象外",
    m.judgeTurnPrediction([], NORMAL).status === "not_judgeable",
  );
  check(
    "patterns が null でも落ちない",
    m.judgeTurnPrediction(null, NORMAL).status === "not_judgeable",
  );

  // 3. 買い目
  check(
    "返還艇を含む買い目は判定対象外",
    m.isBetJudgeable(TODA_PARTIAL, [1, 2, 3]) === false,
  );
  check(
    "返還艇を含まない買い目は判定可",
    m.isBetJudgeable(TODA_PARTIAL, [1, 2]) === true,
  );
  check(
    "不成立は買い目も判定対象外",
    m.isBetJudgeable(HAMANAKO_NO_RACE, [4]) === false,
  );

  // 4. 記号
  const refundMarks = Object.entries(m.FINISH_MARKS)
    .filter(([, v]) => v.refund)
    .map(([k]) => k)
    .sort();
  check(
    "返還の記号は F・L・欠のみ",
    show(refundMarks) === show(["F", "L", "欠"].sort()),
    show(refundMarks),
  );
  check("全角 Ｆ を F に正規化", m.normalizeFinishMark("Ｆ") === "F");
  check("全角 ＿ を _ に正規化", m.normalizeFinishMark("＿") === "_");
  check("空文字は null", m.normalizeFinishMark("  ") === null);
}

export function raceOutcomePayoutChecks(m, check) {
  // 払戻
  check(
    "最高配当の対象: 通常",
    m.isPayoutAmountCountable({ status: "paid", amount: 870 }) === true,
  );
  check(
    "最高配当の対象: 特払",
    m.isPayoutAmountCountable({ status: "special", amount: 70 }) === true,
  );
  check(
    "最高配当の対象外: 不成立",
    m.isPayoutAmountCountable({ status: "no_race", amount: null }) === false,
  );
  check(
    "最高配当の対象外: 金額なし",
    m.isPayoutAmountCountable({ status: "no_amount", amount: null }) === false,
  );
  check(
    "払戻表の並びは公式の結果ページと同じ（3連単・3連複・2連単・2連複・拡連複・単勝・複勝。BOA-558 の5）",
    m.PAYOUT_BET_TYPES.map((b) => b.betType).join(",") ===
      "3tan,3fuku,2tan,2fuku,wide,win,place",
  );
  check(
    "3連単=trifecta・3連複=trio（race_results の列名の逆転を持ち込まない）",
    m.PAYOUT_BET_TYPES.find((b) => b.betType === "3tan").typeKey ===
      "trifecta" &&
      m.PAYOUT_BET_TYPES.find((b) => b.betType === "3fuku").typeKey === "trio",
  );
}

export function raceOutcomeVoidTableChecks(m, check) {
  const sorted = (set) => [...set].sort().join(",");
  const TABLE = [
    // [正常スタート, 完走, 不成立の勝式, 件数・例]
    [6, 5, "", "返還なし・完走5（124件）"],
    [5, 5, "", "1艇返還（83件）"],
    [4, 4, "", "2艇返還（11件）"],
    [3, 3, "3fuku,wide", "3艇返還（8件、桐生 9/24 8R）"],
    [2, 2, "2fuku,3fuku,3tan,place,wide", "4艇返還（14件）"],
    [
      1,
      0,
      "2fuku,2tan,3fuku,3tan,place,wide,win",
      "5艇返還（6件、浜名湖 9/14 6R）",
    ],
    [0, 0, "2fuku,2tan,3fuku,3tan,place,wide,win", "6艇返還（1件）"],
    [6, 2, "3fuku,3tan", "返還なし・完走2（4件）"],
    [5, 2, "3fuku,3tan", "1艇返還・完走2（1件）"],
    [
      6,
      0,
      "2fuku,2tan,3fuku,3tan,place,wide,win",
      "返還なし・完走0（1件、失格のみ）",
    ],
  ];
  for (const [normalStarters, finishers, want, label] of TABLE) {
    const got = sorted(m.expectedVoidBetTypes({ normalStarters, finishers }));
    check(
      `不成立の勝式: 正常スタート${normalStarters}・完走${finishers} → ${want || "なし"}（${label}）`,
      got === want,
      `got=${got}`,
    );
  }
}

export function raceOutcomePartialVoidChecks(m, check, show) {
  const pay = (betType, status) => ({ betType, status });
  const paid = (b) => pay(b, "paid");
  const voidRow = (b) => pay(b, "no_race");
  const KIRYU_PAYOUTS = [
    paid("win"),
    paid("place"),
    paid("3tan"),
    voidRow("3fuku"),
    paid("2tan"),
    paid("2fuku"),
    voidRow("wide"),
  ];
  const r1 = m.describePartialVoid({
    boatsInRace: 6,
    refundBoats: [3, 5, 6],
    finishers: 3,
    payoutRows: KIRYU_PAYOUTS,
  });
  check(
    "理由の1行: 桐生 9/24 8R は「正常スタート3艇・3連複・拡連複」",
    r1?.kind === "starters" &&
      r1.count === 3 &&
      r1.betTypes.join(",") === "3fuku,wide",
    show(r1),
  );
  const r2 = m.describePartialVoid({
    boatsInRace: 6,
    refundBoats: [],
    finishers: 2,
    payoutRows: [paid("win"), paid("2tan"), voidRow("3tan"), voidRow("3fuku")],
  });
  check(
    "理由の1行: 返還なし・完走2は「完走2艇・3連単・3連複」",
    r2?.kind === "finishers" &&
      r2.count === 2 &&
      r2.betTypes.join(",") === "3tan,3fuku",
    show(r2),
  );
  check(
    "理由の1行: 払戻明細の不成立が表と合わないときは出さない（断定しない）",
    m.describePartialVoid({
      boatsInRace: 6,
      refundBoats: [3, 5, 6],
      finishers: 3,
      payoutRows: [paid("win"), voidRow("3tan")],
    }) === null,
  );
  check(
    "理由の1行: 全勝式が不成立（レース不成立）・不成立が無いときは出さない",
    m.describePartialVoid({
      boatsInRace: 6,
      refundBoats: [1, 2, 3, 5, 6],
      payoutRows: [
        "win",
        "place",
        "3tan",
        "3fuku",
        "2tan",
        "2fuku",
        "wide",
      ].map(voidRow),
    }) === null &&
      m.describePartialVoid({
        boatsInRace: 6,
        refundBoats: [],
        payoutRows: [paid("win")],
      }) === null,
  );
}
