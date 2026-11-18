/**
 * verify-kb-gap-fill.js の検査の続き（kb-gap-fill-status-finish.js）。大きさの関所のため、本文を字のまま移した。verify ではない。
 */
import { DATE, FC_DAY, PAID, R1, R2, fcEmpty, kr, same, show } from "./kb-gap-fill-fixtures.js";

export function evaluateRaceStatus(g) {
  const { failed, expect } = evaluateRaceStatusPart1(g);
  return evaluateRaceStatusPart2(g, failed, expect);
}

export function evaluateRaceStatusPart1(g) {
  const failed = [];
  const expect = (label, got, want) => {
    if (show(got) !== show(want)) failed.push(`${label} ${show(got)}`);
  };
  const d = g.deriveRaceStatusFromK;
  expect("(g) 通常", d(kr(["01", "02", "03", "04", "05", "06"], PAID)), {
    race_status: "normal",
    refund_boats: [],
  });
  expect(
    "(g) F・欠場は返還艇で partial",
    d(kr(["01", "F", "02", "K0", "03", "04"], PAID)),
    { race_status: "partial_refund", refund_boats: [2, 4] },
  );
  expect(
    "(g) 失格（S0/S1/S2）は返還しない",
    d(kr(["01", "S0", "S1", "02", "S2", "03"], PAID)),
    { race_status: "normal", refund_boats: [] },
  );
  expect(
    "(g) 一部の勝式だけ不成立（返還艇なし）は partial",
    d(
      kr(
        ["01", "02", "S0", "S1", "S2", "S0"],
        [{ special: null }, { special: "不成立" }],
      ),
    ),
    { race_status: "partial_refund", refund_boats: [] },
  );
  expect(
    "(g) 全勝式が不成立は no_race",
    d(
      kr(
        ["00", "F", "F", "F", "F", "F"],
        [{ special: "不成立" }, { special: "不成立" }],
      ),
    ),
    { race_status: "no_race", refund_boats: [2, 3, 4, 5, 6] },
  );
  expect(
    "(g) 付記に「レース不成立」は no_race（払戻0件）",
    d(kr(["01", "02", "03", "04", "05", "06"], [], ["レース不成立"])),
    { race_status: "no_race", refund_boats: [] },
  );
  expect(
    "(g) 特払いは不成立に数えない",
    d(kr(["01", "02", "03", "04", "05", "06"], [{ special: "特払い" }])),
    { race_status: "normal", refund_boats: [] },
  );
  expect(
    "(g) 未知の成績コードは異常",
    "anomaly" in d(kr(["01", "Z9", "03", "04", "05", "06"], PAID)),
    true,
  );
  expect(
    "(g) 払戻0件で「レース不成立」も無いのは異常",
    "anomaly" in d(kr(["01", "02", "03", "04", "05", "06"], [])),
    true,
  );
  return { failed, expect };
}

