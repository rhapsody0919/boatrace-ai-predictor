/**
 * computeCancellationTransition() の状態遷移ロジックを検証する（BOA-254）。
 * 単体テストフレームワークが無いため、既存のverify-*.jsパターンに準拠した
 * assertベースの検証スクリプトとして実装する（BOA-255参照）。
 *
 * 実行: node scripts/analysis/verify-race-cancellation-streak-logic.js
 */

import assert from "node:assert/strict";
import { computeCancellationTransition } from "../lib/cancellationStatus.js";

let passed = 0;

function check(label, actual, expected) {
  assert.deepEqual(actual, expected, label);
  passed++;
  console.log(`  ✅ ${label}`);
}

console.log("computeCancellationTransition() 検証開始\n");

// 1回目の検知（0人）: streakが1に増える、まだtentativeにはならない
check(
  "1回目の検知でstreak=1、statusはnullのまま",
  computeCancellationTransition({
    currentStatus: null,
    currentStreak: 0,
    racersFound: false,
  }),
  { nextStatus: null, nextStreak: 1, changed: true },
);

// 2回目の検知（0人）: streakが2、まだtentativeにはならない
check(
  "2回目の検知でstreak=2、statusはnullのまま",
  computeCancellationTransition({
    currentStatus: null,
    currentStreak: 1,
    racersFound: false,
  }),
  { nextStatus: null, nextStreak: 2, changed: true },
);

// 3回目の検知（0人）: streakが3、tentativeに昇格
check(
  "3回連続でtentativeに昇格",
  computeCancellationTransition({
    currentStatus: null,
    currentStreak: 2,
    racersFound: false,
  }),
  { nextStatus: "tentative", nextStreak: 3, changed: true },
);

// 4回目以降も0人が続く場合: tentativeのままstreakは増え続けてよい
check(
  "tentative確定後も検知が続けばstreakは増える（statusはtentativeのまま）",
  computeCancellationTransition({
    currentStatus: "tentative",
    currentStreak: 3,
    racersFound: false,
  }),
  { nextStatus: "tentative", nextStreak: 4, changed: true },
);

// 正常検知（初期状態）: 変化なし
check(
  "初期状態（streak=0, status=null）で正常検知しても変化なし",
  computeCancellationTransition({
    currentStatus: null,
    currentStreak: 0,
    racersFound: true,
  }),
  { nextStatus: null, nextStreak: 0, changed: false },
);

// 誤検出からのリカバリ: streak蓄積中に正常検知でリセット
check(
  "streak蓄積中(2)に正常検知が入るとリセットされる",
  computeCancellationTransition({
    currentStatus: null,
    currentStreak: 2,
    racersFound: true,
  }),
  { nextStatus: null, nextStreak: 0, changed: true },
);

// tentative確定後の誤検出リカバリ: statusもnullに戻る
check(
  "tentative確定後でも正常検知が入ればnullにリセットされる",
  computeCancellationTransition({
    currentStatus: "tentative",
    currentStreak: 5,
    racersFound: true,
  }),
  { nextStatus: null, nextStreak: 0, changed: true },
);

// confirmedは上書きされない（0人検知が続いても）
check(
  "confirmed状態は0人検知が続いても上書きされない",
  computeCancellationTransition({
    currentStatus: "confirmed",
    currentStreak: 10,
    racersFound: false,
  }),
  { nextStatus: "confirmed", nextStreak: 10, changed: false },
);

// confirmedは正常検知でも上書きされない
check(
  "confirmed状態は正常検知が入っても変化しない（FR2の結果を尊重）",
  computeCancellationTransition({
    currentStatus: "confirmed",
    currentStreak: 10,
    racersFound: true,
  }),
  { nextStatus: "confirmed", nextStreak: 10, changed: false },
);

console.log(`\n✅ 全${passed}件のケースが期待通りでした`);
