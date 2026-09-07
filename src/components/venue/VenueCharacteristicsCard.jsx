/**
 * VenueCharacteristicsCard - 会場固有の水面特性カード（HUDテレメトリ表示）
 * 枠番別の1着率（過去90日、outcome_distributionの集計）と主な決まり手
 * （winning_technique_stats）を、コックピット計器盤風の発光バーで表示する。
 * バーは0-100%の絶対スケールで固定し、上部に0/25/50/75/100%の軸目盛りを表示。
 * 全国平均（24会場プール値）はトラック上のティックマーク＋浮動ラベルで示し、
 * 実数値との差分はピル型チップ（pt表示）で示す（2026-09-07、Artifactで承認済みの
 * デザイン案を踏襲。実装時に浮動ラベルを一度省略したがユーザー確認の結果、
 * 元の案通り浮動ラベルを表示する形に戻した）。
 * AI予想（超展開予測・データ分析）が参照しているのと同じ会場別データを
 * 選手・レースデータと絡めて見せることで、会場別レース一覧ページの回遊性を高める。
 * デザイン案はArtifact（レーダースイープ/HUDテレメトリ/ソナーリング）から
 * HUDテレメトリ案を採用（2026-09-07）。
 * /venueはTRANSLATED_PATHS対象のため、文言はi18nキー経由にする。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { translateTechnique } from "../race/raceIndicators";
import { BOAT_COLORS } from "../../utils/colors";
import "./VenueCharacteristicsCard.css";

// このサンプル数を下回る会場は表示しない（ノイズが大きいため）
const MIN_TOTAL_RACES = 20;

export default function VenueCharacteristicsCard({ venueCode }) {
  const { t } = useTranslation();
  const [outcomeData, setOutcomeData] = useState(null);
  const [techniqueData, setTechniqueData] = useState(null);
  const [venueInfo, setVenueInfo] = useState(null);
  const [nationalAverage, setNationalAverage] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      setLoading(true);
      try {
        const [outcome, technique, info, national] = await Promise.all([
          supabaseDataService.getOutcomeDistribution(venueCode),
          supabaseDataService.getWinningTechniqueStats(venueCode),
          supabaseDataService.getVenueCharacteristics(venueCode),
          supabaseDataService.getNationalAverageOutcomeDistribution(),
        ]);
        if (cancelled) return;
        setOutcomeData(outcome);
        setTechniqueData(technique);
        setVenueInfo(info);
        setNationalAverage(national);
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
    const national = nationalAverage?.[boat] ?? null;
    const delta = national != null ? winRate - national : null;
    return { boat, winRate, topTechnique, national, delta };
  });

  const hasAnyWinRate = boatRows.some((row) => row.winRate > 0);
  if (!hasAnyWinRate) return null;

  return (
    <div className="venue-characteristics-card">
      <div className="venue-hud-scanbar" aria-hidden="true" />
      <h2>{t("venueCharacteristics.title")}</h2>
      {venueInfo && (
        <p className="venue-characteristics-summary">
          {t(`venueCharacteristics.waterType.${venueInfo.waterType}`)}
          {" ・ "}
          {t(`venueCharacteristics.cluster.${venueInfo.cluster}`)}
        </p>
      )}
      <p className="venue-characteristics-note">
        {t("venueCharacteristics.note")}
      </p>
      <div className="venue-hud-header-row" aria-hidden="true">
        <span />
        <span className="venue-hud-axis-labels">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100%</span>
        </span>
        <span>{t("venueCharacteristics.deltaHeader")}</span>
        <span className="venue-hud-header-technique">
          {t("venueCharacteristics.techniqueHeader")}
        </span>
      </div>
      <div className="venue-hud-rows">
        {boatRows.map((row, index) => {
          const boatColor = BOAT_COLORS[row.boat] ?? {};
          const deltaUp = row.delta != null && row.delta >= 0;
          return (
            <div className="venue-hud-row" key={row.boat}>
              <span
                className="venue-hud-lane"
                style={{ background: boatColor.bg, color: boatColor.text }}
              >
                {row.boat}
              </span>
              <span className="venue-hud-track">
                <span className="venue-hud-grid-line" style={{ left: "25%" }} />
                <span className="venue-hud-grid-line" style={{ left: "50%" }} />
                <span className="venue-hud-grid-line" style={{ left: "75%" }} />
                <span
                  className="venue-hud-fill"
                  style={{
                    width: `${row.winRate}%`,
                    animationDelay: `${index * 0.08}s`,
                  }}
                />
                {row.national != null && (
                  <>
                    <span
                      className="venue-hud-national-tick"
                      style={{ left: `${row.national}%` }}
                    />
                    <span
                      className="venue-hud-national-label"
                      style={{ left: `${row.national}%` }}
                    >
                      {t("venueCharacteristics.nationalAverageTooltip", {
                        value: row.national.toFixed(1),
                      })}
                      <span className="venue-hud-national-label-line" />
                    </span>
                  </>
                )}
              </span>
              <span className="venue-hud-value-group">
                <span className="venue-hud-value">
                  {row.winRate.toFixed(1)}%
                </span>
                {row.delta != null && (
                  <span
                    className={`venue-hud-delta ${deltaUp ? "up" : "down"}`}
                  >
                    {deltaUp ? "+" : ""}
                    {row.delta.toFixed(1)}pt
                  </span>
                )}
              </span>
              <span className="venue-hud-technique">
                {row.topTechnique
                  ? `${translateTechnique(t, row.topTechnique.technique)} ${row.topTechnique.percentage.toFixed(0)}%`
                  : "-"}
              </span>
            </div>
          );
        })}
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
