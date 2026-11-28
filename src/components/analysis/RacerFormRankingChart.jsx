/**
 * RacerFormRankingChart - 本日の好調・不調選手ランキング（BOA-166）
 * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
 * 急上昇/急下降ランキングを表示する。既存の「選手調子」（会場・レース選択→6選手比較）
 * とは異なり、レース選択前の発見導線として本日カード全体を横断する。
 * 差は表でなく差の棒で出す（FormRankingDiffBars、G4 T-21、2026-11-28 オーナー承認）。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getTodaysRacerFormRanking } from "../../services/racerQueries3.js";
import FormRankingDiffBars from "./FormRankingDiffBars";
import "./MotorConditionChart.css";

const VENUE_NAMES = {
  1: "桐生",
  2: "戸田",
  3: "江戸川",
  4: "平和島",
  5: "多摩川",
  6: "浜名湖",
  7: "蒲郡",
  8: "常滑",
  9: "津",
  10: "三国",
  11: "びわこ",
  12: "住之江",
  13: "尼崎",
  14: "鳴門",
  15: "丸亀",
  16: "児島",
  17: "宮島",
  18: "徳山",
  19: "下関",
  20: "若松",
  21: "芦屋",
  22: "福岡",
  23: "唐津",
  24: "大村",
};

function RacerFormRankingChart() {
  const { t } = useTranslation();
  const [ranking, setRanking] = useState({ rising: [], falling: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadRanking = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getTodaysRacerFormRanking(10);
        setRanking(data);
      } catch (err) {
        setError(err.message || t("analysis.dataLoadError"));
        console.error("Failed to load today's racer form ranking:", err);
      } finally {
        setLoading(false);
      }
    };
    loadRanking();
  }, []);

  const isEmpty = ranking.rising.length === 0 && ranking.falling.length === 0;
  const venueLabel = (row) =>
    t(`venues.${row.venue_code}`, VENUE_NAMES[row.venue_code] || "");

  return (
    <div className="motor-condition-container">
      <h2>{t("analysis.formRanking.title")}</h2>
      <p className="section-description">
        {t("analysis.formRanking.description")}
      </p>

      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {!loading && !error && isEmpty && (
        <div className="empty-state">{t("analysis.noRacesToday")}</div>
      )}

      {!loading && !error && !isEmpty && (
        <>
          <FormRankingDiffBars
            title={t("analysis.formRanking.risenTitle")}
            rows={ranking.rising}
            direction="up"
            venueLabel={venueLabel}
            emptyMessage={t("analysis.formRanking.empty")}
          />
          <FormRankingDiffBars
            title={t("analysis.formRanking.fallenTitle")}
            rows={ranking.falling}
            direction="down"
            venueLabel={venueLabel}
            emptyMessage={t("analysis.formRanking.empty")}
          />
        </>
      )}

      <p className="table-note">{t("analysis.formRanking.note")}</p>
    </div>
  );
}

export default RacerFormRankingChart;
