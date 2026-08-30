/**
 * レース単位の状態（締切前/締切後・結果反映待ち/結果確定）を判定する。
 *
 * 対象はレース一覧（RaceCard.jsx）・レース詳細（RaceDetailPage.jsx）のみ。
 * 会場一覧（VenueGridCard.jsx）は結果データを持たないため対象外
 * （時刻ベースの「次のレースがあるか」判定のみを引き続き使う）。
 */

export const RACE_STATUS = {
  UPCOMING: "upcoming",
  AWAITING_RESULT: "awaiting_result",
  FINISHED: "finished",
};

/**
 * @param {{startTime?: string, result?: {finished?: boolean}}} race
 * @param {string|null} nowHHMM - "HH:MM"形式。過去日付ビュー等、時刻比較しない文脈ではnull
 * @returns {string} RACE_STATUSのいずれか
 */
export function getRaceStatus(race, nowHHMM) {
  if (race?.result?.finished) return RACE_STATUS.FINISHED;
  // 過去日付ビュー等: 締切は必ず過ぎているので「結果反映待ち」が正しい（UPCOMINGにはしない）
  if (nowHHMM == null) return RACE_STATUS.AWAITING_RESULT;
  // 本日ビューでstartTime欠損（データ取り込み遅延等）の場合は安全側に倒す
  if (!race?.startTime) return RACE_STATUS.UPCOMING;
  return race.startTime > nowHHMM
    ? RACE_STATUS.UPCOMING
    : RACE_STATUS.AWAITING_RESULT;
}
