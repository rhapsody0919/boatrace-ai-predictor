/**
 * DigestRaceCard - 1レース1行のカード（BOA-402、screens.md C-3）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 * **指標部分は props の分岐ではなく `children` で差し替える**（指標の種類が
 * 増えるたびに props が増えるのを避ける。screens.md §3 の共通化の判断根拠）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLocalizedPath } from "../../hooks/useLocalizedPath";
import "./DigestRaceCard.css";

function DigestRaceCard({ row, highlight = false, children }) {
  const { t } = useTranslation();
  const localize = useLocalizedPath();
  const venueName = t(`venues.${row.venue_code}`);

  return (
    <article
      className={`digest-card${highlight ? " digest-card--highlight" : ""}`}
    >
      <Link
        to={localize(`/race/${row.race_id}`)}
        className="digest-card__link"
        aria-label={`${venueName}${row.race_number}レースの詳細`}
      >
        <header className="digest-card__head">
          <span className="digest-card__race" translate="no">
            {venueName} {row.race_number}R
          </span>
          {row.start_time && (
            <span className="digest-card__deadline">
              締切 {String(row.start_time).slice(0, 5)}
            </span>
          )}
        </header>

        <div className="digest-card__racer">
          <span className="digest-card__racer-id" translate="no">
            {row.racer_id}
          </span>
          <span className="digest-card__racer-name" translate="no">
            {row.racer_name}
          </span>
          {row.grade && (
            <span className="digest-card__grade" translate="no">
              {row.grade}
            </span>
          )}
          {row.boat_number && (
            <span className="digest-card__boat">枠{row.boat_number}</span>
          )}
        </div>

        {children}

        <footer className="digest-card__foot">
          {row.motor_2rate !== null && (
            <span>モーター2連率 {Number(row.motor_2rate).toFixed(1)}%</span>
          )}
          {row.volatility_percentile !== null && (
            <span>
              イン崩れ指数 {Math.round(Number(row.volatility_percentile))}%
            </span>
          )}
        </footer>
      </Link>
    </article>
  );
}

export default DigestRaceCard;
