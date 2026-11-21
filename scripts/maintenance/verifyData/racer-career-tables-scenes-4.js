/**
 * verify-racer-career-tables.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-career-tables.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE_VERSION, COUNT_COLUMNS } from "../../lib/racerCareerJob.js";

/** test("照合の関門（verify-racer-career-gate.js）の比べ方: 2層を足し、期・コード・優勝・優出（S0 を含む の中身を割った 1/2 */
async function careerGateCompare1() {
  // BOA-1193（#2066）の実物の純関数で比べる。読み込みは関門と同じ loadCareerFunctions（名前が違えば止まる）
  const { compareCareerToOfficial, loadCareerFunctions, staleRuleEras } = await import("../verify-racer-career-gate.js");
  // 規則の版が古い層（優勝戦の判定を変える前の kb 等）は照合の前に止める
  assert.deepEqual(staleRuleEras([{ era: "kb", rule_version: "career-v1(stage-v2,grade-v2,code-v1)" }, { era: "main", rule_version: RULE_VERSION }]), ["kb"]);
  assert.deepEqual(staleRuleEras([{ era: "kb", rule_version: RULE_VERSION }]), []);
  const career = await loadCareerFunctions();


  const zero = Object.fromEntries(COUNT_COLUMNS.map((c) => [c, 0]));
  const termRows = [
    {
      racer_id: 1,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p1: 1,
      k0: 1,
    }, // kb
    {
      racer_id: 1,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p2: 1,
      f: 1,
    }, // main
    {
      racer_id: 2,
      term_start: "2025-11-01",
      race_grade: "ippan",
      is_final: false,
      ...zero,
      p1: 1,
    }, // 公式の名簿に無い
  ];
  const courseRows = [
    { racer_id: 1, course: 1, term_start: "2025-11-01", ...zero, p1: 1 },
    { racer_id: 1, course: 2, term_start: "2025-11-01", ...zero, p2: 1, f: 1 },
  ];
  const champRows = [
    { racer_id: 1, race_date: "2026-04-30", finish_code: "01" },
    { racer_id: 1, race_date: "2026-01-02", finish_code: "S0" },
    { racer_id: 1, race_date: "2026-05-01", finish_code: "01" }, // 次の期
  ];
  const off = {
    racer_id: 1,
    calc_from: "2025-11-01",
    starts: 3,
    first_count: 1,
    second_count: 1,
    win_rate: 6.0,
    finals: 2, // 優出は S0 も数える（公式の数え方、2026-11-02）
    wins: 1,
  };
  for (let c = 1; c <= 6; c++)
    for (const col of [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "f",
      "l0",
      "l1",
      "k0",
      "k1",
      "s0",
      "s1",
      "s2",
    ])
      off[`c${c}_${col}`] = 0;
  off.c1_p1 = 1;
  off.c2_p2 = 1;
  off.c2_f = 1;
  const ok = compareCareerToOfficial({
    termRows,
    courseRows,
    champRows,
    official: [off],
    career,
  });
  assert.equal(ok.compared, 1);
  assert.deepEqual(ok.mismatches, []);
  assert.deepEqual(ok.extra, ["2|2025-11-01"]);
  return { compareCareerToOfficial, career, zero, termRows, courseRows, champRows, off, ok };
}

/** test("照合の関門（verify-racer-career-gate.js）の比べ方: 2層を足し、期・コード・優勝・優出（S0 を含む の中身を割った 2/2 */
function careerGateCompare2({ career, champRows, compareCareerToOfficial, courseRows, off, ok, termRows, zero }) {
  // 1つ食い違えば、その選手×期と項目を出す
  const ng = compareCareerToOfficial({
    termRows,
    courseRows,
    champRows,
    official: [{ ...off, starts: 4, win_rate: 6.01, finals: 1, c3_p1: 1 }],
    career,
  });
  assert.deepEqual(Object.keys(ng.mismatches[0].diff).sort(), [
    "course",
    "finals",
    "starts",
    "win_rate",
  ]);
  // S0 を数えない旧い数え方（1）は公式（2）と食い違う
  assert.deepEqual(ng.mismatches[0].diff.finals, { ours: 2, official: 1 });
  assert.deepEqual(ng.mismatches[0].diff.course, {
    c3_p1: { ours: 0, official: 1 },
  });
  assert.equal(ng.perTerm["2025-11-01"].mismatched, 1);
  // グレードが unknown の走は0点にせず、選手×期ごとに unknown_runs として出す
  const unk = compareCareerToOfficial({
    termRows: [
      ...termRows,
      {
        racer_id: 1,
        term_start: "2025-11-01",
        race_grade: "unknown",
        is_final: false,
        ...zero,
        p3: 2,
      },
    ],
    courseRows,
    champRows,
    official: [off],
    career,
  });
  assert.deepEqual(unk.unknownRuns, [
    { racer_id: 1, term: "2025-11-01", unknown_runs: 2 },
  ]);
  assert.equal(ok.unknownRuns.length, 0);
}

function scene1() {
  test("照合の関門（verify-racer-career-gate.js）の比べ方: 2層を足し、期・コード・優勝・優出（S0 を含む）を比べる", async () => {
    const { compareCareerToOfficial, career, zero, termRows, courseRows, champRows, off, ok } = await careerGateCompare1();
    careerGateCompare2({ career, champRows, compareCareerToOfficial, courseRows, off, ok, termRows, zero });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export function runRacerCareerTablesScenes4() {
  scene1();
}
