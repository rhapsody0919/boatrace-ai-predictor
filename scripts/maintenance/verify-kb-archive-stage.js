/** BOA-1181: K/B取り込みの優勝戦判定を v2 と照合する（通信・DB接続なし）。 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyStage, buildArchiveRows } from "../lib/kbArchiveRows.js";

const cases = [
  ["GP優勝戦", "final"],
  ["サントリー優", "final"],
  ["王座決定戦", "final"],
  ["ダービー優勝", "final"], // 4639、2024-10-31 若松
  ["バッチこい優", "final"], // 3757、2024-10-14 津
  ["優勝戦", "final"],
  ["準優勝戦", "semifinal"],
  ["準優進出戦", "semifinal"], // 優勝戦以外の既存区分は保つ
  ["予選", "qualifier"],
  ["一般戦", "other"],
  ["優出戦", "other"], // 旧 startsWith("優出") と異なり v2 では優勝戦でない
  [null, null],
  [undefined, null],
  ["", null],
];
let failures = 0;
function check(label, actual, expected) {
  try {
    assert.equal(actual, expected);
  } catch (error) {
    failures++;
    console.error(`${label}: ${error.message}`);
  }
}
for (const [stage, expected] of cases) {
  check(`classifyStage(${stage})`, classifyStage(stage), expected);
  // K優先・Bのみのどちらでも、原文を保ったまま stage_kind に反映する。
  for (const source of ["k", "b"]) {
    const { races } = buildArchiveRows({
      date: "2024-10-31",
      [source]: { venues: [{ venue_code: 20, races: [{ race_number: 12, stage }] }] },
    });
    check(`${source}: stage`, races[0].stage, stage ?? null);
    check(`${source}: stage_kind(${stage})`, races[0].stage_kind, expected);
  }
}

const fixture = JSON.parse(fs.readFileSync(new URL(
  "../ml/analogy/testdata/stage-rule-v2-cases.json", import.meta.url,
), "utf8"));
for (const { stage, expected_category: category } of fixture.cases) {
  // 準優・予選等の区分は今回の範囲外。優勝戦であるかだけを独立した固定値で照合する。
  check(`v2 final: ${stage}`, classifyStage(stage) === "final", category === "final");
}
if (failures) {
  console.error(`失敗: ${failures}件`);
  process.exitCode = 1;
} else {
  console.log(`OK: 個別${cases.length}件（K/B行変換を含む）・v2固定${fixture.cases.length}件`);
}
