/**
 * RaceCard - レース一覧のカードコンポーネント
 */

import { useTranslation } from "react-i18next";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import { getRaceStageBadge } from "../../constants/raceStageConfig";
import { getRaceStatus, RACE_STATUS } from "../../utils/raceStatus";
import { isRaceCancelled } from "../../utils/raceCancellation";
import {
  RACE_OUTCOME,
  TURN_JUDGEMENT,
  getRaceOutcomeState,
  judgeTurnPrediction,
} from "../../utils/raceOutcome";
import {
  getDeadlineStatus,
  DEADLINE_STATUS,
} from "../../utils/raceDeadlineStatus";
import RaceCardBadge from "./RaceCardBadge";
import RaceCardDataTable from "./RaceCardDataTable";
import RaceDeadlineCountdown from "./RaceDeadlineCountdown";

function RaceCard({ race, onAnalyzeRace, nowHHMM = null }) {
  const { t } = useTranslation();
  const racePrediction = race.rawData;
  const volatility = racePrediction?.volatility;
  const result = racePrediction?.result;
  const isFinished = result?.finished;
  const status = getRaceStatus({ startTime: race.startTime, result }, nowHHMM);
  const isAwaitingResult = status === RACE_STATUS.AWAITING_RESULT;
  // 中止・順延の確定検知（BOA-254）。暫定検知（"tentative"）はまだ誤検出の
  // 可能性があるため、既存の受付中/結果反映待ち表示のまま変更しない
  const isCancelled = isRaceCancelled(racePrediction);
  // 締切ステータスのライブ表示（BOA-243）。中止確定レースは既存の中止表示を
  // 優先し、この新バッジ・カウントダウンは出さない（FR3）
  const deadlineStatus = isCancelled
    ? null
    : getDeadlineStatus(race.id, race.startTime, new Date());
  // 締切前(UPCOMING)以外は見た目でも一目で分かるよう、トップバー・見出し・
  // ボタンをグレーアウトする（バッジの発色は維持し、的中/外れ・結果反映待ちの
  // 視認性を落とさない）
  const isPastDeadline = status !== RACE_STATUS.UPCOMING;

  // フォールバック値（percentile=0.5）は「実測ではない」ため、high/lowの
  // 断定バッジを出さない（VolatilityDisplay.jsxの「データ収集中」表示と同じ方針）
  const isHighVolatility =
    !volatility?.isFallback && volatility?.level === "high";
  const isLowVolatility =
    !volatility?.isFallback && volatility?.level === "low";
  const showBadge = isHighVolatility || isLowVolatility;
  const badgeColor = isHighVolatility ? "#c62828" : "#2e7d32";
  const badgeLabel = isHighVolatility
    ? `🌪️ ${t("volatility.levelHigh")}`
    : `🎯 ${t("volatility.levelLow")}`;

  const gradeConfig = GRADE_CONFIG[racePrediction?.raceGrade];
  const stageConfig = getRaceStageBadge(racePrediction?.raceStage);

  // 的中判定（unifiedモデル: 展開予測的中のみ。複勝予想は表示しない方針
  // に統一、ADR 0013・BOA-174/175/178参照）
  // 展開予測の的中判定は集計指標（実測的中率約80%）と同じロジック（上位パターンの winnerCourse の
  // いずれかが1着と一致すれば的中）。判定は TurnPatternList・HitRaces と同じ関数を通す（BOA-543）。
  // 不成立は的中・外れを出さず「不成立」だけ、一部返還は的中・外れの横に枠線の「返還あり」
  const unified = racePrediction?.unified;
  const outcome = isFinished ? getRaceOutcomeState(result) : null;
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  const isPartialRefund = outcome === RACE_OUTCOME.PARTIAL_REFUND;
  const turnJudgement =
    isFinished && unified && !isNoRace
      ? judgeTurnPrediction(unified.turnPrediction?.patterns, result).status
      : null;
  // 予想パターンが無いレースは従来どおり「外れ」（isTurnHit=false と同じ扱い）
  const showHitMissBadge = isFinished && Boolean(unified) && !isNoRace;
  const isTurnHit = turnJudgement === TURN_JUDGEMENT.HIT;

  return (
    <div
      className={
        isPastDeadline ? "race-card race-card--deadline-passed" : "race-card"
      }
      style={showBadge ? { borderLeft: `4px solid ${badgeColor}` } : undefined}
    >
      <div className="race-card-header">
        <h3>{race.venue}</h3>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
          }}
        >
          {showBadge && (
            <RaceCardBadge color={badgeColor}>{badgeLabel}</RaceCardBadge>
          )}
          {showHitMissBadge && (
            <RaceCardBadge
              color={isTurnHit ? "var(--color-success)" : "var(--color-error)"}
            >
              {isTurnHit ? t("raceCard.badgeTurn") : t("raceCard.missBadge")}
            </RaceCardBadge>
          )}
          {isNoRace && (
            <RaceCardBadge color="var(--color-gray-600)">
              {t("raceCard.noRace")}
            </RaceCardBadge>
          )}
          {isPartialRefund && (
            <RaceCardBadge color="var(--text-secondary)" variant="outline">
              {t("raceCard.refundBadge")}
            </RaceCardBadge>
          )}
          {isCancelled ? (
            <RaceCardBadge color="var(--color-gray-600)">
              {t("raceCard.cancelled")}
            </RaceCardBadge>
          ) : (
            isAwaitingResult && (
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
          <span className="race-number">{race.raceNumber}R</span>
        </div>
      </div>
      {race.startTime && (
        <div className="race-info">
          <div className="info-item">
            <span className="label">{t("home.deadline")}</span>
            <span className="value">
              {race.startTime}
              {t("home.jstNote")}
            </span>
          </div>
          {deadlineStatus && deadlineStatus !== DEADLINE_STATUS.CLOSED && (
            <div className="info-item">
              <RaceDeadlineCountdown
                raceId={race.id}
                startTime={race.startTime}
              />
            </div>
          )}
        </div>
      )}
      <RaceCardDataTable raceId={race.id} players={racePrediction?.players} />
      <button className="predict-btn" onClick={() => onAnalyzeRace(race)}>
        {t("raceCard.view")}
      </button>
    </div>
  );
}

export default RaceCard;
