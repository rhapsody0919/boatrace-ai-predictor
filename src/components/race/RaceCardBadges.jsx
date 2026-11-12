/**
 * RaceCard のバッジ列（RaceCard.jsx から移した。出力は変えない）
 */

import { useTranslation } from "react-i18next";
import { gradeConfigOf } from "../../utils/raceListDisplay";
import { getRaceStageBadge } from "../../constants/raceStageConfig";
import { getRefundBoats } from "../../utils/raceOutcome";
import { DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
import RaceCardBadge from "./RaceCardBadge";
import InCautionBadge from "./InCautionBadge";

function VolatilityBadge({ s }) {
  const { t } = useTranslation();
  if (!s.showBadge) return null;
  const badgeColor = s.isHighVolatility ? "#c62828" : "#2e7d32";
  const badgeLabel = s.isHighVolatility
    ? `🌪️ ${t("volatility.levelHigh")}`
    : `🎯 ${t("volatility.levelLow")}`;
  return <RaceCardBadge color={badgeColor}>{badgeLabel}</RaceCardBadge>;
}

function HitMissBadge({ s }) {
  const { t } = useTranslation();
  if (!s.showHitMissBadge) return null;
  return (
    <RaceCardBadge
      color={s.isTurnHit ? "var(--color-success)" : "var(--color-error)"}
    >
      {s.isTurnHit ? t("raceCard.badgeTurn") : t("raceCard.missBadge")}
    </RaceCardBadge>
  );
}

function OutcomeBadges({ s }) {
  const { t } = useTranslation();
  return (
    <>
      <HitMissBadge s={s} />
      {s.isNoRace && (
        <RaceCardBadge color="var(--color-gray-600)">
          {t("raceCard.noRace")}
        </RaceCardBadge>
      )}
      {s.isPartialRefund && (
        <RaceCardBadge color="var(--text-secondary)" variant="outline">
          {/* 結果タブと同じく公式の備考の表記（【返還艇あり】）にそろえる。返還艇が無く
              一部の勝式だけ不成立のときは、その旨を書く（BOA-558 の4） */}
          {getRefundBoats(s.result).length > 0
            ? t("result.refundTag")
            : t("result.partialNoRaceTag")}
        </RaceCardBadge>
      )}
    </>
  );
}

function StatusBadges({ s }) {
  const { t } = useTranslation();
  const { deadlineStatus } = s;
  return (
    <>
      {s.isCancelled ? (
        <RaceCardBadge color="var(--color-gray-600)">
          {t("raceCard.cancelled")}
        </RaceCardBadge>
      ) : (
        s.isAwaitingResult && (
          <RaceCardBadge color="var(--color-gray-600)">
            {t("raceCard.awaitingResult")}
          </RaceCardBadge>
        )
      )}
      {deadlineStatus === DEADLINE_STATUS.CLOSING_SOON && (
        <RaceCardBadge color="var(--color-warning)">
          {t("raceCard.closingSoon")}
        </RaceCardBadge>
      )}
      {deadlineStatus === DEADLINE_STATUS.ACCEPTING && (
        <RaceCardBadge color="var(--color-gray-600)">
          {t("raceCard.accepting")}
        </RaceCardBadge>
      )}
    </>
  );
}

function StageGradeBadges({ raceStage, raceGrade }) {
  const { t } = useTranslation();
  const gradeConfig = gradeConfigOf(raceGrade);
  const stageConfig = getRaceStageBadge(raceStage);
  return (
    <>
      {stageConfig && (
        <RaceCardBadge
          color={stageConfig.color}
          padding="0.2rem 0.5rem"
          borderRadius="6px"
          letterSpacing="0.05em"
        >
          {stageConfig.emoji} {t(stageConfig.i18nKey)}
        </RaceCardBadge>
      )}
      {gradeConfig && (
        <RaceCardBadge
          color={gradeConfig.color}
          padding="0.2rem 0.5rem"
          borderRadius="6px"
          letterSpacing="0.05em"
        >
          {gradeConfig.label}
        </RaceCardBadge>
      )}
    </>
  );
}

export default function RaceCardBadges({ s, racePrediction }) {
  return (
    <div
      className="race-card-badges"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        flexWrap: "wrap",
      }}
    >
      <VolatilityBadge s={s} />
      {s.inCaution && (
        <InCautionBadge level={s.inCaution.level} pct={s.inCaution.pct} />
      )}
      <OutcomeBadges s={s} />
      <StatusBadges s={s} />
      <StageGradeBadges
        raceStage={racePrediction?.raceStage}
        raceGrade={racePrediction?.raceGrade}
      />
    </div>
  );
}
