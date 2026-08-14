/**
 * PlaceRecommendationPanel - 複勝予想パネル（2026-08-14〜）
 *
 * 背景: 複勝予想（AIの結論）が、データ出走表（客観的な生データの一覧）の
 * 1行として埋め込まれていたため、「単なる指標の1つ」に見えてしまい、
 * AIの予想であることが埋もれていた。展開予測・イン崩れ指数と同じく、
 * AIの結論として独立したパネルで見せる（データ出走表からは「複勝予想」行を
 * 削除し、根拠となる「コース別勝率」行は客観的な生データとして残した）。
 *
 * 根拠のコース別勝率算出は raceIndicators.jsx の getPlaceRecommendation を
 * データ出走表と共有し、二重実装を避けている。
 */
import { useTranslation } from "react-i18next";
import { useRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { BOAT_COLORS } from "../../utils/colors";
import { getPlaceRecommendation, toNumber } from "./raceIndicators";
import "./PlaceRecommendationPanel.css";

function PlaceRecommendationPanel({ raceId, players }) {
  const { t } = useTranslation();
  const analysis = useRaceAnalysisData(raceId);
  const { racerStats, placeOdds, pending } = analysis;

  if (!Array.isArray(players) || players.length === 0) return null;

  if (pending.racerStats && !racerStats) {
    return (
      <div className="place-recommendation-panel">
        <span className="drt-skeleton" aria-hidden="true" />
      </div>
    );
  }

  const picks = getPlaceRecommendation(players, racerStats);
  if (picks.length === 0) return null;

  const placeOddsByBoat = new Map(
    (placeOdds ?? []).map((o) => [o.boat_number, o]),
  );

  return (
    <div className="place-recommendation-panel">
      <p className="place-recommendation-basis">
        {t("placeRecommendation.basis")}
      </p>
      {picks.map((pick, index) => {
        const colors = BOAT_COLORS[pick.boat] || BOAT_COLORS[1];
        const boatOdds = placeOddsByBoat.get(pick.boat);
        const oddsLow = toNumber(boatOdds?.odds_place_low);
        const oddsHigh = toNumber(boatOdds?.odds_place_high);
        return (
          <div className="place-recommendation-row" key={pick.boat}>
            <span className="place-recommendation-mark">
              {index === 0 ? "◎" : "○"}
            </span>
            <span
              className="place-recommendation-boat"
              style={{ background: colors.bg, color: colors.text }}
            >
              {pick.boat}
            </span>
            <span className="place-recommendation-name" translate="no">
              {pick.name?.replace(/\s+/g, "")}
            </span>
            <span className="place-recommendation-rank-label">
              {t("dataTable.placeBadgeLabel", { rank: index + 1 })}
            </span>
            <span className="place-recommendation-rate">
              {t("placeRecommendation.courseRateLabel", {
                rate: pick.courseRate.rate.toFixed(0),
                wins: pick.courseRate.wins,
                total: pick.courseRate.total,
              })}
            </span>
            {pending.placeOdds ? (
              <span className="drt-skeleton" aria-hidden="true" />
            ) : oddsLow !== null && oddsHigh !== null ? (
              <span className="place-recommendation-odds">
                {t("dataTable.placeOddsLabel", {
                  low: oddsLow.toFixed(1),
                  high: oddsHigh.toFixed(1),
                })}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default PlaceRecommendationPanel;
