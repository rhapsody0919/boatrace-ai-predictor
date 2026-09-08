import { useNavigate } from "react-router-dom";
import "./RacerGradeBadge.css";
import "./RacerCompactRow.css";

/**
 * モバイル用の折りたたみ行（docs/design/racer-search-and-list/spec.md FR5）。
 * タップ領域を分離する: 行本体（名前・支部・勝率）は選手個別ページへ遷移し、
 * ▼アイコンだけが展開/折りたたみをトグルする（画面遷移は発生しない）
 */
function RacerCompactRow({ racer, isExpanded, onToggleExpand }) {
  const navigate = useNavigate();

  const handleChevronClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleExpand(racer.racer_id);
  };

  const goToRacer = () => navigate(`/racer/${racer.racer_id}`);

  return (
    <div className={`racer-compact-row ${isExpanded ? "is-expanded" : ""}`}>
      <div
        className="racer-compact-row-main"
        role="link"
        tabIndex={0}
        onClick={goToRacer}
        onKeyDown={(e) => {
          if (e.key === "Enter") goToRacer();
        }}
      >
        {racer.grade && (
          <span
            className={`racer-grade-badge racer-grade-${racer.grade.toLowerCase()}`}
          >
            {racer.grade}
          </span>
        )}
        <span className="racer-compact-row-name" translate="no">
          {racer.name?.replace(/\s+/g, "")}
        </span>
        <span className="racer-compact-row-branch">{racer.branch}</span>
        <span className="racer-compact-row-spacer" />
        <span className="racer-compact-row-win-rate">
          {racer.winRate != null ? racer.winRate.toFixed(2) : "-"}
        </span>
        <button
          type="button"
          className="racer-compact-row-chevron"
          onClick={handleChevronClick}
          aria-label={isExpanded ? "詳細を閉じる" : "詳細を開く"}
          aria-expanded={isExpanded}
        >
          ▼
        </button>
      </div>
      {isExpanded && (
        <dl className="racer-compact-row-detail">
          <dt>身長</dt>
          <dd>{racer.height_cm != null ? `${racer.height_cm}cm` : "-"}</dd>
          <dt>体重</dt>
          <dd>{racer.weight_kg != null ? `${racer.weight_kg}kg` : "-"}</dd>
          <dt>登録期</dt>
          <dd>{racer.registration_period ?? "-"}</dd>
          <dt>出身地</dt>
          <dd>{racer.hometown ?? "-"}</dd>
          <dt>年齢</dt>
          <dd>{racer.age != null ? `${racer.age}歳` : "-"}</dd>
        </dl>
      )}
    </div>
  );
}

export default RacerCompactRow;
