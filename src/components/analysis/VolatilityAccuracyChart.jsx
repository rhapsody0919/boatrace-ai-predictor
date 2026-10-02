/**
 * VolatilityAccuracyChart - 新AI予想モデル（unified）のイン崩れ指数の実績（BOA-177）
 *
 * 他のタブと異なり、日次のレースデータではなく蓄積された履歴統計を表示する
 * （VenueRankingChartと同様、会場・レースを選ばない）。
 * scripts/daily/calculate-unified-volatility-accuracy.js が日次で
 * accuracy_cache（key: unified_volatility_accuracy）に保存した値を読むだけ。
 *
 * unifiedモデルは2026-08-11運用開始のため、当面はサンプル数が少ない
 * （volatilityPercentileIsFallback=falseの実測値のみを対象としているため、
 * 運用開始直後は特に少ない）。件数を明示し、小標本であることを正直に示す。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabaseDataService } from "../../services/supabaseDataService";
import { VolatilityAccuracySection } from "../accuracy";
import "./MotorConditionChart.css";

function VolatilityAccuracyChart() {
  const { t } = useTranslation();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabaseDataService
      .getUnifiedVolatilityAccuracy()
      .then((data) => {
        if (!cancelled) setStats(data);
      })
      .catch((err) => {
        console.error("Failed to load unified volatility accuracy:", err);
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="empty-state">{t("volatilityAccuracy.loading")}</div>;
  }

  if (error || !stats || !stats.baseline || stats.baseline.raceCount === 0) {
    return <div className="empty-state">{t("volatilityAccuracy.noData")}</div>;
  }

  return (
    <div>
      <VolatilityAccuracySection stats={stats} />
      <p className="volatility-accuracy-chart-note">
        {t("volatilityAccuracy.chartNote", {
          count: stats.baseline.raceCount,
        })}
      </p>
    </div>
  );
}

export default VolatilityAccuracyChart;
