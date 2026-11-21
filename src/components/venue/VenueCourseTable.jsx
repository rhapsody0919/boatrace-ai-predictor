/**
 * 会場の進入コース別の1着率の表（直近1年、BOA-1687 GS02 V1）。
 * 列は 進入コース・1着率・全国・1着の回数。母数と期間は表の上の行（VenueCharacteristicsCard）に書く。
 * 行は進入コース（枠番ではない）なので、艇の色は使わない（number-wording.md）
 */
import { formatCount, formatRate } from "../../utils/venueSummary";
import "./VenueCourseTable.css";

export default function VenueCourseTable({ t, rows }) {
  return (
    <table className="venue-course-table" data-testid="venue-course-table">
      <thead>
        <tr>
          <th scope="col">{t("venueCharacteristics.courseColumn")}</th>
          <th scope="col">{t("venueCharacteristics.winRateColumn")}</th>
          <th scope="col">{t("venueCharacteristics.techniqueNational")}</th>
          <th scope="col">{t("venueCharacteristics.winsColumn")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.course} data-testid={`venue-course-row-${row.course}`}>
            <th scope="row">
              {t("venueCharacteristics.courseLabel", { course: row.course })}
            </th>
            <td className="venue-course-table__own">{formatRate(row.rate)}%</td>
            <td>
              {row.nationalRate == null
                ? "—"
                : `${formatRate(row.nationalRate)}%`}
            </td>
            <td>{formatCount(row.wins)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
