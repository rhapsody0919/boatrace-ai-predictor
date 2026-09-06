/**
 * VenueCharacteristicsCard - 会場固有の水面特性カード
 * 枠番別の1着率（過去90日、outcome_distributionの集計）と主な決まり手
 * （winning_technique_stats）を組み合わせ、この会場の傾向を表示する。
 * AI予想（超展開予測・データ分析）が参照しているのと同じ会場別データを
 * 選手・レースデータと絡めて見せることで、会場別レース一覧ページの回遊性を高める。
 * /venueはTRANSLATED_PATHS対象のため、文言はi18nキー経由にする。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { translateTechnique } from "../race/raceIndicators";
import "./VenueCharacteristicsCard.css";

// このサンプル数を下回る会場は表示しない（ノイズが大きいため）
const MIN_TOTAL_RACES = 20;

export default function VenueCharacteristicsCard({ venueCode }) {
  const { t } = useTranslation();
  const [outcomeData, setOutcomeData] = useState(null);
  const [techniqueData, setTechniqueData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const [outcome, technique] = await Promise.all([
          supabaseDataService.getOutcomeDistribution(venueCode),
          supabaseDataService.getWinningTechniqueStats(venueCode),
        ]);
        if (cancelled) return;
        setOutcomeData(outcome);
        setTechniqueData(technique);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error("会場特性データ取得エラー:", err.message);
        setLoading(false);
      }
    };

    loadData();
    return () => {
      cancelled = true;
    };
  }, [venueCode]);

  if (loading || !outcomeData || outcomeData.total_races < MIN_TOTAL_RACES) {
    return null;
  }

  // outcome_distributionのprobabilityは各3連単パターンの出現率（対全レース）のため、
  // 同じ1着艇のパターンを合算するとその艇の1着率になる
  // （検証済み: venue_code=12の実データでsum(probability)とsum(count)/total_racesが一致）
  const boatRows = [1, 2, 3, 4, 5, 6].map((boat) => {
    const patterns = outcomeData.data[boat] ?? [];
    const winRate = patterns.reduce((sum, p) => sum + (p.probability ?? 0), 0);
    const topTechnique = techniqueData?.data?.[boat]?.techniques?.[0] ?? null;
    return { boat, winRate, topTechnique };
  });

  const hasAnyWinRate = boatRows.some((row) => row.winRate > 0);
  if (!hasAnyWinRate) return null;

  return (
    <div className="venue-characteristics-card">
      <h2>{t("venueCharacteristics.title")}</h2>
      <p className="venue-characteristics-note">
        {t("venueCharacteristics.note")}
      </p>
      <div className="table-wrapper">
        <table className="venue-characteristics-table">
          <thead>
            <tr>
              <th>{t("venueCharacteristics.boatHeader")}</th>
              <th>{t("venueCharacteristics.winRateHeader")}</th>
              <th>{t("venueCharacteristics.techniqueHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {boatRows.map((row) => (
              <tr key={row.boat}>
                <td>{row.boat}</td>
                <td>{row.winRate.toFixed(1)}%</td>
                <td>
                  {row.topTechnique
                    ? `${translateTechnique(t, row.topTechnique.technique)} ${row.topTechnique.percentage.toFixed(0)}%`
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="venue-characteristics-footnote">
        {t("venueCharacteristics.footnote", {
          count: outcomeData.total_races,
          date:
            outcomeData.last_updated ?? t("venueCharacteristics.unknownDate"),
        })}
      </p>
    </div>
  );
}
