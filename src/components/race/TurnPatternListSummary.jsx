import { useTranslation } from "react-i18next";

// レース後モードのまとめ。不成立は「判定対象外（不成立）」、それ以外は的中・不的中の一文
function TurnPatternListSummary({
  isNotJudgeable,
  hasHit,
  asPredicted,
  actualWinner,
}) {
  const { t } = useTranslation();
  if (isNotJudgeable) {
    return (
      <div className="turn-pattern-summary turn-pattern-summary--void">
        <p className="turn-pattern-summary-title">
          {t("turnPatternList.notJudgeable")}
        </p>
        <p className="turn-pattern-summary-body">
          {t("turnPatternList.notJudgeableBody")}
        </p>
      </div>
    );
  }
  return (
    <p
      className={`turn-pattern-summary${hasHit ? " turn-pattern-summary--hit" : " turn-pattern-summary--miss"}`}
    >
      {hasHit
        ? t(
            asPredicted
              ? "turnPatternList.summaryAsPredicted"
              : "turnPatternList.summaryHit",
          )
        : t("turnPatternList.summaryMiss", { winnerNumber: actualWinner })}
    </p>
  );
}

export default TurnPatternListSummary;