export function evaluateRaceStatusPart2(g, failed, expect) {
  const day = {
    date: DATE,
    k: {
      venues: [
        {
          venue_code: 1,
          status: "complete",
          races: [
            {
              race_number: 1,
              ...kr(["01", "F", "02", "03", "04", "05"], PAID),
            },
            {
              race_number: 2,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
            {
              race_number: 3,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
          ],
        },
        {
          venue_code: 2,
          status: "pending",
          races: [
            {
              race_number: 1,
              ...kr(["01", "02", "03", "04", "05", "06"], PAID),
            },
          ],
        },
      ],
    },
  };
  const out = { anomalies: [] };
  const rows = g.buildRaceStatusRows(
    day,
    new Map([
      [R1, null],
      [R2, "normal"], // 既存の値は上書きしない
      [`${DATE}-02-01`, null],
    ]),
    out,
  );
  expect(
    "(g) NULL の行だけ（既存の値・race_results に行の無い R3 は作らない）",
    rows,
    [{ race_id: R1, race_status: "partial_refund", refund_boats: [2] }],
  );
  expect(
    "(g) K の会場が未完（pending）は書かずに異常",
    out.anomalies.map((a) => a.race_id),
    [`${DATE}-02-01`],
  );
  return failed;
}

export function evaluateFinishCode(gm) {
  const { failed, expect } = evaluateFinishCodePart1(gm);
  return evaluateFinishCodePart2(gm, failed, expect);
}

export function evaluateFinishCodePart1(gm) {
  const failed = [];
  const expect = (label, pass, detail) => {
    if (!pass) failed.push(`${label}${detail ? ` ${detail}` : ""}`);
  };
  const conv = [
    "01",
    "06",
    "F",
    "L0",
    "L1",
    "K0",
    "K1",
    "00",
    "S0",
    "S1",
    "S2",
    "X",
  ].map((c) => gm.finishMarkFromCode(c));
  expect(
    "(h) 成績コード→着欄・着: 01〜06は着、F・L・欠・_ は着なし、S0〜S2・未知は null",
    same(conv, [
      { finish_mark: "1", finish_rank: 1 },
      { finish_mark: "6", finish_rank: 6 },
      { finish_mark: "F", finish_rank: null },
      { finish_mark: "L", finish_rank: null },
      { finish_mark: "L", finish_rank: null },
      { finish_mark: "欠", finish_rank: null },
      { finish_mark: "欠", finish_rank: null },
      { finish_mark: "_", finish_rank: null },
      null,
      null,
      null,
      null,
    ]),
    show(conv),
  );
  return { failed, expect };
}

export function evaluateFinishCodePart2(gm, failed, expect) {
  // R1: 1号艇=全部NULL、2号艇=成績コードだけ既存、3号艇=S1で全部NULL、4号艇=着欄・着が既存（結果ページ由来）で
  //     成績コードだけNULL、5号艇=3列とも既存、6号艇=行が無い
  // R2: 1号艇=S0で結果ページ由来の「転」が既存、5号艇=既存の値がKと食い違う、他は全部NULL
  const existing = new Map([
    [`${R1}|1`, fcEmpty],
    [`${R1}|2`, { ...fcEmpty, official_finish_code: "F" }],
    [`${R1}|3`, fcEmpty],
    [
      `${R1}|4`,
      { official_finish_code: null, finish_mark: "2", finish_rank: 2 },
    ],
    [
      `${R1}|5`,
      { official_finish_code: "K1", finish_mark: "欠", finish_rank: null },
    ],
    [
      `${R2}|1`,
      { official_finish_code: null, finish_mark: "転", finish_rank: null },
    ],
    [`${R2}|2`, fcEmpty],
    [`${R2}|3`, fcEmpty],
    [`${R2}|4`, fcEmpty],
    // 5号艇: 既存の3列が K（04）と食い違う。どれも上書きしない（=書かない）
    [
      `${R2}|5`,
      { official_finish_code: "05", finish_mark: "5", finish_rank: 5 },
    ],
    [`${R2}|6`, fcEmpty],
  ]);
  const out = {};
  const rows = gm.buildFinishCodeRows(FC_DAY, existing, out);
  const row = (raceId, boat, code, mark, rank) => ({
    race_id: raceId,
    boat_number: boat,
    official_finish_code: code,
    finish_mark: mark,
    finish_rank: rank,
  });
  expect(
    "(h) 行の組み立て: NULL だけ埋め、既存の値は持ち回る。S0〜S2 は着欄を書かない。行の無い艇・変わらない艇は書かない",
    same(rows, [
      row(R1, 1, "01", "1", 1),
      row(R1, 2, "F", "F", null),
      row(R1, 3, "S1", null, null),
      row(R1, 4, "02", "2", 2),
      row(R2, 1, "S0", "転", null),
      row(R2, 2, "L0", "L", null),
      row(R2, 3, "00", "_", null),
      row(R2, 4, "S2", null, null),
      row(R2, 6, "01", "1", 1),
    ]),
    show(rows),
  );
  expect(
    "(h) dry-run の内訳: 列ごとに NULL から埋めた艇の数",
    same(out.filled, {
      official_finish_code: 8,
      finish_mark: 5,
      finish_rank: 2,
    }),
    show(out.filled),
  );
  // 成績コードを書き終えた後の再実行（成績コードは全艇あり、着欄はNULL）: 着欄の差分の行だけ
  const after = new Map(
    [1, 2, 3].map((n) => [
      `${R1}|${n}`,
      { ...fcEmpty, official_finish_code: ["01", "F", "S1"][n - 1] },
    ]),
  );
  const again = gm.buildFinishCodeRows(FC_DAY, after);
  expect(
    "(h) 成績コードの書き込み後の再実行: 着欄が決まる艇だけ（S1 の艇は書かない）",
    same(again, [row(R1, 1, "01", "1", 1), row(R1, 2, "F", "F", null)]),
    show(again),
  );
  return failed;
}
