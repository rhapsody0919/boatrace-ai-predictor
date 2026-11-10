#!/usr/bin/env node
// BOA-1021: 集計対象・不成立の判定とサービスからの切り出しを固定する。
import assert from "node:assert/strict";
import {
  isUsableRaceResult,
  isNoRaceResult,
} from "../../src/utils/raceResultUsable.js";
import { dataLayerImportNames, readDataLayerSource } from "./dataLayerSource.js";

const cases = [
  [null, false, false],
  [{ race_status: "no_race", rank1: 1 }, false, true],
  [{ race_status: "partial_refund", rank1: 2 }, true, false],
  [{ race_status: null, rank1: 3 }, true, false],
  [{ race_status: null, rank1: null }, false, false],
];
for (const [result, usable, noRace] of cases) {
  const label = JSON.stringify(result);
  assert.equal(isUsableRaceResult(result), usable, `usable: ${label}`);
  assert.equal(isNoRaceResult(result), noRace, `noRace: ${label}`);
}

const service = readDataLayerSource();
assert.doesNotMatch(service, /function\s+(?:isUsableRaceResult|isNoRaceResult)\s*\(/);
assert.deepEqual(dataLayerImportNames("../utils/raceResultUsable.js", service), [
  "isNoRaceResult",
  "isUsableRaceResult",
]);
console.log("✅ raceResultUsable: 5入力・サービスのimportを確認");
