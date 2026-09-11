/**
 * レース中止・順延検出の状態遷移ロジック（BOA-254）
 *
 * races.cancellation_status / cancellation_check_streak の更新方針を
 * DB・スクレイピングに依存しない純粋関数として切り出す。
 * 検証: scripts/analysis/verify-race-cancellation-streak-logic.js
 * 詳細: docs/design/race-cancellation-detection/plan.md、docs/adr/0041
 */

export const CONFIRM_STREAK_THRESHOLD = 3;

/**
 * 発走前の暫定検知（選手情報0人）の結果を受けて、次の状態を計算する。
 * 発走後の確定（FR2）はこの関数の対象外（scrape-results.js側で直接
 * 'confirmed' を書き込む。この関数は 'confirmed' を上書きしない）。
 *
 * @param {Object} params
 * @param {string|null} params.currentStatus - 現在の cancellation_status（null/'tentative'/'confirmed'）
 * @param {number} params.currentStreak - 現在の cancellation_check_streak
 * @param {boolean} params.racersFound - 今回のチェックで選手情報が取得できたか
 * @returns {{ nextStatus: string|null, nextStreak: number, changed: boolean }}
 */
export function computeCancellationTransition({
  currentStatus,
  currentStreak,
  racersFound,
}) {
  // 確定済みは上書きしない（FR2の結果を尊重する）
  if (currentStatus === "confirmed") {
    return {
      nextStatus: currentStatus,
      nextStreak: currentStreak,
      changed: false,
    };
  }

  if (racersFound) {
    // 正常検知。streak・statusが既に初期値なら変化なし、そうでなければリセット（誤検出からのリカバリ）
    if (currentStreak === 0 && currentStatus === null) {
      return { nextStatus: null, nextStreak: 0, changed: false };
    }
    return { nextStatus: null, nextStreak: 0, changed: true };
  }

  // 選手情報0人を検知
  const nextStreak = currentStreak + 1;
  const nextStatus =
    nextStreak >= CONFIRM_STREAK_THRESHOLD ? "tentative" : currentStatus;
  return { nextStatus, nextStreak, changed: true };
}
