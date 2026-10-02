import { useNavigate, Link } from "react-router-dom";
import RacerGradeBadge from "./RacerGradeBadge";
import { COLUMNS } from "./racerColumns";
import "./RacerTable.css";

/**
 * デスクトップ用のソート可能な選手一覧テーブル（docs/design/racer-search-and-list/）。
 * `racers`は表示対象1ページ分（ソート・フィルタ・ページングは呼び出し側で適用済み）
 */
function RacerTable({ racers, sortKey, sortDir, onSortChange }) {
  const navigate = useNavigate();

  return (
    <div className="racer-table-wrap">
      <table className="racer-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                className={sortKey === col.key ? "is-sorted" : ""}
                onClick={col.sortable ? () => onSortChange(col.key) : undefined}
                style={col.sortable ? { cursor: "pointer" } : undefined}
              >
                {col.label}
                {col.sortable && sortKey === col.key && (
                  <span className="racer-table-sort-arrow">
                    {sortDir === "asc" ? "▲" : "▼"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {racers.map((racer) => (
            <tr
              key={racer.racer_id}
              onClick={() => navigate(`/racer/${racer.racer_id}`)}
            >
              <td className="racer-table-name-cell">
                <Link
                  to={`/racer/${racer.racer_id}`}
                  onClick={(e) => e.stopPropagation()}
                  translate="no"
                >
                  {racer.name?.replace(/\s+/g, "")}
                </Link>
              </td>
              <td>{racer.branch ?? "-"}</td>
              <td>{racer.height_cm != null ? `${racer.height_cm}cm` : "-"}</td>
              <td>{racer.weight_kg != null ? `${racer.weight_kg}kg` : "-"}</td>
              <td>
                {racer.grade ? <RacerGradeBadge grade={racer.grade} /> : "-"}
              </td>
              <td>{racer.registration_period ?? "-"}</td>
              <td>{racer.hometown ?? "-"}</td>
              <td>{racer.winRate != null ? racer.winRate.toFixed(2) : "-"}</td>
              <td>{racer.age ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default RacerTable;
