/**
 * 段（STEP）の場面を1つだけ描く合成（場面ごとの確認用）。props: { scene, answers }
 */
import { AbsoluteFill } from "remotion";
import { FONT } from "../fonts.js";
import { BG_BOTTOM, BG_TOP } from "./parts.js";
import { StepScene } from "./StepScene.jsx";

export function FullPictureStep({ scene, answers }) {
  if (!scene?.steps?.length)
    return <AbsoluteFill style={{ background: BG_BOTTOM, color: "#fff", fontFamily: FONT, fontSize: 48, alignItems: "center", justifyContent: "center" }}>材料が無い</AbsoluteFill>;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOTTOM} 100%)`, fontFamily: FONT, overflow: "hidden" }}>
      <StepScene scene={{ ...scene, answers }} />
    </AbsoluteFill>
  );
}
