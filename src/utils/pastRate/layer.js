/**
 * BOA-635 で layer API の応答を使えるかの判定（docs/design/past-rate-check/spec.md「データ（土台）」・plan「組み込み」）。純粋関数。
 */
import { parseRaceId } from "../raceId.js";

/**
 * 本番で layer ファイル（status=ok）がある最初の race_date（tasks T0-3 の実測）。これより前のレースは
 * not_saved（no-store でキャッシュが効かない）なので、API を呼ばない
 */
export const LAYER_FIRST_DATE = "2026-10-06";

/** そのレースで layer を取りに行くか（v16 の公開より前・raceId が読めないレースは取らない） */
export function hasLayerDate(raceId) {
  const parsed = parseRaceId(raceId);
  return parsed !== null && parsed.date >= LAYER_FIRST_DATE;
}

/** 切り詰めたか（層の新しい順の上限で rows を切ったか）。上限の値（2,000）とは比べない */
export const isTruncated = (layer) => layer.n_returned < layer.n_total;

/**
 * 取得の状態（useAnalogyResource）から、表示中のレースの使える layer か。読み込み中は前のレースの data が
 * 返るので、status が ready で race_id が一致するときだけ使う
 * @param {{status: string, data: object|null}} state
 * @param {string} raceId
 */
export function usableLayer(state, raceId) {
  return (
    state.status === "ready" &&
    state.data?.status === "ok" &&
    state.data.race_id === raceId &&
    Array.isArray(state.data.rows) &&
    state.data.rows.length > 0
  );
}
