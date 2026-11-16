import { Link } from "react-router-dom";
import {
  formatReturnRate,
  winReturnCellClassName,
} from "./RacerBoatReturnRateChartLogic";

function ReturnRateRow({ row, bestWinReturnBoats, t }) {
  return (
    <tr className="motor-ranking-row non-clickable-row">
      <td className="rank">{row.boat_number}</td>
      <td>
        <Link to={`/racer/${row.racer_id}`} translate="no">
          {row.player_name?.replace(/\s+/g, "")}
        </Link>
      </td>
      <td className="rate">{row.sample_count}</td>
      {/* 最良は行全体ではなく単勝回収率のセルに金枠（R1）。100%以上（買い続けて
          プラス）は緑（R2。データ出走表の .drt-plus と同じ基準） */}
      <td className={winReturnCellClassName(row, bestWinReturnBoats)}>
        {formatReturnRate(row.win_return_rate, t("analysis.noData"))}
      </td>
      <td className="rate">
        {formatReturnRate(row.place_return_rate, t("analysis.noData"))}
      </td>
    </tr>
  );
}

export default function RacerBoatReturnRateChartTable({
  breakdown,
  bestWinReturnBoats,
  t,
}) {
  return (
    <div className="table-wrapper">
      <table className="motor-ranking-table">
        <thead>
          <tr>
            <th>{t("analysis.laneHeader")}</th>
            <th>{t("table.playerName")}</th>
            <th>{t("analysis.returnRate.sample180Header")}</th>
            <th>{t("analysis.returnRate.winReturnHeader")}</th>
            <th>{t("analysis.returnRate.placeReturnHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((row) => (
            <ReturnRateRow
              key={row.boat_number}
              row={row}
              bestWinReturnBoats={bestWinReturnBoats}
              t={t}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
