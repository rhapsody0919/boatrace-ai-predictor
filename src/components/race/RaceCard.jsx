/**
 * RaceCard - レース一覧のカードコンポーネント
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  raceNumberLabel,
  deadlineValueText,
} from "../../utils/raceListDisplay";
import { DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
import RaceCardDataTable from "./RaceCardDataTable";
import RaceDeadlineCountdown from "./RaceDeadlineCountdown";
import RaceCardBadges from "./RaceCardBadges";
import { deriveRaceCardState, aiTabHref } from "./RaceCardState";
import { trackEvent } from "../../utils/analytics";
import { cautionClickEvent } from "../../utils/cautionEvents";

const cardBorderStyle = (s) => {
  if (s.showBadge) {
    return {
      borderLeft: `4px solid ${s.isHighVolatility ? "#c62828" : "#2e7d32"}`,
    };
  }
  return s.inCautionLine
    ? { borderLeft: `4px solid ${s.inCautionLine}` }
    : undefined;
};

function RaceCardInfo({ race, deadlineStatus }) {
  const { t } = useTranslation();
  return (
    <div className="race-info">
      <div className="info-item">
        <span className="label">{t("home.deadline")}</span>
        <span className="value">{deadlineValueText(t, race.startTime)}</span>
      </div>
      {deadlineStatus && deadlineStatus !== DEADLINE_STATUS.CLOSED && (
        <div className="info-item">
          <RaceDeadlineCountdown raceId={race.id} startTime={race.startTime} />
        </div>
      )}
    </div>
  );
}

function RaceCard({ race, raceHref, nowHHMM = null, linkRacerNames = false }) {
  const { t } = useTranslation();
  const racePrediction = race.rawData;
  const s = deriveRaceCardState(race, nowHHMM);
  const { inCaution } = s;

  return (
    <div
      className={
        s.isPastDeadline ? "race-card race-card--deadline-passed" : "race-card"
      }
      style={cardBorderStyle(s)}
    >
      <div className="race-card-header">
        <h3>{race.venue}</h3>
        <RaceCardBadges s={s} racePrediction={racePrediction} />
        {/* R番号はバッジの外に置く。狭いカードでバッジを2段目に送っても、会場名と同じ段に残す */}
        <span className="race-number">{raceNumberLabel(race.raceNumber)}</span>
      </div>
      {race.startTime && (
        <RaceCardInfo race={race} deadlineStatus={s.deadlineStatus} />
      )}
      <RaceCardDataTable
        raceId={race.id}
        players={racePrediction?.players}
        linkRacerNames={linkRacerNames}
      />
      {/* 遷移先の URL を持つリンクにする。button の onClick だと検索エンジンがレース詳細へのリンクを辿れない（SEO 点検 F3） */}
      <Link
        className="predict-btn"
        to={inCaution ? aiTabHref(raceHref) : raceHref}
        onClick={
          inCaution
            ? () => {
                // 注意度の札のあるカードからレースへ（BOA-822 task 27、Q4 の帯別件数）
                const ev = cautionClickEvent({
                  surface: "race_list",
                  target: "race",
                  raceId: race.id,
                  inCaution,
                });
                if (ev) trackEvent(ev.name, ev.params);
              }
            : undefined
        }
      >
        {t("raceCard.view")}
      </Link>
    </div>
  );
}

export default RaceCard;
