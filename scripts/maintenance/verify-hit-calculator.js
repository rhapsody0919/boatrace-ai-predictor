#!/usr/bin/env node
/**
 * BOA-1082: hitCalculator.js の JSDoc・コメントに基づく純関数の検証。
 * trifecta=3連複（順不同）、trio=3連単（順序一致）。DB・通信・時計は使わない。
 * isTurnHit・buildPredictionHitUpdate は対象外。
 */
import assert from 'node:assert/strict';
import {
  calculateHits, isWinHit, isPlaceHit, isShowHit,
  isTrifectaHit, isTrioHit, getPlacePayout,
} from '../lib/hitCalculator.js';

const result = {
  rank1: 3, rank2: 1, rank3: 5,
  payout_win: 1200, payout_place_1: 300, payout_place_2: 150,
  payout_trifecta: 2500, payout_trio: 9800,
};
const prediction = (a, b, c) => ({ top_pick: a, top_2nd: b, top_3rd: c });
// 仕様未定の入力を現行値で固定しない。currentValue は毎回実行して採取する。
const gapInput = { prediction: prediction(3, 1, null), result };
const KNOWN_GAPS = [{
  functionName: 'calculateHits', input: gapInput,
  specificationValue: '未定: top_3rd=null の3連複・3連単を判定対象外にするかコメントにない',
  currentValue: calculateHits(gapInput.prediction, gapInput.result),
}];

let passed = 0;
let failed = 0;
function test(name, check) {
  try {
    check();
    passed++;
    console.log(`PASS: ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL: ${name}: ${error.message.replaceAll('\n', ' ')}`);
  }
}

// 以下の期待値はコメントの定義から決めた値。現行の出力から生成しない。
for (const boat of [1, 2, 3, 4, 5, 6]) {
  test(`isWinHit: ${boat}号艇の1着一致`, () => {
    assert.equal(isWinHit(boat, 3), boat === 3);
  });
  test(`isPlaceHit: ${boat}号艇の2着以内`, () => {
    assert.equal(isPlaceHit(boat, 3, 1), [3, 1].includes(boat));
  });
  test(`isShowHit: ${boat}号艇の3着以内`, () => {
    assert.equal(isShowHit(boat, 3, 1, 5), [3, 1, 5].includes(boat));
  });
}
for (const [boats, unordered, ordered] of [
  [[3, 1, 5], true, true], [[5, 3, 1], true, false],
  [[1, 3, 5], true, false], [[3, 1, 6], false, false],
  [[], false, false], [[3, 1], false, false],
  [[3, 1, 5, 6], false, false], [null, false, false],
]) {
  test(`isTrifectaHit: ${JSON.stringify(boats)}の順不同一致`, () => {
    assert.equal(isTrifectaHit(boats, 3, 1, 5), unordered);
  });
  test(`isTrioHit: ${JSON.stringify(boats)}の順序一致`, () => {
    assert.equal(isTrioHit(boats, 3, 1, 5), ordered);
  });
}
test('isTrifectaHit: 入力配列を変更しない', () => {
  const boats = [5, 3, 1];
  isTrifectaHit(boats, 3, 1, 5);
  assert.deepEqual(boats, [5, 3, 1]);
});
for (const [boat, first, second, expected] of [
  [3, 300, 150, 300], [1, 300, 150, 150], [6, 300, 150, 0],
  [3, null, 150, 0], [3, undefined, 150, 0],
  [1, 300, null, 0], [1, 300, undefined, 0],
  [3, 0, 150, 0], [1, 300, 0, 0],
]) {
  test(`getPlacePayout: ${boat}号艇・配当${first}/${second}`, () => {
    assert.equal(getPlacePayout(boat, 3, 1, first, second), expected);
  });
}
const allHit = {
  isHitWin: true, isHitPlace: true, isHitTrifecta: true, isHitTrio: true,
  payoutWin: 1200, payoutPlace: 300, payoutTrifecta: 2500, payoutTrio: 9800,
};
test('calculateHits: 3-1-5は全的中・8キーと券種別配当', () => {
  assert.deepEqual(calculateHits(prediction(3, 1, 5), result), allHit);
});
test('calculateHits: 1-5-3は2着複勝と3連複だけ的中', () => {
  assert.deepEqual(calculateHits(prediction(1, 5, 3), result), {
    isHitWin: false, isHitPlace: true, isHitTrifecta: true, isHitTrio: false,
    payoutWin: 0, payoutPlace: 150, payoutTrifecta: 2500, payoutTrio: 0,
  });
});
test('calculateHits: 全外れは配当があっても0', () => {
  assert.deepEqual(calculateHits(prediction(6, 4, 2), result), {
    isHitWin: false, isHitPlace: false, isHitTrifecta: false, isHitTrio: false,
    payoutWin: 0, payoutPlace: 0, payoutTrifecta: 0, payoutTrio: 0,
  });
});
for (const missing of [null, undefined, 0]) {
  test(`calculateHits: 的中でも欠損・0配当は0 (${missing})`, () => {
    const noPayout = { rank1: 3, rank2: 1, rank3: 5 };
    for (const key of Object.keys(result).filter(key => key.startsWith('payout_'))) {
      if (missing !== undefined) noPayout[key] = missing;
    }
    assert.deepEqual(calculateHits(prediction(3, 1, 5), noPayout), {
      ...allHit, payoutWin: 0, payoutPlace: 0, payoutTrifecta: 0, payoutTrio: 0,
    });
    assert.equal(calculateHits(prediction(1, 5, 3), noPayout).payoutPlace, 0);
  });
}
// 重複なし120予想 × 3着順。相互一致だけでなく上の独立した期待値も検証する。
for (const ranks of [[3, 1, 5], [6, 4, 2], [1, 2, 3]]) {
  for (let a = 1; a <= 6; a++) {
    for (let b = 1; b <= 6; b++) {
      for (let c = 1; c <= 6; c++) {
        if (new Set([a, b, c]).size !== 3) continue;
        test(`calculateHits: 個別関数と一致 ${a}-${b}-${c}/${ranks.join('-')}`, () => {
          const actual = calculateHits(prediction(a, b, c), {
            ...result, rank1: ranks[0], rank2: ranks[1], rank3: ranks[2],
          });
          assert.deepEqual([
            actual.isHitWin, actual.isHitPlace, actual.isHitTrifecta, actual.isHitTrio,
          ], [
            isWinHit(a, ranks[0]), isPlaceHit(a, ranks[0], ranks[1]),
            isTrifectaHit([a, b, c], ...ranks), isTrioHit([a, b, c], ...ranks),
          ]);
        });
      }
    }
  }
}
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件 ${JSON.stringify(KNOWN_GAPS)}`);
console.log(`hitCalculator: ${passed}件成功 / ${failed}件失敗`);
if (failed > 0) process.exitCode = 1;
