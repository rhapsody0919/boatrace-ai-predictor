import { Link } from "react-router-dom";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import TrendLineChart from "../analysis/TrendLineChart";
import "./RacerMotorStatusCard.css";

/**
 * 選手個別ページの「今節のモーター状況」カード（BOA-265）
 * 直近の出走から今節のモーター番号を特定し、機力指数と節ごとの推移を
 * ミニ表示する。今日の判断に直結する情報のため、過去90日〜2年の集計系
 * セクション群より上（プロフィール直下）に固定表示する。
 * データが無い選手（デビュー直後等）ではカード自体を表示しない
 */
export default function RacerMotorStatusCard({ status }) {
  if (!status) return null;

  const { raceId, venueCode, motorNumber, powerIndex, trend } = status;
  const venueName = VENUE_NAMES[venueCode] ?? `${venueCode}`;
  const chartData = (trend?.trend ?? []).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
  }));

  const hasPowerIndex =
    powerIndex?.power_index !== null && powerIndex?.power_index !== undefined;
  const indexClass = hasPowerIndex
    ? powerIndex.power_index > 0
      ? "power-index-good"
      : powerIndex.power_index < 0
        ? "power-index-bad"
        : ""
    : "";

  return (
    <div className="racer-motor-status-card">
      <h2 className="racer-motor-status-title">🔧 今節のモーター状況</h2>
      <p className="racer-motor-status-subtitle">
        {venueName}・{motorNumber}号機
      </p>

      {hasPowerIndex && (
        <p className={`racer-motor-status-index ${indexClass}`}>
          機力指数 {powerIndex.power_index > 0 ? "+" : ""}
          {powerIndex.power_index.toFixed(1)}
          （過去90日・{powerIndex.sample_count}走の平均） —{" "}
          {powerIndex.power_index > 0
            ? "実力以上に走っている"
            : powerIndex.power_index < 0
              ? "選手の実力より低調"
              : "実力相応"}
        </p>
      )}

      {chartData.length > 0 && (
        <TrendLineChart
          data={chartData}
          yAxisLabel="出現率 (%)"
          tooltipFormatter={(value) => `${value.toFixed(1)}%`}
          series={[
            {
              dataKey: "motor_2rate",
              name: "2連率",
              stroke: "var(--brand-accent-primary)",
              type: "stepAfter",
            },
            {
              dataKey: "motor_3rate",
              name: "3連率",
              stroke: "var(--brand-accent-secondary)",
              type: "stepAfter",
            },
          ]}
        />
      )}

      <Link
        to={`/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=motor&motor=${motorNumber}`}
        className="racer-motor-status-link"
      >
        → モーター調子で詳しく見る
      </Link>
    </div>
  );
}
