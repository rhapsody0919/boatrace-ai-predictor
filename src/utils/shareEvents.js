/**
 * AI用にコピー・SNS シェアの GA4 のイベント（BOA-822 の計測、docs/design/in-collapse-caution/measurement.md）。
 * 展開予測を画面から外すとコピーの文・結果のシェア文が変わるので、その前後を比べる基準を先に取る。
 * 送るかどうかと中身を決める純関数。パラメータ名に GA4 の予約語（source・id 等）を使わない
 */

export const SHARE_CHANNELS = ["x", "facebook", "line"];
export const SHARE_KINDS = ["prediction", "result", "hit"];

/**
 * @param {{raceId: string|null|undefined, promptType: string|null|undefined, place: "banner"|"inline"}} args
 * @returns {{name: string, params: Record<string, string>} | null}
 */
export function aiCopyEventOf({ raceId, promptType, place }) {
  if (!raceId) return null;
  return {
    name: "ai_copy",
    params: {
      race_id: raceId,
      ai_copy_prompt: promptType || "default",
      ai_copy_place: place,
    },
  };
}

/**
 * @param {{raceId: string|null|undefined, channel: string, kind: string}} args
 * @returns {{name: string, params: Record<string, string>} | null}
 */
export function raceShareEventOf({ raceId, channel, kind }) {
  if (!SHARE_CHANNELS.includes(channel) || !SHARE_KINDS.includes(kind)) {
    return null;
  }
  return {
    name: "race_share",
    params: {
      ...(raceId ? { race_id: raceId } : {}),
      share_channel: channel,
      share_kind: kind,
    },
  };
}
