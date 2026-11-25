// 会場ページのレースの塊（公式スマホの形、docs/design/venue-race-card-redesign/approved.md）。終わったレースも同じ形に結果1行。
// 試験・計測・ボット向け HTML の照合が頼る class（.race-card・.race-number・.race-info・.predict-btn）は RaceCard と同じ
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
import { raceStageLabel } from "../../pure/raceStageConfig";
import { translateTechnique } from "../../pure/raceIndicatorText";
import { formatCount } from "../../pure/dataFormat";
import RaceCardDataTable from "../race/RaceCardDataTable";
import { RaceNumber, RaceCardInfo } from "../race/RaceCard";
import RaceCardBadges from "../race/RaceCardBadges";
import { deriveRaceCardState, aiTabHref } from "../race/RaceCardState";
import { isInCautionEnabled } from "../../config/featureFlags";
import { trackEvent } from "../../utils/analytics";
import { cautionClickEvent } from "../../utils/cautionEvents";
import "./VenueRaceBlock.css";

// 結果の1行「結果 4-2-1 まくり 3連単 ¥8,450」。不成立・着順が無いときは出さない
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
      {amount != null && (
        <span>{`${t("betting.trifecta")} ¥${formatCount(amount)}`}</span>
      )}
    </p>
  );
}

export default function VenueRaceBlock({ race, raceHref, nowHHMM }) {
  const { t, i18n } = useTranslation();
  const rp = race.rawData;
  const s = deriveRaceCardState(race, nowHHMM);
  const stage = raceStageLabel(rp?.raceStage, t, i18n.resolvedLanguage);
  const finished = Boolean(s.result?.finished);
  const badgeState =
    s.deadlineStatus === DEADLINE_STATUS.ACCEPTING
      ? { ...s, deadlineStatus: null }
      : s;
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
        <RaceNumber raceNumber={race.raceNumber} />
        {stage && (
          <span translate={stage.isOfficial ? "no" : undefined}>
            {stage.text}
          </span>
        )}
        {race.startTime && (
          <RaceCardInfo race={race} deadlineStatus={s.deadlineStatus} />
        )}
        {/* 種別は帯の字・グレードは見出し・受付中は締切までの時刻で分かるので、その札の元を渡さない */}
        <RaceCardBadges s={badgeState} racePrediction={null} />
      </div>
      {/* 結果が無いレースも枠を置き、多列で隣の塊と出走表の高さをそろえる（subgrid の行） */}
      <div className="venue-race-block__result-slot">
        <ResultLine s={s} />
      </div>
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
        <Link to={aiTabHref(raceHref)}>
          {/* 会場の一覧では「イン崩れ」だけだと、確定したレースで「このレースはイン崩れだった」と読める
              （ファン評価 P2、オーナー 2026-11-25）。タブの名前は「イン崩れ」のまま */}
          {t(
            isInCautionEnabled()
              ? "volatility.attentionTitle"
              : "raceTabs.aiPrediction",
          )}
        </Link>
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
