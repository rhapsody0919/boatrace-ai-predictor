import "./RacerGradeBadge.css";

/**
 * 選手級別（A1/A2/B1/B2）バッジ。RacerTable・RacerCompactRowで共用する
 * （docs/design/racer-search-and-list/screens.md参照）
 */
function RacerGradeBadge({ grade }) {
  if (!grade) return null;
  return (
    <span className={`racer-grade-badge racer-grade-${grade.toLowerCase()}`}>
      {grade}
    </span>
  );
}

export default RacerGradeBadge;
