/**
 * RacerBoatReturnRateChart - 選手×艇番別 回収率分析（BOA-167）
 * 本日開催中の会場・レースを選ぶと、出走6選手それぞれについて
 * 過去180日間・同じ艇番で出走したレースでの単勝回収率・複勝回収率を表示する。
 * AI予想モデルの確率は使わず、過去の実績払戻金のみを集計する。
 */
import { useTranslation } from "react-i18next";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { bestOf } from "../../utils/bestOf";
import RacerBoatReturnRateChartControls from "./RacerBoatReturnRateChartControls";
import RacerBoatReturnRateChartTable from "./RacerBoatReturnRateChartTable";
import { useRacerBoatReturnRateBreakdown } from "./RacerBoatReturnRateChartData";
import "./MotorConditionChart.css";

function RacerBoatReturnRateChart({
  initialVenueCode = null,
  initialRaceId = null,
  embedded = false,
}) {
  const { t } = useTranslation();
  const {
    venues,
    selectedVenue,
    setSelectedVenue,
    races,
    selectedRace,
    setSelectedRace,
    loading,
    setLoading,
    error,
    setError,
  } = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });
  const breakdown = useRacerBoatReturnRateBreakdown({
    selectedRace,
    setLoading,
    setError,
    t,
  });

  // 単勝回収率が最も高い艇（同値は全部）。表示と同じ整数で比べる（R1）。
  // 0% しかいないときは強調しない（> 0 の条件は以前から）
  const bestWinReturnBoats = bestOf(
    breakdown.map((r) => ({ boat: r.boat_number, value: r.win_return_rate })),
    "max",
    { digits: 0 },
  );

  return (
    <div className="motor-condition-container">
      {!embedded && (
        <>
          <h2>{t("analysis.returnRate.title")}</h2>
          <p className="section-description">
            {t("analysis.returnRate.description")}
          </p>
        </>
      )}

      {!embedded && (
        <RacerBoatReturnRateChartControls
          venues={venues}
          loading={loading}
          selectedVenue={selectedVenue}
          setSelectedVenue={setSelectedVenue}
          races={races}
          selectedRace={selectedRace}
          setSelectedRace={setSelectedRace}
          t={t}
        />
      )}

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading && !error && breakdown.length > 0 && (
        <RacerBoatReturnRateChartTable
          breakdown={breakdown}
          bestWinReturnBoats={bestWinReturnBoats}
          t={t}
        />
      )}

      <p className="table-note">{t("analysis.returnRate.note")}</p>
    </div>
  );
}

export default RacerBoatReturnRateChart;
