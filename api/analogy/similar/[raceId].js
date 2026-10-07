/**
 * Vercel Edge Function: アナロジー・ファインダー v16 の類似レース（タブ2、BOA-271 T5-1）
 *
 * GET /api/analogy/similar/{race_id}?stage=racecard|exhibition
 * 応答: status、似ている順の上位（最大800件。各件の33項目と結果）・層の条件と件数・比べる相手・全国・全レースで同じ割合。
 * stage=exhibition は展示後の段で並べ直したもの（exact＝候補の外のレースが入りえないか）。層の条件・比べる相手・
 * 全国・全レースで同じ割合・今日の表示用の値は出走表の段のファイル（similar-racecard）から合わせる（展示後の段の
 * ファイルは並べ直した neighbors だけを持つため）。展示後の段がまだ無いときは similar を返さない（画面は status で「展示前」等を出す）
 */
import {
  createHandler,
  objectPath,
  readObject,
} from "../../_lib/analogyV16.js";

export const config = { runtime: "edge" };

/** 展示後の並びに、出走表の段のファイルの層の情報を合わせる（どちらかが無ければ null） */
export function mergeExhibition(racecard, exhibition) {
  if (!racecard || !exhibition) return null;
  return {
    ...racecard,
    // 展示で決まる5項目は展示後の段が今日の展示の値で数え直した値（無い回は出走表の段の値のまま）
    pool_rate: { ...racecard.pool_rate, ...exhibition.pool_rate },
    // 5項目を数え直したか（画面は true のときだけ5項目の割合を出す。本当に0%の項目と、数え直していない0を分ける）
    pool_rate_exhibition: Boolean(exhibition.pool_rate),
    neighbors: exhibition.neighbors,
    exact: exhibition.exact,
  };
}

export default createHandler(async ({ raceId, stage, state, snapshot }) => {
  // 層が0件はタブ2だけの状態（plan の status の表）。欠場（absent）は共通の判定のまま
  if (
    state.racecard?.status === "empty_layer" &&
    state.exhibition?.status !== "absent"
  )
    return { status: "empty_layer", n_layer: 0 };
  if (!snapshot || snapshot.status !== "ok")
    return { n_layer: snapshot?.n_layer ?? null };
  const racecard = await readObject(
    objectPath(raceId, state.racecard.run_id, "similar-racecard", raceId),
  );
  if (stage !== "exhibition")
    return { run_id: snapshot.run_id, exact: null, similar: racecard };
  const exhibition = await readObject(
    objectPath(raceId, snapshot.run_id, "similar-exhibition", raceId),
  );
  return {
    run_id: snapshot.run_id,
    exact: snapshot.exact ?? null,
    similar: mergeExhibition(racecard, exhibition),
  };
});
