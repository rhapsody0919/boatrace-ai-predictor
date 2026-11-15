/**
 * 思考アシスト（BOA-430）のセオリーカードとガイドのモデル。純粋関数だけ（取得・描画はしない）。
 * カードの形（spec FR-6、screens S-1b）: 条件 → 起きやすいこと → 今日（当てはまる／当てはまらない／展示の後に分かる）
 * → 過去レースの傾向（v16 の値。無いものは準備中）。「今日当てはまる」は v16 が今日の値で判定したものだけ（新しい自動検出は作らない）。
 * 検査は scripts/maintenance/verify-thinking-assist-summary.js（徳山10R 2026-10-06 の本番 v16 の値で固定）
 */
import { ATTACK_BOAT } from "./analogyScenario.js";
import { pct, theoryCard, windBandLabel } from "./assistTheoryCards.js";
import { ASSIST_COPY as C } from "../data/thinkingAssistCopy.js";

// セオリーカードの組み立ては assistTheoryCards.js。公開の名前はここから出す
export { theoryCard, windBandLabel };

// ---- ガイド（FR-10、screens S-1c）----

/**
 * ガイドの5段。各段1文（40字以内、D-32）。展示前は④を出し分ける。光らせる場所は data-guide の名前
 * @param {{post: boolean, rough: object|null, hintTop: object|null}} ctx
 * @returns {Array<{lens: string, target: string, step: string, q: string, sub: string, at: "top"|"bottom"}>}
 */
export function guideSteps({ post, rough, hintTop }) {
  const b1 = rough?.b1?.verdict;
  const m = rough?.manshu?.verdict;
  const roughSub =
    b1 && m
      ? C.guideRoughSub(C.guideVerdictWord[b1], C.guideVerdictWord[m])
      : C.guideRoughSubNone;
  const flowSub = hintTop
    ? C.guideFlowSub(
        C.formNames[hintTop.form],
        pct(hintTop.hit[0], hintTop.hit[1]),
        ATTACK_BOAT[hintTop.form] ?? null,
      )
    : C.guideFlowSubNone;
  return [
    {
      lens: "axis",
      target: "rough",
      ...C.guide[0],
      sub: roughSub,
      at: "bottom",
    },
    {
      lens: "axis",
      target: "axis",
      ...C.guide[1],
      sub: C.guideAxisSub,
      at: "top",
    },
    { lens: "flow", target: "board", ...C.guide[2], sub: flowSub, at: "top" },
    {
      lens: "power",
      target: "power",
      ...C.guide[3],
      sub: post ? C.guidePowerSubPost : C.guidePowerSubPre,
      at: "top",
    },
    {
      lens: "place",
      target: "board",
      ...C.guide[4],
      sub: C.guidePlaceSub,
      at: "top",
    },
    {
      lens: "bet",
      target: "foot",
      ...C.guide[5],
      sub: C.guideBetSub,
      at: "top",
    },
  ];
}
