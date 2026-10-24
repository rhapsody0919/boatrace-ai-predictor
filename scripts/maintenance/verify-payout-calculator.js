#!/usr/bin/env node
/**
 * BOA-1033: 配当・回収率の6関数を固定する。ネットワーク・DB は使わない。
 * 仕様の根拠: scripts/lib/payoutCalculator.js の各関数のコメントと依頼88の期待値。
 * trifecta は3連複（順不同）、trio は3連単（順序一致）。率の1.0は100%。
 */
import assert from 'node:assert/strict';
import * as calculator from '../lib/payoutCalculator.js';

// 仕様と現行実装が異なる入力は assert せず、ここに記録する。
// 形式: { functionName, input, specificationValue, currentValue }
const KNOWN_GAPS = [];

// 仕様の値: 率は割合、各券種は1レース100円。空入力も13項目を返す。
const SPEC_EMPTY = {
  totalRaces: 0,
  winHits: 0, placeHits: 0, trifectaHits: 0, trioHits: 0,
  winHitRate: 0, placeHitRate: 0, trifectaHitRate: 0, trioHitRate: 0,
  winRecoveryRate: 0, placeRecoveryRate: 0, trifectaRecoveryRate: 0, trioRecoveryRate: 0,
};
const SPEC_MIXED = {
  totalRaces: 2,
  winHits: 1, placeHits: 1, trifectaHits: 0, trioHits: 1,
  winHitRate: 0.5, placeHitRate: 0.5, trifectaHitRate: 0, trioHitRate: 0.5,
  winRecoveryRate: 1.25, placeRecoveryRate: 0.55, trifectaRecoveryRate: 0, trioRecoveryRate: 15,
};
// 今の実装の値: 土台66e664c15で確認した独立の固定値（実行結果から生成しない）。
const CURRENT_EMPTY = {
  totalRaces: 0,
  winHits: 0, placeHits: 0, trifectaHits: 0, trioHits: 0,
  winHitRate: 0, placeHitRate: 0, trifectaHitRate: 0, trioHitRate: 0,
  winRecoveryRate: 0, placeRecoveryRate: 0, trifectaRecoveryRate: 0, trioRecoveryRate: 0,
};
const CURRENT_MIXED = {
  totalRaces: 2,
  winHits: 1, placeHits: 1, trifectaHits: 0, trioHits: 1,
  winHitRate: 0.5, placeHitRate: 0.5, trifectaHitRate: 0, trioHitRate: 0.5,
  winRecoveryRate: 1.25, placeRecoveryRate: 0.55, trifectaRecoveryRate: 0, trioRecoveryRate: 15,
};

// 各行: 関数、試験名、入力、仕様の値、今の実装の値。
const CASES = [
  ['getTrifectaKey', '3連複は昇順', [3, 1, 2], '1-2-3', '1-2-3'],
  ['getTrifectaKey', '3連複は別の組も昇順', [6, 4, 2], '2-4-6', '2-4-6'],
  ['getTrioKey', '3連単は着順を維持', [3, 1, 2], '3-1-2', '3-1-2'],
  ['getTrioKey', '3連単は逆順も維持', [6, 4, 2], '6-4-2', '6-4-2'],
  ['calculateRecoveryRate', '回収率は割合', [10, 1500], 1.5, 1.5],
  ['calculateRecoveryRate', '予想0件', [0, 100], 0, 0],
  ['calculateRecoveryRate', '1件で100%の境界', [1, 100], 1, 1],
  ['calculateRecoveryRate', '配当0円', [10, 0], 0, 0],
  ['calculateRecoveryRate', '1レース200円', [10, 1500, 200], 0.75, 0.75],
  ['calculateHitRate', '的中率は割合', [3, 4], 0.75, 0.75],
  ['calculateHitRate', '総数0件', [1, 0], 0, 0],
  ['calculateHitRate', '全件的中', [1, 1], 1, 1],
  ['calculateHitRate', '的中なし', [0, 4], 0, 0],
  ['payoutToRecoveryRate', '配当が第1引数', [1500, 10], 1.5, 1.5],
  ['payoutToRecoveryRate', 'レース0件', [100, 0], 0, 0],
  ['payoutToRecoveryRate', '1レース200円', [1500, 10, 200], 0.75, 0.75],
  ['payoutToRecoveryRate', '1件で100%の境界', [100, 1], 1, 1],
  ['calculateStats', '空配列の13項目', [[]], SPEC_EMPTY, CURRENT_EMPTY],
  ['calculateStats', 'nullの13項目', [null], SPEC_EMPTY, CURRENT_EMPTY],
  ['calculateStats', '券種別の的中・欠損配当・全レース分母', [[
    { is_hit_win: true, payout_win: 250, is_hit_trio: true, payout_trio: 3000 },
    { is_hit_place: true, payout_place: 110, payout_trifecta: null },
  ]], SPEC_MIXED, CURRENT_MIXED],
  ['calculateStats', '3連複の的中と配当を3連単へ混ぜない', [[
    { is_hit_trifecta: true, payout_trifecta: 600, is_hit_trio: false, payout_trio: 0 },
  ]],
  { ...SPEC_EMPTY, totalRaces: 1, trifectaHits: 1, trifectaHitRate: 1, trifectaRecoveryRate: 6 },
  { ...CURRENT_EMPTY, totalRaces: 1, trifectaHits: 1, trifectaHitRate: 1, trifectaRecoveryRate: 6 }],
];

console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件`, JSON.stringify(KNOWN_GAPS));
for (const [functionName, name, input, specificationValue, currentValue] of CASES) {
  const label = `${functionName}: ${name}`;
  assert.deepStrictEqual(specificationValue, currentValue, `${label}: 期待値の不一致はKNOWN_GAPSへ記録する`);
  assert.deepStrictEqual(calculator[functionName](...input), specificationValue, label);
  console.log(`OK: ${label}`);
}
console.log(`配当・回収率: ${CASES.length}件成功`);
