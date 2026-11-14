import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../utils/analytics";

// この艇が1着だった場合の確率に補正する。分母データが取得できない場合のみ
// 元の値（会場全体のレース数が分母、実際より過小な数値）にフォールバックする
const displayRate = (pattern, boatTotalRaces) =>
  boatTotalRaces
    ? (pattern.count / boatTotalRaces) * 100
    : pattern.probability;

function OutcomePatternPreviewTable({
  topPatterns,
  firstBoat,
  boatTotalRaces,
  venueCode,
  venueName,
}) {
  const { t } = useTranslation();
  return (
    <div className="table-wrapper">
      <table className="pattern-table">
        <thead>
          <tr>
            <th>{t("outcomePreview.rank")}</th>
            <th>{t("betting.trifecta")}</th>
            <th>{t("outcomePreview.count")}</th>
            <th>{t("outcomePreview.rate")}</th>
            <th>{t("outcomePreview.avgPayout")}</th>
          </tr>
        </thead>
        <tbody>
          {topPatterns.map((pattern, idx) => (
            <tr key={idx}>
              <td className="rank">{idx + 1}</td>
              <td className="trifecta">
                {firstBoat}-{pattern.second_boat}-{pattern.third_boat}
              </td>
              <td className="count">{pattern.count}</td>
              <td className="probability">
                {displayRate(pattern, boatTotalRaces).toFixed(2)}%
              </td>
              <td className="payout">
                {pattern.avg_payout
                  ? `¥${pattern.avg_payout.toLocaleString()}`
                  : "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Link
        to={`/winning-technique?venue_code=${venueCode}&tab=outcome`}
        className="detail-link"
        onClick={() =>
          trackEvent("deep_link_click", {
            tab: "outcome",
            link_source: "outcome_pattern_preview",
          })
        }
      >
        {t("outcomePreview.detailLink", { venue: venueName })}
      </Link>
    </div>
  );
}

export default OutcomePatternPreviewTable;
