/**
 * prediction の型 makePrediction（src/pure/predictionModel.js）の振る舞いの試験。DB・ネットワーク・fs は使わない。
 */
import assert from "node:assert/strict";
import { makePrediction } from "../../src/pure/predictionModel.js";

const BOOL_KEYS = ["is_hit_win", "is_hit_place", "is_hit_trifecta", "is_hit_trio", "is_hit_turn", "is_shadow"];
const PAYOUT_KEYS = ["payout_win", "payout_place", "payout_trifecta", "payout_trio"];

const prediction = (extra = {}) => ({
  prediction_id: 101,
  race_id: "2026-11-01-02-12",
  model_id: "unified",
  top_pick: 1,
  top_2nd: 3,
  top_3rd: 2,
  confidence: 72.5,
  scores: { 1: 0.4 },
  feature_contributions: null,
  is_hit_win: true,
  is_hit_place: true,
  is_hit_trifecta: false,
  is_hit_trio: false,
  is_hit_turn: null,
  is_shadow: false,
  payout_win: 150,
  payout_place: 110,
  payout_trifecta: null,
  payout_trio: null,
  predicted_at: "2026-11-01T01:00:00+00:00",
  ...extra,
});

let count = 0;
function test(name, fn) {
  fn();
  count += 1;
  console.log(`ok - ${name}`);
}
function throwsRange(fn, pattern) {
  assert.throws(fn, (e) => e instanceof RangeError && pattern.test(e.message));
}

test("正の例は凍結した写しで、引数を変えない", () => {
  const row = prediction();
  const out = makePrediction(row);
  assert.deepEqual(out, row);
  assert.notEqual(out, row);
  assert.ok(Object.isFrozen(out));
  assert.ok(!Object.isFrozen(row));
});

test("race_id は YYYY-MM-DD-VV-RR。欠け・会場25・13R・形違いは RangeError（どの行か含む）", () => {
  throwsRange(() => makePrediction(prediction({ race_id: undefined })), /race_id が YYYY-MM-DD-VV-RR の形でない: undefined（prediction race_id=undefined model_id=unified）/);
  for (const id of ["2026-11-01-24-01", "2026-11-01-01-12"]) assert.equal(makePrediction(prediction({ race_id: id })).race_id, id);
  throwsRange(() => makePrediction(prediction({ race_id: "2026-11-01-25-01" })), /race_id/);
  throwsRange(() => makePrediction(prediction({ race_id: "2026-11-01-00-01" })), /race_id/);
  throwsRange(() => makePrediction(prediction({ race_id: "2026-11-01-02-00" })), /race_id/);
  throwsRange(() => makePrediction(prediction({ race_id: "2026-11-01-02-13" })), /race_id/);
  throwsRange(() => makePrediction(prediction({ race_id: "20261101-02-12" })), /race_id/);
});

test("model_id は文字列（空も DB が許すので通す）。null・数は RangeError", () => {
  throwsRange(() => makePrediction(prediction({ model_id: null })), /model_id が文字列でない: null（prediction race_id=2026-11-01-02-12 model_id=null）/);
  throwsRange(() => makePrediction(prediction({ model_id: 1 })), /model_id/);
  assert.equal(makePrediction(prediction({ model_id: "" })).model_id, "");
});

test("select で一部の列だけ取った行（race_id・model_id と真偽・払戻）も通す", () => {
  const row = { race_id: "2026-11-01-02-12", model_id: "unified", is_hit_win: null, payout_win: null };
  assert.deepEqual(makePrediction(row), row);
});

test("prediction_id は取ったときだけ integer の整数", () => {
  for (const n of [-2147483648, 2147483647]) assert.equal(makePrediction(prediction({ prediction_id: n })).prediction_id, n);
  throwsRange(() => makePrediction(prediction({ prediction_id: null })), /prediction_id が-2147483648〜2147483647でない: null/);
  throwsRange(() => makePrediction(prediction({ prediction_id: 1.5 })), /prediction_id/);
  throwsRange(() => makePrediction(prediction({ prediction_id: 2147483648 })), /prediction_id/);
  throwsRange(() => makePrediction(prediction({ prediction_id: -2147483649 })), /prediction_id/);
});

test("top_pick は取ったときだけ smallint の整数（null は RangeError）", () => {
  for (const n of [-32768, 32767]) assert.equal(makePrediction(prediction({ top_pick: n })).top_pick, n);
  throwsRange(() => makePrediction(prediction({ top_pick: null })), /top_pick が-32768〜32767でない: null/);
  throwsRange(() => makePrediction(prediction({ top_pick: "1" })), /top_pick/);
  throwsRange(() => makePrediction(prediction({ top_pick: 32768 })), /top_pick/);
  throwsRange(() => makePrediction(prediction({ top_pick: -32769 })), /top_pick/);
});

test("top_2nd・top_3rd は null か smallint の整数", () => {
  for (const key of ["top_2nd", "top_3rd"]) {
    assert.equal(makePrediction(prediction({ [key]: null }))[key], null);
    for (const n of [-32768, 32767]) assert.equal(makePrediction(prediction({ [key]: n }))[key], n);
    throwsRange(() => makePrediction(prediction({ [key]: 2.5 })), new RegExp(`${key} が-32768〜32767でない: 2.5`));
    throwsRange(() => makePrediction(prediction({ [key]: 32768 })), new RegExp(key));
    throwsRange(() => makePrediction(prediction({ [key]: -32769 })), new RegExp(key));
  }
});

test("真偽の6列は true・false・null。文字列・数は RangeError", () => {
  for (const key of BOOL_KEYS) {
    for (const v of [true, false, null]) assert.equal(makePrediction(prediction({ [key]: v }))[key], v);
    throwsRange(() => makePrediction(prediction({ [key]: "true" })), new RegExp(`${key} が真偽か null でない: true`));
    throwsRange(() => makePrediction(prediction({ [key]: 1 })), new RegExp(key));
    throwsRange(() => makePrediction(prediction({ [key]: 0 })), new RegExp(key));
  }
});

test("払戻の4列は null か integer の整数", () => {
  for (const key of PAYOUT_KEYS) {
    assert.equal(makePrediction(prediction({ [key]: null }))[key], null);
    for (const n of [-2147483648, 0, 2147483647]) assert.equal(makePrediction(prediction({ [key]: n }))[key], n);
    throwsRange(() => makePrediction(prediction({ [key]: 150.5 })), new RegExp(`${key} が-2147483648〜2147483647でない: 150.5`));
    throwsRange(() => makePrediction(prediction({ [key]: "150" })), new RegExp(key));
    throwsRange(() => makePrediction(prediction({ [key]: 2147483648 })), new RegExp(key));
    throwsRange(() => makePrediction(prediction({ [key]: -2147483649 })), new RegExp(key));
  }
});

test("confidence・scores・feature_contributions・predicted_at は検査しない", () => {
  const out = makePrediction(prediction({ confidence: "x", scores: 1, feature_contributions: [], predicted_at: null }));
  assert.equal(out.confidence, "x");
});

test("null・配列・非オブジェクトは TypeError（関数名を含む）", () => {
  assert.throws(() => makePrediction(null), (e) => e instanceof TypeError && e.message.includes("makePrediction"));
  assert.throws(() => makePrediction([]), TypeError);
  assert.throws(() => makePrediction("x"), TypeError);
});

console.log(`verify-prediction-model: ${count} 件 OK`);
