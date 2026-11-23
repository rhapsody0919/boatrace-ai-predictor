/**
 * 会場ページのレースの塊（公式スマホの形、docs/design/venue-race-card-redesign/approved.md）。会場名・グレードの札・締切の2段を消し、
 * 終わったレースも同じ形に結果1行。試験と計測が頼る .race-card・.race-card-header・.predict-btn は RaceCard と同じに残す
 */
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { deadlineValueText } from "../../utils/raceListDisplay";
import { DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
import { raceStageLabel } from "../../pure/raceStageConfig";
import { translateTechnique } from "../../pure/raceIndicatorText";
import { formatCount } from "../../pure/dataFormat";
import RaceCardDataTable from "../race/RaceCardDataTable";
import RaceDeadlineCountdown from "../race/RaceDeadlineCountdown";
import RaceCardBadges from "../race/RaceCardBadges";
import { deriveRaceCardState, aiTabHref } from "../race/RaceCardState";
import { trackEvent } from "../../utils/analytics";
import { cautionClickEvent } from "../../utils/cautionEvents";
import "./VenueRaceBlock.css";

// 結果の1行「結果 4-2-1 まくり ¥8,450」。不成立・着順が無いときは出さない
function ResultLine({ s }) {
  const { t } = useTranslation();
  const r = s.result;
  if (!r?.finished || s.isNoRace || r.rank1 == null) return null;
  const amount = r.payouts?.sanrentan?.amount;
  return (
    <p className="venue-race-block__result" data-testid="venue-race-result">
      <span>{t("raceTabs.result")}</span>
      <b>{[r.rank1, r.rank2, r.rank3].filter((n) => n != null).join("-")}</b>
      {r.winningTechnique && (
        <span>{translateTechnique(t, r.winningTechnique)}</span>
      )}
      {amount != null && <span>¥{formatCount(amount)}</span>}
    </p>
  );
}

export default function VenueRaceBlock({ race, raceHref, nowHHMM }) {
  const { t, i18n } = useTranslation();
  const rp = race.rawData;
  const s = deriveRaceCardState(race, nowHHMM);
  const stage = raceStageLabel(rp?.raceStage, t, i18n.resolvedLanguage);
  const finished = Boolean(s.result?.finished);
  const onDetail = s.inCaution
    ? () => {
        const ev = cautionClickEvent({
          surface: "race_list",
          target: "race",
          raceId: race.id,
          inCaution: s.inCaution,
        });
        if (ev) trackEvent(ev.name, ev.params);
      }
    : undefined;

  return (
    <article
      className={`race-card venue-race-block${s.isPastDeadline ? " race-card--deadline-passed" : ""}`}
    >
      <div className="race-card-header venue-race-block__bar">
        <span className="venue-race-block__rn">{race.raceNumber}R</span>
        {stage && (
          <span translate={stage.isOfficial ? "no" : undefined}>
            {stage.text}
          </span>
        )}
        {race.startTime && (
          <span className="venue-race-block__time">
            {t("home.deadline")} {deadlineValueText(t, race.startTime)}
            {s.deadlineStatus &&
              s.deadlineStatus !== DEADLINE_STATUS.CLOSED && (
                <RaceDeadlineCountdown
                  raceId={race.id}
                  startTime={race.startTime}
                />
              )}
          </span>
        )}
        <RaceCardBadges s={s} racePrediction={rp} showStageGrade={false} />
      </div>
      <ResultLine s={s} />
      <RaceCardDataTable
        raceId={race.id}
        players={rp?.players}
        linkRacerNames
      />
      <nav className="venue-race-block__links">
        <Link
          className="predict-btn"
          to={s.inCaution ? aiTabHref(raceHref) : raceHref}
          onClick={onDetail}
        >
          {t("raceCard.view")}
        </Link>
        <Link to={aiTabHref(raceHref)}>{t("raceTabs.aiPrediction")}</Link>
        <Link to={`${raceHref}?tab=${finished ? "result" : "beforeInfo"}`}>
          {t(finished ? "raceTabs.result" : "raceTabs.beforeInfo")}
        </Link>
      </nav>
      <button
        type="button"
        className="venue-race-block__back"
        onClick={() => window.scrollTo({ top: 0 })}
      >
        ↑ {t("venueRaceList.title")}
      </button>
    </article>
  );
}
