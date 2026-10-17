/**
 * イン崩れ注意度（BOA-822 task 27）の GA4 のイベント。送る中身を決める純関数（assistEvents.js と同じ形）。
 * 定義と GA4 の登録は docs/design/in-collapse-caution/measurement.md。生の % は送らず段のキーだけ。
 * パラメータ名に GA4 の予約語（source・medium・campaign・term・content・id）を使わない
 */

export const CAUTION_SURFACES = Object.freeze([
  "race_detail",
  "home_highlight",
  "race_list",
  "today",
  "accuracy",
  "assist_rough",
]);
export const CAUTION_TARGETS = Object.freeze([
  "sonar",
  "assist",
  "accuracy",
  "race",
]);

/** レースごとの面（race_id・段を付ける）。ほかはページごとに1回で race_id・段なし */
const RACE_SURFACES = new Set(["race_detail", "race_list", "assist_rough"]);

/**
 * 段のキー。保存した level をそのまま使う（画面で閾値をかけ直さない）。値が無い（出していない）レースは insufficient
 * @param {{level?: string}|null|undefined} inCaution
 * @returns {"low"|"mid"|"high"|"insufficient"}
 */
export function cautionBandOf(inCaution) {
  const level = inCaution?.level;
  return level === "low" || level === "mid" || level === "high"
    ? level
    : "insufficient";
}

function baseParams({ surface, raceId, inCaution }) {
  if (!CAUTION_SURFACES.includes(surface)) return null;
  const params = { caution_surface: surface };
  if (RACE_SURFACES.has(surface)) {
    if (!raceId) return null;
    params.race_id = raceId;
    params.caution_band = cautionBandOf(inCaution);
  }
  // 置き場所は案A（AI予想タブ）で承認。レース詳細のときだけ付ける
  if (surface === "race_detail") params.caution_placement = "ai_tab";
  return params;
}

/**
 * 注意度が画面に入ったとき（呼び出し側がレース・ページごとに1回に絞る）
 * @param {{surface: string, raceId?: string|null, inCaution?: object|null}} input
 * @returns {{name: "caution_visible", params: Record<string, string>} | null} 送らないときは null
 */
export function cautionVisibleEvent(input) {
  const params = baseParams(input);
  return params ? { name: "caution_visible", params } : null;
}

/**
 * 注意度の表示から次へ移ったとき
 * @param {{surface: string, target: string, raceId?: string|null, inCaution?: object|null}} input
 * @returns {{name: "caution_click", params: Record<string, string>} | null}
 */
export function cautionClickEvent(input) {
  if (!CAUTION_TARGETS.includes(input.target)) return null;
  const params = baseParams(input);
  return params
    ? {
        name: "caution_click",
        params: { ...params, caution_target: input.target },
      }
    : null;
}
