/**
 * Vercel Edge Function: BOA-635 用の層の全件の結果（BOA-271 T5-1。plan「BOA-635 との接続」）
 *
 * GET /api/analogy/layer/{race_id}
 * 応答: layer ファイルの中身（キーは snake_case のまま）と status。
 *   status: ok／not_saved（racecard の snapshot が無い）／empty_layer／absent（欠場が分かった）。ok 以外は rows を返さない
 * 層は出走表の時点の値で決まるので、stage を取らない（展示後も racecard の段の layer を返す）
 */
import {
  cacheControl,
  deadlineOf,
  json,
  loadRaceState,
  objectPath,
  parseRequest,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

export function layerStatus(state) {
  if (state.exhibition?.status === "absent") return "absent";
  if (!state.racecard) return "not_saved";
  if (state.racecard.status === "empty_layer") return "empty_layer";
  return "ok";
}

export default async function handler(req) {
  let raceId;
  try {
    ({ raceId } = parseRequest(req));
  } catch (e) {
    return json({ error: e.message }, 400, "no-store");
  }
  try {
    const state = await loadRaceState(raceId);
    const deadline = deadlineOf(state.race);
    const passed = deadline !== null && Date.now() > deadline.getTime();
    const status = layerStatus(state);
    if (status !== "ok")
      return json(
        { status },
        200,
        cacheControl(status === "not_saved" ? "not_saved" : status, passed),
      );
    const layer = await readObject(
      objectPath(raceId, state.racecard.run_id, "layer", raceId),
    );
    if (!layer) return json({ status: "not_saved" }, 200, "no-store");
    return json({ status, ...layer }, 200, cacheControl(status, passed));
  } catch (e) {
    console.error("analogy v16 layer:", e);
    return json({ error: "upstream" }, 502, "no-store");
  }
}
