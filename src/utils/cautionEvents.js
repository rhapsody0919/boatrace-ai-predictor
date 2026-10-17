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

/**
 * visible をレースごとに送る面（race_id・段を付ける）。ほかの面（ホーム・会場の一覧・/today・/accuracy）は
 * 欄が画面に入ったときにページごとに1回で race_id・段なし（measurement.md）
 */
const RACE_VISIBLE_SURFACES = new Set(["race_detail", "assist_rough"]);

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

/**
 * @param {boolean} withRace race_id・段を付けるか。付けるのに race_id が無ければ送らない
 */
function baseParams({ surface, raceId, inCaution }, withRace) {
  if (!CAUTION_SURFACES.includes(surface)) return null;
  const params = { caution_surface: surface };
  if (withRace) {
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
  const params = baseParams(input, RACE_VISIBLE_SURFACES.has(input.surface));
  return params ? { name: "caution_visible", params } : null;
}

/**
 * 注意度の表示から次へ移ったとき
 * @param {{surface: string, target: string, raceId?: string|null, inCaution?: object|null}} input
 *   行き先 race と、race_detail・assist_rough からの click は raceId が要る
 * @returns {{name: "caution_click", params: Record<string, string>} | null}
 */
export function cautionClickEvent(input) {
  if (!CAUTION_TARGETS.includes(input.target)) return null;
  // レースへ移ったとき（行き先 race）と、レース単位の面からの click は、押したレースの race_id・段を付ける
  // （Q4: ホーム・一覧・/today からの click の帯別件数）。/accuracy への導線など、レースの無い click は付けない
  const withRace =
    input.target === "race" || RACE_VISIBLE_SURFACES.has(input.surface);
  const params = baseParams(input, withRace);
  return params
    ? {
        name: "caution_click",
        params: { ...params, caution_target: input.target },
      }
    : null;
}
