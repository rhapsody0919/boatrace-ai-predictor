import { Link } from "react-router-dom";
import RacerGradeBadge from "./RacerGradeBadge";
import "./RacerCompactRow.css";

/**
 * モバイル用の折りたたみ行（docs/design/racer-search-and-list/spec.md FR5）。
 * タップ領域を分離する: 行本体（名前・支部・勝率）は選手個別ページへ遷移し、
 * ▼アイコンだけが展開/折りたたみをトグルする（画面遷移は発生しない）。
 *
 * 行本体は本物の <Link>（href を持つ）にする。以前は <div role="link"> + navigate() で、
 * 新しいタブで開けず、長押しで URL も取れなかった。▼ボタンはリンクの中に入れず
 * 兄弟要素に置く（操作できる要素の入れ子は支援技術で正しく読めない、BOA-470）
 */
function RacerCompactRow({ racer, isExpanded, onToggleExpand }) {
  return (
    <div className={`racer-compact-row ${isExpanded ? "is-expanded" : ""}`}>
      <div className="racer-compact-row-head">
        <Link
          to={`/racer/${racer.racer_id}`}
          className="racer-compact-row-main"
        >
          <RacerGradeBadge grade={racer.grade} />
          <span className="racer-compact-row-name" translate="no">
            {racer.name?.replace(/\s+/g, "")}
          </span>
          <span className="racer-compact-row-branch">{racer.branch}</span>
          <span className="racer-compact-row-spacer" />
          <span className="racer-compact-row-win-rate">
            <span className="racer-compact-row-win-rate-label">勝率</span>
            <span className="racer-compact-row-win-rate-value">
              {racer.winRate != null ? racer.winRate.toFixed(2) : "-"}
            </span>
          </span>
        </Link>
        <button
          type="button"
          className="racer-compact-row-chevron"
          onClick={() => onToggleExpand(racer.racer_id)}
          aria-label={isExpanded ? "詳細を閉じる" : "詳細を開く"}
          aria-expanded={isExpanded}
        >
          ▼
        </button>
      </div>
      {isExpanded && (
        <div className="racer-compact-row-detail">
          <div className="racer-compact-row-detail-pair">
            <span className="detail-label">身長</span>
            <span className="detail-value">
              {racer.height_cm != null ? `${racer.height_cm}cm` : "-"}
            </span>
          </div>
          <div className="racer-compact-row-detail-pair">
            <span className="detail-label">体重</span>
            <span className="detail-value">
              {racer.weight_kg != null ? `${racer.weight_kg}kg` : "-"}
            </span>
          </div>
          <div className="racer-compact-row-detail-pair">
            <span className="detail-label">登録期</span>
            <span className="detail-value">
              {racer.registration_period ?? "-"}
            </span>
          </div>
          <div className="racer-compact-row-detail-pair">
            <span className="detail-label">出身地</span>
            <span className="detail-value">{racer.hometown ?? "-"}</span>
          </div>
          <div className="racer-compact-row-detail-pair">
            <span className="detail-label">年齢</span>
            <span className="detail-value">
              {racer.age != null ? `${racer.age}歳` : "-"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

export default RacerCompactRow;
