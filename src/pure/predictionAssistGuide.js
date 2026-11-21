/**
 * 思考アシスト（BOA-430）のガイドの段の組み立て。純粋関数だけ。
 * 文言は src/data に置く決まりなので、文言（C）と攻める艇の表（ATTACK_BOAT）は引数で受ける。
 * 本体は src/utils/assistTheory.js の guideSteps から字のまま移した（呼び出し側は assistTheory.js の guideSteps を読む）。
 */

const pct = (k, n) => (n ? Math.round((k / n) * 100) : 0);

/**
 * ガイドの5段。各段1文（40字以内、D-32）。展示前は④を出し分ける。光らせる場所は data-guide の名前
 * @param {object} C 文言（src/data/thinkingAssistCopy.js の ASSIST_COPY）
 * @param {Record<string, number>} ATTACK_BOAT 形ごとの攻める艇（src/utils/analogyScenario.js）
 * @param {{post: boolean, rough: object|null, hintTop: object|null}} ctx
 * @returns {Array<{lens: string, target: string, step: string, q: string, sub: string, at: "top"|"bottom"}>}
 */
export function guideStepsWith(C, ATTACK_BOAT, { post, rough, hintTop }) {
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
