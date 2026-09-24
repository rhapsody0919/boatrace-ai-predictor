/**
 * FlyingRacerList - 昨日のフライング選手（BOA-402、screens.md C-8 / spec FR-5）
 *
 * 出遅れ（L）は対象外。race_start_timings.finish_mark に `L` が存在せず
 * （実測16種に無い）、is_late_start も全件falseの既知バグのため（spec §1.1）。
 */
import { useTranslation } from "react-i18next";
import "./RacerPlainList.css";

function FlyingRacerList({ rows, dataComplete = true }) {
  const { t } = useTranslation();
  return (
    <>
      {!dataComplete && (
        <p className="racer-plain-list__warning">
          ⚠️ この日のフライング情報は不完全です（全レースで記録が揃うのは
          2026年9月21日以降のため）
        </p>
      )}
      <ul className="racer-plain-list">
        {rows.map((row) => (
          <li
            key={`${row.race_id}-${row.boat_number}`}
            className="racer-plain-list__item"
          >
            <span className="racer-plain-list__name">
              <span className="racer-plain-list__id" translate="no">
                {row.racer_id}
              </span>
              <span translate="no">{row.racer_name}</span>
            </span>
            <span className="racer-plain-list__meta">
              <span translate="no">
                {t(`venues.${row.venue_code}`)} {row.race_number}R 枠
                {row.boat_number}
              </span>
              <strong className="racer-plain-list__accent">
                {row.detail?.label ?? "F"}
              </strong>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

export default FlyingRacerList;
