/**
 * VenueGridCard - 開催場一覧グリッドの1会場分カード
 * 開催中: 大会名・グレードバッジ・時間帯アイコン・次レース時刻を表示しリンク化
 * 非開催: 「本日開催なし」表示のみ（リンクなし）
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import { getVenueTimeOfDay, TIME_OF_DAY } from "../../utils/raceTimeOfDay";
import "./VenueGridCard.css";

const TIME_OF_DAY_ICON = {
  [TIME_OF_DAY.MORNING]: "⏰",
  [TIME_OF_DAY.SUMMER]: "☀️",
  [TIME_OF_DAY.NIGHTER]: "🌙",
  [TIME_OF_DAY.MIDNIGHT]: "⭐",
};

// 現在時刻（JST基準のHH:MM文字列）より後の最初のレースを返す。
// startTimeが欠損しているレース（データ取り込み遅延等）は「まだ判定できない」ため、
// 安全側に倒して常に候補に含める（除外すると本当は残っているのに「終了」と誤表示されるため）
function findNextRace(races, nowHHMM) {
  return races.find((r) => !r.startTime || r.startTime > nowHHMM) || null;
}

function VenueGridCard({ venueCode, venueData, linkTo, nowHHMM }) {
  const { t } = useTranslation();
  const venueName = t(`venues.${venueCode}`);

  const races = venueData?.races || [];
  const isOpen = races.length > 0;

  if (!isOpen) {
    return (
      <div className="venue-grid-card venue-grid-card--closed">
        <div className="venue-grid-card__name">{venueName}</div>
        <div className="venue-grid-card__closed-label">
          {t("venueGrid.noRacesToday")}
        </div>
      </div>
    );
  }

  const timeOfDay = getVenueTimeOfDay(races);
  const timeIcon = TIME_OF_DAY_ICON[timeOfDay];
  const timeLabel =
    timeOfDay && timeOfDay !== TIME_OF_DAY.DAY
      ? t(`venueGrid.timeOfDay.${timeOfDay}`)
      : null;

  // グレードはレース単位だが会場単位の代表値として先頭レースの値を使う
  // （SG/G1等の節では全レース同一グレード）
  const gradeConfig = GRADE_CONFIG[races[0]?.raceGrade];
  const raceTitle = races[0]?.raceTitle || null;

  const nextRace = nowHHMM ? findNextRace(races, nowHHMM) : null;

  return (
    <Link to={linkTo} className="venue-grid-card venue-grid-card--open">
      <div className="venue-grid-card__header">
        <span className="venue-grid-card__name">{venueName}</span>
        {timeIcon && (
          <span
            className="venue-grid-card__time-icon"
            title={timeLabel ?? undefined}
            aria-label={timeLabel ?? undefined}
          >
            {timeIcon}
          </span>
        )}
      </div>

      <div className="venue-grid-card__badges">
        {gradeConfig && (
          <span
            className="venue-grid-card__grade"
            style={{ background: gradeConfig.color }}
          >
            {gradeConfig.label}
          </span>
        )}
      </div>

      {raceTitle && (
        <div
          className="venue-grid-card__title"
          title={raceTitle}
          translate="no"
        >
          {raceTitle}
        </div>
      )}

      <div className="venue-grid-card__status">
        {nextRace ? (
          <>
            <span className="venue-grid-card__next-race">
              {t("venueGrid.nextRace", { race: nextRace.raceNo })}
            </span>
            {nextRace.startTime && (
              <span className="venue-grid-card__next-time">
                {nextRace.startTime}
              </span>
            )}
          </>
        ) : (
          <span className="venue-grid-card__finished">
            {t("venueGrid.allFinished")}
          </span>
        )}
      </div>
    </Link>
  );
}

export default VenueGridCard;
