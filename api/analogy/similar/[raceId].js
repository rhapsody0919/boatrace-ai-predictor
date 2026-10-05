/**
 * Vercel Edge Function: アナロジー・ファインダー v16 の類似レース（タブ2、BOA-271 T5-1）
 *
 * GET /api/analogy/similar/{race_id}?stage=racecard|exhibition
 * 応答: status、似ている順の上位（最大800件。各件の33項目と結果）・層の条件と件数・比べる相手・全国・全レースで同じ割合。
 * stage=exhibition は展示後の段で並べ直したもの（exact＝候補の外のレースが入りえないか）。
 * 展示後の段がまだ無いときは similar を返さない（画面は status で「展示前」等を出す）
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

export default createHandler(async ({ raceId, stage, snapshot }) => {
  if (!snapshot || snapshot.status !== "ok")
    return { n_layer: snapshot?.n_layer ?? null };
  const kind =
    stage === "exhibition" ? "similar-exhibition" : "similar-racecard";
  const similar = await readObject(
    objectPath(raceId, snapshot.run_id, kind, raceId),
  );
  return {
    run_id: snapshot.run_id,
    exact: snapshot.exact ?? null,
    similar,
  };
});
