import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import DrillDownHeader from "./DrillDownHeader";
import { SMALL_SAMPLE_THRESHOLD } from "../race/basicInfoStats";
import { formatRateOrCount } from "../../utils/smallSampleRate";
import "./MotorConditionChart.css";

/**
 * MotorRacerWakuDrillDown - 選手×モーター×枠(進入コース)の成績一覧
 * （BOA-301 FR-4）。MotorWakuStatsGridの特定コース行タップで開く。
 * サンプル数が最小になりやすい軸のため、n<6（SMALL_SAMPLE_THRESHOLD、
 * BOA-306と同じ閾値）の行は、nと率の両方を参考値の色にする（枠番別成績の表と
 * 同じく率にも色を付ける。nだけだと大きな緑の「100.0%」が目立ち注意が伝わらない。
 * 2026-09-28 ファン評価）。非表示化・合否判定はしない（
 * [[feedback_ui_visualization_over_statistical_rigor]]の方針を踏襲）
 */
function MotorRacerWakuDrillDown({ course, rows, onBack }) {
  const { t } = useTranslation();

  return (
    <div className="motor-racer-waku-drilldown">
      <DrillDownHeader
        onBack={onBack}
        backLabel={t("analysis.motor.racerWakuBackLabel")}
        heading={t("analysis.motor.racerWakuHeading", { course })}
      />
      {rows.length > 0 ? (
        <ul className="history-list motor-racer-waku-list">
          {rows.map((row) => {
            const isSmallSample = row.raceCount < SMALL_SAMPLE_THRESHOLD;
            return (
              <li key={row.racerId}>
                <Link
                  to={`/racer/${row.racerId}`}
                  translate="no"
                  className="usage-history-player racer-page-link-inline"
                >
                  {row.playerName?.replace(/\s+/g, "")}
                </Link>
                <span
                  className={`motor-waku-n ${isSmallSample ? "is-small-sample" : ""}`}
                >
                  {t("analysis.motor.sampleCount", { n: row.raceCount })}
                </span>
                <span
                  className={`usage-history-rate ${isSmallSample ? "is-small-sample" : ""}`}
                >
                  {t("analysis.motor.firstPlaceRateHeader")}{" "}
                  {formatRateOrCount(
                    row.winRate,
                    row.raceCount,
                    SMALL_SAMPLE_THRESHOLD,
                  )}
                </span>
                <span
                  className={`usage-history-rate ${isSmallSample ? "is-small-sample" : ""}`}
                >
                  {t("analysis.motor.legend2")}{" "}
                  {formatRateOrCount(
                    row.top2Rate,
                    row.raceCount,
                    SMALL_SAMPLE_THRESHOLD,
                  )}
                </span>
                <span
                  className={`usage-history-rate ${isSmallSample ? "is-small-sample" : ""}`}
                >
                  {t("analysis.motor.legend3")}{" "}
                  {formatRateOrCount(
                    row.top3Rate,
                    row.raceCount,
                    SMALL_SAMPLE_THRESHOLD,
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty-state">{t("analysis.motor.racerWakuEmpty")}</div>
      )}
      <p className="table-note">
        {t("analysis.motor.racerWakuNote", { n: SMALL_SAMPLE_THRESHOLD })}
      </p>
    </div>
  );
}

export default MotorRacerWakuDrillDown;
