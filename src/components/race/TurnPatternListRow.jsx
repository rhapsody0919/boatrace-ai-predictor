import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";
import { TECHNIQUE_NAMES, techniqueDiffers } from "../../utils/turnPrediction";

const RANK_ICONS = ["🥇", "🥈", "🥉"];

// 実際の決まり手を添えるか。予想した決まり手が外れていても艇が1着なら的中になる
function showsActualTechnique(
  isMatch,
  actualTechniqueKey,
  pattern,
  actualTechnique,
) {
  return (
    isMatch &&
    actualTechniqueKey &&
    techniqueDiffers(TECHNIQUE_NAMES[pattern.technique], actualTechnique)
  );
}

function TurnPatternListRow({
  pattern,
  index,
  isMatch,
  isRefunded,
  isNotJudgeable,
  actualTechnique,
  actualTechniqueKey,
}) {
  const { t } = useTranslation();
  // patterns[].technique は "nige"/"sashi" 等の英語キー（TECHNIQUE_KEY_BY_NAMEの
  // 日本語名→キーとは向きが逆。FirstMarkAnimation.jsxのuseTechniqueLabelと同じ変換）
  const translateTechnique = (key) =>
    t(`techniques.${key}`, TECHNIQUE_NAMES[key] || key);
  const colors = BOAT_COLORS[pattern.winnerCourse] || BOAT_COLORS[1];
  return (
    <div
      className={`turn-pattern-row${isMatch ? " turn-pattern-row--hit" : ""}${isNotJudgeable || isRefunded ? " turn-pattern-row--void" : ""}`}
    >
      <span className="turn-pattern-rank">
        {RANK_ICONS[index] || `${index + 1}`}
      </span>
      <span
        className="turn-pattern-boat"
        style={{ background: colors.bg, color: colors.text }}
      >
        {pattern.winnerCourse}
      </span>
      {/* 艇の印。判定は1着の艇だけで決まり手は見ないため、決まり手と%の後ろに付けると
          「その決まり手が当たった」と読めた（BOA-724）。艇番の隣に移しても「的中 差し」と
          続いて読めたので、文言も「1着」にした（ファン評価2周目） */}
      {isMatch && (
        <span className="turn-pattern-hit-tag">
          {t("turnPatternList.hitTag")}
        </span>
      )}
      <span className="turn-pattern-technique">
        {translateTechnique(pattern.technique)}
        {/* 予想した決まり手が外れていても艇が1着なら的中になる。「① 的中 逃げ」だけだと
            逃げが当たったと読めるので、実際の決まり手を添える（BOA-724。カードと同じ） */}
        {showsActualTechnique(
          isMatch,
          actualTechniqueKey,
          pattern,
          actualTechnique,
        ) && (
          <span className="turn-pattern-actual">
            {t("turnPatternList.actualTechnique", {
              technique: translateTechnique(actualTechniqueKey),
            })}
          </span>
        )}
      </span>
      <span className="turn-pattern-prob">
        {Math.round(pattern.probability * 100)}%
      </span>
      {isRefunded && (
        <span className="turn-pattern-void-tag">
          {t("turnPatternList.refundedTag")}
        </span>
      )}
    </div>
  );
}

export default TurnPatternListRow;
