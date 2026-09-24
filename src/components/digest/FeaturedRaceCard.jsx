/**
 * FeaturedRaceCard - 「今日の注目レース」（BOA-402、screens.md C-5 / spec FR-6）
 *
 * 競合（ボートレース日和）のページは表が並ぶだけで優先順位が無い。
 * 1日1レースだけを根拠つきで先頭に出すことが、このページの中核の差別化
 * （handoff-memo §5「文脈・解釈の付加」）。
 *
 * 選定は早朝バッチ側（generate-morning-digest.js）で決定的に行い、
 * 理由の文も `detail.reason` に保存済み。ここでは表示しかしない。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import "./FeaturedRaceCard.css";

const SECTION_LABEL = {
  nige: "逃げ率",
  makuri: "まくり率",
  nigashi: "逃がし率",
};

function FeaturedRaceCard({ row }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const venueName = t(`venues.${row.venue_code}`);
  const metricLabel = SECTION_LABEL[row.detail?.from] ?? "指標";

  return (
    <section className="featured-race" aria-labelledby="featured-race-title">
      <div className="featured-race__bar" />
      <div className="featured-race__body">
        <h2 id="featured-race-title" className="featured-race__eyebrow">
          今日の注目レース
        </h2>

        <div className="featured-race__head">
          <span className="featured-race__race" translate="no">
            {venueName} {row.race_number}R
          </span>
          {row.start_time && (
            <span className="featured-race__deadline">
              締切 {String(row.start_time).slice(0, 5)}
            </span>
          )}
        </div>

        <div className="featured-race__racer">
          <span className="featured-race__racer-id" translate="no">
            {row.racer_id}
          </span>
          <span className="featured-race__racer-name" translate="no">
            {row.racer_name}
          </span>
          {row.grade && (
            <span className="featured-race__grade" translate="no">
              {row.grade}
            </span>
          )}
          {row.boat_number && (
            <span className="featured-race__boat">枠{row.boat_number}</span>
          )}
        </div>

        <div className="featured-race__stats">
          <div className="featured-race__stat">
            {/* 出すのは集計した事実だけ。「この会場での見込み」は計算で作った推定値
                なので載せない（2026-09-24、RateWithBaseline と同じ改訂）。
                対象範囲（全国／この会場）は必ずラベルに書く */}
            <span className="featured-race__stat-label">
              {metricLabel}（{row.course}コース）
            </span>
            <span className="featured-race__stat-value">
              {Number(row.metric_value).toFixed(1)}
              <span className="featured-race__stat-unit">%</span>
            </span>
            <span className="featured-race__stat-sub">
              全国{row.sample_size}走の実績
              {row.metric_venue_baseline !== null &&
                `／${venueName}の平均 ${Number(row.metric_venue_baseline).toFixed(1)}%`}
            </span>
          </div>
          {row.volatility_percentile !== null && (
            <div className="featured-race__stat">
              <span className="featured-race__stat-label">イン崩れ指数</span>
              <span className="featured-race__stat-value featured-race__stat-value--plain">
                {Math.round(Number(row.volatility_percentile))}
                <span className="featured-race__stat-unit">%</span>
              </span>
              <span className="featured-race__stat-sub">
                {Number(row.volatility_percentile) >= 50
                  ? "高い（荒れやすい）"
                  : "低い（堅い）"}
              </span>
            </div>
          )}
        </div>

        {row.detail?.reason && (
          <p className="featured-race__reason">{row.detail.reason}</p>
        )}

        <Link
          to={localize(`/race/${row.race_id}`)}
          className="featured-race__cta"
        >
          このレースの詳細を見る
        </Link>
      </div>
    </section>
  );
}

export default FeaturedRaceCard;
