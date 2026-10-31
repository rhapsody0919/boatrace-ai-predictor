import { useTranslation } from "react-i18next";
import { buildRaceSummaryRows } from "../../utils/raceSummaryRows";
import RacerLink from "./assist/RacerLink";
import BoatBadge from "./BoatBadge";
import "./RaceSummaryTable.css";

/**
 * レース詳細のタブの上に置く6艇の要約（BOA-1189 GS01-c、2026-10-31 オーナー決定）。
 * 1行1艇・艇番の順。確定後だけ着順の列を左端に出す。選手名は /racer/N へのリンク。
 * 展示タイムは秒数と6艇の中の順位（小さいほど速い）。色付けはしない
 *
 * @param {boolean} props.showExhibitionPending 展示前（本日の締切前で展示タイムが無い）なら true。
 *   展示タイムの列は「—」にし、表の下に「展示タイムは締切の約15分前に出る」を出す
 */
export default function RaceSummaryTable({
  players,
  exhibitionData,
  result,
  showExhibitionPending,
}) {
  const { t } = useTranslation();
  const { rows, hasExhibition, hasResult } = buildRaceSummaryRows(
    players,
    exhibitionData,
    result,
  );
  if (rows.length === 0) return null;
  const pending = !hasExhibition && showExhibitionPending;

  return (
    <section
      className="race-summary-table"
      data-testid="race-summary-table"
      aria-label={t("raceSummary.title")}
    >
      <table className="race-summary-table__table">
        <thead>
          <tr>
            {hasResult && (
              <th scope="col" className="race-summary-table__finish">
                {t("raceSummary.colFinish")}
              </th>
            )}
            <th scope="col" className="race-summary-table__boat">
              {t("raceSummary.colBoat")}
            </th>
            <th scope="col" className="race-summary-table__racer">
              {t("raceSummary.colRacer")}
            </th>
            <th scope="col" className="race-summary-table__grade">
              {t("raceSummary.colGrade")}
            </th>
            <th scope="col" className="race-summary-table__exh">
              {t("raceSummary.colExh")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.number}>
              {hasResult && (
                <td className="race-summary-table__finish">
                  {row.finish != null
                    ? t("raceSummary.finishValue", { rank: row.finish })
                    : row.refunded
                      ? t("raceSummary.finishRefunded")
                      : t("raceSummary.noValue")}
                </td>
              )}
              <td className="race-summary-table__boat">
                <BoatBadge n={row.number} size="sm" />
              </td>
              <td className="race-summary-table__racer">
                <RacerLink
                  racerId={row.racerId}
                  className="race-summary-table__racer-link"
                >
                  {row.name}
                </RacerLink>
              </td>
              <td className="race-summary-table__grade" translate="no">
                {row.grade ?? t("raceSummary.noValue")}
              </td>
              <td className="race-summary-table__exh">
                {row.exhTime != null ? (
                  <>
                    <span className="race-summary-table__exh-time">
                      {row.exhTime.toFixed(2)}
                    </span>{" "}
                    <small className="race-summary-table__exh-rank">
                      {t(
                        row.exhTied
                          ? "raceSummary.exhRankTied"
                          : "raceSummary.exhRank",
                        { rank: row.exhRank },
                      )}
                    </small>
                  </>
                ) : (
                  t("raceSummary.noValue")
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasExhibition && (
        <p className="race-summary-table__note">{t("raceSummary.exhNote")}</p>
      )}
      {/* 展示の前は、案内を表の下の1行に出す。列の中に置くと、375px で選手の列が細くなり名前が途中で
          折れた（ファン評価1周目 指摘3） */}
      {pending && (
        <p className="race-summary-table__note">
          {t("raceSummary.exhPending")}
        </p>
      )}
    </section>
  );
}
