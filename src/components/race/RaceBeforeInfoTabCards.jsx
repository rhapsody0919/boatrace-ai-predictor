/**
 * RaceBeforeInfoTab の下半分のカード（今節の足・進入コース・ピットレポート・モーター導線）。
 * RaceBeforeInfoTab.jsx から移しただけ（出力は変えない）。
 */
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RacePitReportSection from "./RacePitReportSection";
import EntryCourseDistributionCard from "./EntryCourseDistributionCard";
import MeetFormTrendCard from "./MeetFormTrendCard";

export default function RaceBeforeInfoTabCards({
  focusedBoat,
  onFocusBoat,
  raceId,
  raceGrade,
  sortedPlayers,
  fetched,
  turnTimeDiffers,
  motorLink,
  onMotorLinkClick,
}) {
  const { t } = useTranslation();
  const { meetOriginal, meetBoard, scopedStatsByRacer } = fetched;
  return (
    <>
      <MeetFormTrendCard
        focusedBoat={focusedBoat}
        onFocusBoat={onFocusBoat}
        players={sortedPlayers}
        trendByRacer={fetched.meetTrendByRacer}
        originalByKey={
          meetOriginal?.state === "published" ? meetOriginal.byKey : null
        }
        runsByRacer={meetBoard?.meetRunsByRacer ?? null}
        scopedByRacer={scopedStatsByRacer}
        venueDailyAvg={meetBoard?.venueDailyExhibitionAvg ?? null}
        turnTimeDiffers={turnTimeDiffers}
        finishFailed={fetched.meetBoardFailed}
        onRetryFinish={fetched.retryBoard}
      />

      <EntryCourseDistributionCard
        raceId={raceId}
        players={sortedPlayers}
        statsByRacer={scopedStatsByRacer}
        failed={fetched.scopedStatsFailed}
        onRetry={fetched.retryScopedStats}
      />

      <RacePitReportSection
        raceId={raceId}
        raceGrade={raceGrade}
        players={sortedPlayers}
      />

      <Link
        to={motorLink}
        className="rbi-motor-link"
        onClick={onMotorLinkClick}
      >
        🔧 {t("beforeInfo.motorHistoryLink")} →
      </Link>
    </>
  );
}
