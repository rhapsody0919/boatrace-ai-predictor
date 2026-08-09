/**
 * RacerFormRankingChart - 本日の好調・不調選手ランキング（BOA-166）
 * 本日出走する全選手を対象に、現在の全国勝率と約90日前時点の全国勝率のdeltaで
 * 急上昇/急下降ランキングを表示する。既存の「選手調子」（会場・レース選択→6選手比較）
 * とは異なり、レース選択前の発見導線として本日カード全体を横断する。
 */
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabaseDataService } from "../../services/supabaseDataService";
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

function RankingTable({ title, rows, emptyMessage }) {
  const { t } = useTranslation();
  return (
    <div className="table-wrapper">
      <h3 className="selected-motor-heading">{title}</h3>
      {rows.length === 0 ? (
        <div className="empty-state">{emptyMessage}</div>
      ) : (
        <table className="motor-ranking-table">
          <thead>
            <tr>
              <th>{t("table.playerName")}</th>
              <th>{t("analysis.venueHeader")}</th>
              <th>{t("analysis.racerForm.currentWinRateHeader")}</th>
              <th>{t("analysis.racerForm.past90Header")}</th>
              <th>{t("analysis.racerForm.deltaHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.racer_id} className="motor-ranking-row">
                <td>
                  <Link
                    to={`/winning-technique?venue_code=${row.venue_code}&race_id=${row.race_id}&tab=racer`}
                    translate="no"
                  >
                    {row.player_name?.replace(/\s+/g, "")}
                  </Link>
                </td>
                <td>
                  {t(
                    `venues.${row.venue_code}`,
                    VENUE_NAMES[row.venue_code] || "",
                  )}{" "}
                  {row.race_number}R
                </td>
                <td className="rate">{row.win_rate?.toFixed(2)}</td>
                <td className="rate">{row.past_win_rate?.toFixed(2)}</td>
                <td className="rate">
                  <span className={row.delta > 0 ? "delta-up" : "delta-down"}>
                    {row.delta > 0 ? "↑" : "↓"} {Math.abs(row.delta).toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

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
        const data = await supabaseDataService.getTodaysRacerFormRanking(10);
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
          <RankingTable
            title={t("analysis.formRanking.risingTitle")}
            rows={ranking.rising}
            emptyMessage={t("analysis.formRanking.empty")}
          />
          <RankingTable
            title={t("analysis.formRanking.fallingTitle")}
            rows={ranking.falling}
            emptyMessage={t("analysis.formRanking.empty")}
          />
        </>
      )}

      <p className="table-note">{t("analysis.formRanking.note")}</p>
    </div>
  );
}

export default RacerFormRankingChart;
