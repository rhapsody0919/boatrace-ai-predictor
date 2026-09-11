/**
 * RaceCard - レース一覧のカードコンポーネント
 */

import { useTranslation } from "react-i18next";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import { getRaceStatus, RACE_STATUS } from "../../utils/raceStatus";
import { getDeadlineStatus, DEADLINE_STATUS } from "../../utils/raceDeadlineStatus";
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
  const isCancelled = racePrediction?.cancellationStatus === "confirmed";
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

  // 的中判定（unifiedモデル: 展開予測的中のみ。複勝予想は表示しない方針
  // に統一、ADR 0013・BOA-174/175/178参照）
  const unified = racePrediction?.unified;
  let hitBadges = [];

  if (isFinished && unified) {
    // 展開予測の的中判定は集計指標（実測的中率約80%）と同じロジック:
    // 上位パターンのwinnerCourseのいずれかが実際の1着と一致すれば的中
    const patterns = unified.turnPrediction?.patterns;
    const isTurnHit =
      Array.isArray(patterns) &&
      patterns.some((p) => p.winnerCourse === result.rank1);
    if (isTurnHit) {
      hitBadges.push({ label: t("raceCard.badgeTurn"), type: "turn" });
    }
  }

  return (
    <div
      className={
        isPastDeadline ? "race-card race-card--deadline-passed" : "race-card"
      }
      style={showBadge ? { borderLeft: `4px solid ${badgeColor}` } : undefined}
    >
      <div className="race-card-header">
        <h3>{race.venue}</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {showBadge && (
            <span
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "8px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background: badgeColor,
                color: "#fff",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {badgeLabel}
            </span>
          )}
          {isFinished && unified && (
            <span
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "8px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background:
                  hitBadges.length > 0
                    ? "var(--color-success)"
                    : "var(--color-error)",
                color: "#fff",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {hitBadges.length > 0
                ? hitBadges[0].label
                : t("raceCard.missBadge")}
            </span>
          )}
          {isCancelled ? (
            <span
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "8px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background: "var(--color-gray-600)",
                color: "#fff",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {t("raceCard.cancelled")}
            </span>
          ) : (
            isAwaitingResult && (
              <span
                style={{
                  padding: "0.2rem 0.55rem",
                  borderRadius: "8px",
                  fontSize: "0.7rem",
                  fontWeight: "700",
                  background: "var(--color-gray-600)",
                  color: "#fff",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {t("raceCard.awaitingResult")}
              </span>
            )
          )}
          {deadlineStatus === DEADLINE_STATUS.CLOSING_SOON && (
            <span
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "8px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background: "var(--color-warning)",
                color: "#fff",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {t("raceCard.closingSoon")}
            </span>
          )}
          {deadlineStatus === DEADLINE_STATUS.ACCEPTING && (
            <span
              style={{
                padding: "0.2rem 0.55rem",
                borderRadius: "8px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background: "var(--color-gray-600)",
                color: "#fff",
                letterSpacing: "0.02em",
                whiteSpace: "nowrap",
              }}
            >
              {t("raceCard.accepting")}
            </span>
          )}
          {gradeConfig && (
            <span
              style={{
                padding: "0.2rem 0.5rem",
                borderRadius: "6px",
                fontSize: "0.7rem",
                fontWeight: "700",
                background: gradeConfig.color,
                color: "#fff",
                letterSpacing: "0.05em",
                whiteSpace: "nowrap",
              }}
            >
              {gradeConfig.label}
            </span>
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
              <RaceDeadlineCountdown raceId={race.id} startTime={race.startTime} />
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
