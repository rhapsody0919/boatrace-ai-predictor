import { Link } from "react-router-dom";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import TrendLineChart from "../analysis/TrendLineChart";
import "./RacerMotorStatusCard.css";

/**
 * 選手個別ページの「今節のモーター状況」カード（BOA-265）
 * 直近の出走から今節のモーター番号を特定し、機力指数（このモーターの通算
 * 実績と選手自身の実力の差、他選手の実績も含む）と、この選手が今節この
 * モーターに乗ってからの展示タイム推移（この選手自身のデータのみ）を表示する。
 * モーターの2連率/3連率そのものは複数選手の実績が混ざるため選手ページには
 * 載せない（モーター単体の通算成績を見たい場合は分析ツール「モーター調子」
 * タブへ誘導する）。今日の判断に直結する情報のため、過去90日〜2年の集計系
 * セクション群より上（プロフィール直下）に固定表示する。
 * データが無い選手（デビュー直後等）ではカード自体を表示しない
 */
export default function RacerMotorStatusCard({ status }) {
  if (!status) return null;

  const { raceId, venueCode, motorNumber, powerIndex, meetTrend } = status;
  const venueName = VENUE_NAMES[venueCode] ?? `${venueCode}`;
  const chartData = (meetTrend ?? []).map((row) => ({
    date: row.date.slice(5),
    exhibition_time: row.exhibition_time,
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
        <>
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
          <p className="racer-motor-status-note">
            💡
            機力指数は「このモーターに乗った過去のレースで実際に2着以内だったか」−「その時乗っていた選手自身の全国2連率」の差を全レース分平均した値です。プラスが大きいほど、乗った選手の実力を超えて走っているモーターと言えます（このモーターを過去に使った他の選手の実績も含みます）。
          </p>
        </>
      )}

      {chartData.length > 1 ? (
        <>
          <p className="racer-motor-status-chart-caption">
            今節（{chartData[0].date}〜{chartData[chartData.length - 1].date}）
            、この選手がこのモーターで出走してからの展示タイム
          </p>
          <TrendLineChart
            data={chartData}
            yAxisLabel="展示タイム (秒)"
            tooltipFormatter={(value) => value.toFixed(2)}
            series={[
              {
                dataKey: "exhibition_time",
                name: "展示タイム",
                stroke: "var(--brand-accent-primary)",
                type: "monotone",
              },
            ]}
          />
        </>
      ) : (
        <p className="racer-motor-status-empty">
          今節はまだこのモーターでの出走数が少なく、推移は表示できません。
        </p>
      )}

      <Link
        to={`/winning-technique?venue_code=${venueCode}&race_id=${raceId}&tab=motor&motor=${motorNumber}`}
        className="racer-motor-status-link"
      >
        → モーター調子で詳しく見る（このモーターの通算成績）
      </Link>
    </div>
  );
}
