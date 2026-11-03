/**
 * YouTube Shorts【人気薄の1着】（format・kind = upset_win_short、マイグレーション 198、BOA-1284）の、
 * 取り込み（scripts/sns/push-upset-win-short.js）と送る直前の読み直し（snsClaimCheck.js の readCurrent）に共通の決まり。
 * item の race_id は upset:{出す日 YYYY-MM-DD}:{前日のレースの race_id}（198 の CHECK と同じ形）。
 * 1日1本（同じ JST の出す日の upset_win_short は、生きている item か送った item が1つだけ。198 の一意の索引）
 */
export const UPSET_WIN_SHORT_KIND = "upset_win_short";
/** 送る直前のリンク先の表示の確認で見る画面（scripts/lib/snsScreenMarkers.js の race-sonar。説明欄は龍神ソナーのレースの頁） */
export const UPSET_SCREEN_KEY = "race-sonar";
const UPSET_ID =
  /^upset:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2}-(?:0[1-9]|1[0-9]|2[0-4])-(?:0[1-9]|1[0-2]))$/;

export const upsetIdOf = (date, raceId) => `upset:${date}:${raceId}`;
/** upset_id の出す日（JST）とレース。形が違えば null */
export function parseUpsetId(id) {
  const m = UPSET_ID.exec(id ?? "");
  return m ? { date: m[1], raceId: m[2] } : null;
}
