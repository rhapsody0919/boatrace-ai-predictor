/**
 * 龍神ソナーの保存ファイル（表示用と、STEP4 の元のレースの一覧）を残す日数（BOA-807、2026-10-13 オーナー決定: 2年）。
 * 夜の掃除（scripts/maintenance/verify-analogy-v16.js の CLEANUP）と、画面の「もう無い」の判定の両方がこの値を使う
 */
export const SONAR_KEEP_DAYS = 730;

/** ファイルが残っている最初のレースの日付（JST の YYYY-MM-DD）。now はミリ秒。夜の掃除の datesToClean と同じ境目 */
export const sonarKeepFrom = (now) =>
  new Date(now + (9 - SONAR_KEEP_DAYS * 24) * 3600 * 1000)
    .toISOString()
    .slice(0, 10);

/** そのレースのファイルは、残す日数を過ぎて消えているか */
export const sonarExpired = (raceId, keepFrom) =>
  String(raceId).slice(0, 10) < keepFrom;
