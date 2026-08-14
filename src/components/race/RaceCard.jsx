/**
 * RaceCard - レース一覧のカードコンポーネント
 */

import { useTranslation } from "react-i18next";
import { GRADE_CONFIG } from "../../constants/gradeConfig";

function RaceCard({ race, onAnalyzeRace }) {
  const { t } = useTranslation();
  const racePrediction = race.rawData;
  const volatility = racePrediction?.volatility;
  const result = racePrediction?.result;
  const isFinished = result?.finished;

  const isHighVolatility = volatility?.level === "high";
  const isLowVolatility = volatility?.level === "low";
  const showBadge = isHighVolatility || isLowVolatility;
  const badgeColor = isHighVolatility ? "#c62828" : "#2e7d32";
  const badgeLabel = isHighVolatility
    ? `🌪️ ${t("volatility.levelHigh")}`
    : `🎯 ${t("volatility.levelLow")}`;

  const gradeConfig = GRADE_CONFIG[racePrediction?.raceGrade];

  // 的中判定（unifiedモデル: 複勝的中・展開予測的中の2種類のみ。
  // unifiedモデルは複勝予想[topPick/top2nd]と展開予測[turnPrediction]しか
  // 生成しないため、旧3モデル由来の単勝的中/3連複的中/3連単的中は廃止した）
  const unified = racePrediction?.unified;
  let hitBadges = [];

  if (isFinished && unified) {
    const topPick = unified.topPick;
    const isPlaceHit =
      topPick != null && (topPick === result.rank1 || topPick === result.rank2);
    if (isPlaceHit) {
      hitBadges.push({ label: t("raceCard.badgePlace"), type: "place" });
    }

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
      {isFinished && unified && (
        <div
          style={{
            marginTop: "0.5rem",
            display: "flex",
            gap: "0.3rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {hitBadges.length > 0 ? (
            hitBadges.map((badge, idx) => (
              <span
                key={idx}
                style={{
                  padding: "0.3rem 0.6rem",
                  background: "#10b981",
                  color: "white",
                  borderRadius: "6px",
                  fontSize: "0.75rem",
                  fontWeight: "700",
                }}
              >
                {badge.label}
              </span>
            ))
          ) : (
            <span
              style={{
                padding: "0.3rem 0.6rem",
                background: "#ef4444",
                color: "white",
                borderRadius: "6px",
                fontSize: "0.75rem",
                fontWeight: "700",
              }}
            >
              {t("raceCard.missBadge")}
            </span>
          )}
        </div>
      )}
      <button className="predict-btn" onClick={() => onAnalyzeRace(race)}>
        {t("raceCard.view")}
      </button>
    </div>
  );
}

export default RaceCard;
