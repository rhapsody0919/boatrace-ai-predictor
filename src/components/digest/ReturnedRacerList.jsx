/**
 * ReturnedRacerList - 昨日の帰郷選手（BOA-402、screens.md C-9 / spec FR-14）
 *
 * 「前日の出走表にいたが、同一会場の開催が続いているのに当日の出走表から消えた選手」。
 * race_special_notes に理由の行があれば併記するが、**無くても行は出す**
 * （理由の有無で出し分けない）。
 */
import { useTranslation } from "react-i18next";
import "./RacerPlainList.css";

function ReturnedRacerList({ rows, suppressedVenues = [] }) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="racer-plain-list">
        {rows.map((row) => (
          <li
            key={`${row.venue_code}-${row.racer_id}`}
            className="racer-plain-list__item racer-plain-list__item--stacked"
          >
            <span className="racer-plain-list__name">
              <span className="racer-plain-list__id" translate="no">
                {row.racer_id}
              </span>
              <span translate="no">{row.racer_name}</span>
            </span>
            <span className="racer-plain-list__meta">
              <span translate="no">{t(`venues.${row.venue_code}`)}</span>
            </span>
            {row.detail?.reason && (
              <span className="racer-plain-list__reason">
                {row.detail.reason}
              </span>
            )}
          </li>
        ))}
      </ul>
      {suppressedVenues.length > 0 && (
        <p className="racer-plain-list__warning">
          ⚠️ 次の会場は節の切り替わりと判定したため、帰郷の集計から除外しました:{" "}
          <span translate="no">
            {suppressedVenues.map((v) => t(`venues.${v}`)).join("、")}
          </span>
        </p>
      )}
    </>
  );
}

export default ReturnedRacerList;
