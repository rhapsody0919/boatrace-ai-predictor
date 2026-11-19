/**
 * verify-daily-reconcile.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-daily-reconcile.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  comparePayoutColumns,
  parseKDay,
  reconcileDay,
  comparePayoutTable,
  normalizeCombination,
  compareCourses,
} from "../../lib/dailyReconcile.js";

let check, show, same, K_2019, DATE, dbRowFromFact, payoutRowsFromFact, kDay, facts, perfect, reconcile, kinds;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  // 払戻: 同着・特払・不成立・拡連複・複勝
  const base = {
    race_id: "x",
    noRaceKinds: [],
    courses: {},
    finisherBoats: [1, 2, 3, 4, 5, 6],
  };
  const p = (bet_type, amount, combination = "1", special = null) => ({
    bet_type,
    combination,
    amount,
    special,
  });
  const row = (over) => ({
    race_id: "x",
    payout_win: null,
    payout_place_1: null,
    payout_place_2: null,
    payout_exacta: null,
    payout_quinella: null,
    payout_wide_1: null,
    payout_wide_2: null,
    payout_wide_3: null,
    payout_trio: null,
    payout_trifecta: null,
    ...over,
  });
  check(
    "払戻 同着（K側が同じ勝式で2口）: DBの1列がKの額のいずれかなら一致。どれとも違えば不一致",
    comparePayoutColumns(row({ payout_trio: 5000 }), {
      ...base,
      payouts: [p("3tan", 5000, "1-2-3"), p("3tan", 7000, "1-3-2")],
    }).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 6000 }), {
        ...base,
        payouts: [p("3tan", 5000, "1-2-3"), p("3tan", 7000, "1-3-2")],
      }).length === 1,
  );
  check(
    "払戻 複勝2口・拡連複3口: 列の並びに依らず、額の集合で一致する（DBの列順は不問）",
    comparePayoutColumns(row({ payout_place_1: 590, payout_place_2: 290 }), {
      ...base,
      payouts: [p("place", 290, "4"), p("place", 590, "6")],
    }).length === 0 &&
      comparePayoutColumns(
        row({ payout_wide_1: 1060, payout_wide_2: 290, payout_wide_3: 390 }),
        {
          ...base,
          payouts: [
            p("wide", 290, "4-6"),
            p("wide", 390, "4-5"),
            p("wide", 1060, "5-6"),
          ],
        },
      ).length === 0 &&
      comparePayoutColumns(row({ payout_wide_1: 290, payout_wide_2: 390 }), {
        ...base,
        payouts: [
          p("wide", 290, "4-6"),
          p("wide", 390, "4-5"),
          p("wide", 1060, "5-6"),
        ],
      }).length === 1,
  );
  check(
    "払戻 特払（K: 特払い70）: DBに70が入っていれば一致、NULLなら不一致（実データで、2026-09-18 江戸川11Rの2連複が該当した型）",
    comparePayoutColumns(row({ payout_quinella: 70 }), {
      ...base,
      payouts: [p("2fuku", 70, null, "特払い")],
    }).length === 0 &&
      comparePayoutColumns(row({}), {
        ...base,
        payouts: [p("2fuku", 70, null, "特払い")],
      }).length === 1,
  );
  const noRace = {
    ...base,
    payouts: [p("3tan", null, null, "不成立")],
    noRaceKinds: ["3tan"],
  };
  return { row, noRace };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ row, noRace }) {
  check(
    "払戻 不成立: DBがNULLなら一致。返還額100は refund_payout（既存の突合）が扱い、100以外の値が入っていれば payout の不一致",
    comparePayoutColumns(row({}), noRace).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 100 }), noRace).length === 0 &&
      comparePayoutColumns(row({ payout_trio: 530 }), noRace).length === 1,
  );
  const kAudit = parseKDay(K_2019, "2019-04-15");
  const f = kAudit.facts.get("2019-04-15-07-01");
  const polluted = {
    race_id: f.race_id,
    rank1: 3,
    rank2: 1,
    rank3: 2,
    rank4: 4,
    rank5: 5,
    rank6: 6,
    payout_win: 280,
    payout_exacta: 370,
    payout_trio: 100,
    payout_trifecta: 100,
    payout_quinella: 100,
  };
  const r = reconcileDay({
    date: "2019-04-15",
    kDay: kAudit,
    races: [{ race_id: f.race_id, venue_code: 7, cancellation_status: null }],
    results: [polluted],
  });
  check(
    "突合 実ファイル（2019-04-15 蒲郡1R。F4艇・返還・不成立）: 汚れた行の rank456・返還額¥100の払戻（refund_payout）を検出する",
    r.byKind.rank456 === 1 && r.byKind.refund_payout === 3,
    show(r.byKind),
  );
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
  {
    // 払戻明細（race_payouts）
    const id = facts.find((f) =>
      f.payouts.some((p) => p.bet_type === "2fuku"),
    ).race_id;
    const fact = kDay.facts.get(id);
    const rows = payoutRowsFromFact(fact);
    check(
      "払戻明細 Kと一致: 不一致なし",
      comparePayoutTable(rows, fact).length === 0,
    );
    const wrong = rows.map((x) =>
      x.bet_type === "3tan" ? { ...x, payout: x.payout + 10 } : x,
    );
    const d = comparePayoutTable(wrong, fact);
    check(
      "払戻明細 払戻が違う: payout_table(paid) を検出",
      d.length === 1 && d[0].kind === "payout_table" && d[0].field === "paid",
      show(d),
    );
    const flipped = rows.map((x) =>
      x.bet_type === "2fuku"
        ? { ...x, combination: x.combination.split("-").reverse().join("-") }
        : x,
    );
    check(
      "払戻明細 順不同の勝式（2連複）の組番は、並びの違い（2-1と1-2）を一致とみなす。順序ありの勝式（3連単）は区別する",
      comparePayoutTable(flipped, fact).length === 0 &&
        normalizeCombination("2fuku", "2-1") === "1-2" &&
        normalizeCombination("3tan", "2-1-3") === "2-1-3" &&
        normalizeCombination("wide", "6-4") === "4-6",
    );
    const missingNoRace = comparePayoutTable(
      [
        ...rows,
        {
          race_id: id,
          bet_type: "wide",
          seq: 9,
          combination: null,
          payout: null,
          payout_status: "no_race",
        },
      ],
      fact,
    );
    check(
      "払戻明細 不成立の勝式の食い違い: payout_table(no_race) を検出",
      missingNoRace.some((x) => x.field === "no_race"),
      show(missingNoRace),
    );
    const input = perfect();
    input.payouts = input.payouts.map((x) =>
      x.race_id === id && x.bet_type === "win"
        ? { ...x, payout: x.payout + 10 }
        : x,
    );
    const r = reconcile(input);
    check(
      "払戻明細 レース単位: 明細のあるレースだけ突合する（明細が無いレースは不一致にしない）",
      same(kinds(r), ["payout_table"]) &&
        r.mismatchRaces === 1 &&
        reconcile({ ...perfect(), payouts: [] }).mismatchRaces === 0,
      show(r.byKind),
    );
  }
}

function scene4() {
  {
    // 進入コース
    const fact = facts.find((f) =>
      Object.values(f.courses).every((c) => c !== null),
    );
    const row = dbRowFromFact(fact);
    const allNull = Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((n) => [`actual_course_${n}`, null]),
    );
    check(
      "進入 全て一致は不一致なし。全てNULLは course_unfilled（同期待ち）。一部だけ違えば course",
      compareCourses(row, fact).length === 0 &&
        same(
          compareCourses({ ...row, ...allNull }, fact).map((d) => d.kind),
          ["course_unfilled"],
        ) &&
        same(
          compareCourses({ ...row, actual_course_1: 6 }, fact).map((d) => d.kind),
          ["course"],
        ),
    );
    const absent = facts.find((f) =>
      Object.values(f.courses).some((c) => c === null),
    );
    check(
      "進入 欠場艇（Kの進入が空）: DBもNULLなら一致（欠場艇の列だけNULLは正常）",
      absent !== undefined &&
        compareCourses(dbRowFromFact(absent), absent).length === 0,
    );
  }
  // ===========================================================================
  // (b) 分類: 照合不能・同期待ち
  // ===========================================================================
  {
    const input = perfect();
    const pendingVenue = 5;
    const stub = {
      facts: new Map(
        [...kDay.facts].filter(
          ([id]) => Number(id.slice(11, 13)) !== pendingVenue,
        ),
      ),
      completeVenues: new Set(
        [...kDay.completeVenues].filter((v) => v !== pendingVenue),
      ),
      pendingVenues: new Set([pendingVenue]),
    };
    const r = reconcileDay({ date: DATE, kDay: stub, ...input });
    check(
      "分類 会場が未展開（プレースホルダ）: 照合不能に数え（kVenuePending）、不一致に混ぜない。照合の対象から外す",
      r.unverifiable.kVenuePending === 12 &&
        r.mismatchRaces === 0 &&
        r.compared === 132 &&
        same(r.kVenuesPending, [5]),
      show({ u: r.unverifiable, c: r.compared, m: r.mismatchRaces }),
    );
    const absentStub = { ...stub, pendingVenues: new Set() };
    const r2 = reconcileDay({ date: DATE, kDay: absentStub, ...input });
    check(
      "分類 Kに会場が無い: 照合不能（kVenueAbsent）。未展開とは別に数える",
      r2.unverifiable.kVenueAbsent === 12 &&
        r2.unverifiable.kVenuePending === 0 &&
        r2.mismatchRaces === 0,
      show(r2.unverifiable),
    );
    const pendingText = parseKDay(
      `STARTK\n05KBGN\n多摩川［成績］      9/11      にっぽん未来プロジェ  第 3日\n\nデータは、この場の全レース終了後に登録されます。\n05KEND\nENDK\n`,
      DATE,
    );
    check(
      "分類 実際のプレースホルダの記法（データは、この場の全レース終了後に登録されます）を、未展開の会場として読む",
      pendingText.pendingVenues.has(5) && pendingText.completeVenues.size === 0,
      show([...pendingText.pendingVenues]),
    );
  }
}

function scene5() {
  {
    const id = facts.find((f) => f.finisherBoats.length >= 4).race_id;
    const unfilled = (mutate) => {
      const input = perfect();
      mutate(input.results.find((r) => r.race_id === id));
      return input;
    };
    const noRank456 = unfilled((row) =>
      Object.assign(row, { rank4: null, rank5: null, rank6: null }),
    );
    const noCourse = unfilled((row) =>
      Object.assign(
        row,
        Object.fromEntries(
          [1, 2, 3, 4, 5, 6].map((n) => [`actual_course_${n}`, null]),
        ),
      ),
    );
    for (const [label, input, kind] of [
      ["rank4〜6が全てNULL", noRank456, "rank456_unfilled"],
      ["進入が全てNULL", noCourse, "course_unfilled"],
    ]) {
      const before = reconcile(input, { final: false });
      const last = reconcile(input, { final: true });
      check(
        `分類 ${label}（Kファイル同期の前）: 最後の照合の前は「同期待ち」（不一致に数えない・一致にも数えない）、最後の照合では不一致（${kind}）に数える`,
        before.mismatchRaces === 0 &&
          before.syncPending.races === 1 &&
          before.syncPending.byKind[kind] === 1 &&
          before.matched === 143 &&
          last.mismatchRaces === 1 &&
          same(kinds(last), [kind]),
        show({
          before: [before.mismatchRaces, before.syncPending],
          last: last.byKind,
        }),
      );
    }
  }
  {
    const many = perfect();
    many.results = many.results.map((row) => ({
      ...row,
      payout_win: (row.payout_win ?? 0) + 10,
    }));
    const r = reconcile(many);
    check(
      "レポート: 不一致の明細は上限（30件）まで。超過分は件数のみ。レースID・種類・項目・DB値・K値を持つ",
      r.mismatchCount >= 100 &&
        r.mismatches.length === 30 &&
        r.mismatchesTruncated === r.mismatchCount - 30 &&
        ["race_id", "kind", "field", "db", "k"].every(
          (key) => key in r.mismatches[0],
        ),
      show({ n: r.mismatchCount, len: r.mismatches.length }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・K_2019・DATE・dbRowFromFact・payoutRowsFromFact・kDay・facts・perfect・reconcile・kinds） */
export function runDailyReconcileScenes1(env) {
  ({ check, show, same, K_2019, DATE, dbRowFromFact, payoutRowsFromFact, kDay, facts, perfect, reconcile, kinds } = env);
  scene3();
  scene4();
  scene5();
}
