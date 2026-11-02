#!/usr/bin/env node
// 合成データの定義検査のみ。実 fan との照合は verify-racer-career-gate.js（manual）。
// 優出の数え方と2つの名前は kb の選手×期 20,916行で racer_period_stats と照合済み（2026-11-02）。
import assert from "node:assert/strict";
import {
  careerFinishPoints, isCareerStart, careerWinRate, careerFinishCounts,
  isCareerFinalAppearance, isCareerFinalStage,
} from "../../src/pure/racerCareerStats.js";
import { isFinalStage } from "../../src/pure/raceStageConfig.js";

const finishes = ["01", "02", "03", "04", "05", "06"];
const tables = {
  ippan: [[10, 8, 6, 4, 2, 1], [11, 9, 7, 6, 4, 3]],
  G3: [[10, 8, 6, 4, 2, 1], [11, 9, 7, 6, 4, 3]],
  G2: [[11, 9, 7, 5, 3, 2], [12, 10, 8, 7, 5, 4]],
  G1: [[11, 9, 7, 5, 3, 2], [12, 10, 8, 7, 5, 4]],
  PG1: [[11, 9, 7, 5, 3, 2], [12, 10, 8, 7, 5, 4]],
  SG: [[12, 10, 8, 6, 4, 3], [13, 11, 9, 8, 6, 5]],
};
for (const [grade, [normal, final]] of Object.entries(tables)) {
  for (const [i, finish] of finishes.entries()) {
    assert.equal(isCareerStart(finish), true);
    assert.equal(careerFinishPoints(grade, false, finish), normal[i]);
    assert.equal(careerFinishPoints(grade, true, finish), final[i]);
  }
  for (const finish of ["F", "L1", "K1", "S1", "S2"]) {
    assert.equal(isCareerStart(finish), true);
    assert.equal(careerFinishPoints(grade, false, finish), 0);
    assert.equal(careerFinishPoints(grade, true, finish), 0);
  }
  for (const finish of ["L0", "K0", "S0", null, "00", "", "07", "1"]) {
    assert.equal(isCareerStart(finish), false);
    assert.equal(careerFinishPoints(grade, false, finish), null);
    assert.equal(careerFinishPoints(grade, true, finish), null);
  }
}
const row = (finish_raw, stage = "予選", grade = "ippan") =>
  ({ finish_raw, stage, grade });
for (const stage of ["ダービー優勝", "バッチこい優", "GP優勝戦", "サントリー優", "王座決定戦"]) {
  assert.equal(careerWinRate([row("01", stage)]), 11);
  assert.deepEqual(careerFinishCounts([row("01", stage)]),
    { first: 1, second: 0, third: 0, finals: 1, wins: 1 });
}
for (const stage of ["準優進出戦", "準優勝戦", "準々優勝戦", "ドリーム戦", "特選", "選抜", null]) {
  assert.equal(careerWinRate([row("01", stage)]), 10);
  assert.equal(careerFinishCounts([row("01", stage)]).finals, 0);
}
assert.equal(careerWinRate([]), null);
assert.equal(careerWinRate([row("00"), row(null), row("K0")]), null);
assert.equal(careerWinRate([row("F")]), 0);
// 201/200=1.005 の二進浮動小数点の境界も、整数の得点から1回だけ丸める。
const repeated = (count, finish) => Array.from({ length: count }, () => row(finish));
assert.equal(careerWinRate([...repeated(4, "05"), ...repeated(996, "06")]), 1);
assert.equal(careerWinRate([row("05"), ...repeated(199, "06")]), 1.01);
assert.equal(careerWinRate([...repeated(6, "05"), ...repeated(994, "06")]), 1.01);
assert.equal(careerWinRate([row("01", "優勝戦", "SG"), row("F"), row("S0")]), 6.5);
assert.deepEqual(careerFinishCounts([
  row("01"), row("02"), row("03"), row("04"), row("01", "優勝戦"),
  ...["02", "03", "04", "05", "06", "F", "L1", "K1", "S1", "S2"].map(f => row(f, "優勝戦")),
  row("L0", "優勝戦"), row("00", "優勝戦"), row(null, "優勝戦"),
]), { first: 2, second: 2, third: 2, finals: 12, wins: 1 });
assert.deepEqual(careerFinishCounts([]), { first: 0, second: 0, third: 0, finals: 0, wins: 0 });
// 公式の優出は S0・K0・L0 を数え、NULL は数えない（kb の選手×期 20,916行で全件一致、2026-11-02）。
// 出走（勝率の分母）は変えない: S0・K0・L0 は出走0・点なしのまま。
for (const mark of ["S0", "K0", "L0"]) {
  assert.equal(isCareerFinalAppearance(mark), true);
  assert.equal(isCareerStart(mark), false);
  assert.deepEqual(careerFinishCounts([row(mark, "優勝戦")]),
    { first: 0, second: 0, third: 0, finals: 1, wins: 0 });
  assert.equal(careerFinishCounts([row(mark)]).finals, 0);
  assert.equal(careerWinRate([row(mark, "優勝戦")]), null);
}
for (const mark of [null, "00", "", "07"]) {
  assert.equal(isCareerFinalAppearance(mark), false);
  assert.equal(careerFinishCounts([row(mark, "優勝戦")]).finals, 0);
}
for (const f of ["01", "02", "03", "04", "05", "06", "F", "L1", "K1", "S1", "S2"])
  assert.equal(isCareerFinalAppearance(f), true);
// isFinalStage（v2）は拾わないが、公式が優勝戦として数える2つの名前（kb の照合で12行のずれ、2026-11-02）。
// v2 は学習側と共有するので変えず、選手の集計の判定だけで足す。
for (const stage of ["オオムラGP", "関ヶ原決戦"]) {
  assert.equal(isFinalStage(stage), false);
  assert.equal(isCareerFinalStage(stage), true);
  assert.deepEqual(careerFinishCounts([row("01", stage)]),
    { first: 1, second: 0, third: 0, finals: 1, wins: 1 });
  assert.equal(careerWinRate([row("01", stage)]), 11);
}
for (const stage of ["オオムラＧＰ", "オオムラGP ", "関ヶ原 決戦"])
  assert.equal(isCareerFinalStage(stage), true);
for (const stage of ["グランプリ特", "グランプリD", "準優勝戦", "オオムラGP特選", null, undefined])
  assert.equal(isCareerFinalStage(stage), false);
const frozen = Object.freeze([Object.freeze(row("01", "優勝戦"))]);
assert.equal(careerWinRate(frozen), 11);
assert.equal(careerFinishCounts(frozen).wins, 1);
console.log("verify-racer-career-stats: OK（合成データのみ）");
