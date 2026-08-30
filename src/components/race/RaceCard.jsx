/**
 * RaceCard - レース一覧のカードコンポーネント
 */

import { useTranslation } from "react-i18next";
import { GRADE_CONFIG } from "../../constants/gradeConfig";
import { getRaceStatus, RACE_STATUS } from "../../utils/raceStatus";

function RaceCard({ race, onAnalyzeRace, nowHHMM = null }) {
  const { t } = useTranslation();
  const racePrediction = race.rawData;
  const volatility = racePrediction?.volatility;
  const result = racePrediction?.result;
  const isFinished = result?.finished;
  const isAwaitingResult =
    getRaceStatus({ startTime: race.startTime, result }, nowHHMM) ===
    RACE_STATUS.AWAITING_RESULT;

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
      className="race-card"
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
          {isAwaitingResult && (
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
        </div>
      )}
      <button className="predict-btn" onClick={() => onAnalyzeRace(race)}>
        {t("raceCard.view")}
      </button>
    </div>
  );
}

export default RaceCard;
