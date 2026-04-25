/**
 * RaceCard - レース一覧のカードコンポーネント
 */

function RaceCard({ race, selectedModel, onAnalyzeRace }) {
  const racePrediction = race.rawData;
  const volatility = racePrediction?.volatility;
  const result = racePrediction?.result;
  const isFinished = result?.finished;

  const isHighVolatility = volatility?.level === "high";
  const isLowVolatility = volatility?.level === "low";
  const showBadge = isHighVolatility || isLowVolatility;
  const badgeColor = isHighVolatility ? "#c62828" : "#2e7d32";
  const badgeLabel = isHighVolatility ? "💰 高配当期待" : "🎯 本命有利";

  // 的中判定（買い方別）
  let hitBadges = [];
  const hasNewFormat = !!racePrediction?.predictions;
  const hasOldFormat = !!racePrediction?.prediction;

  // モデルキーを変換
  const modelKey =
    selectedModel === "safe-bet"
      ? "safeBet"
      : selectedModel === "upset-focus"
        ? "upsetFocus"
        : "standard";

  // 予測データを取得
  let prediction;
  if (hasNewFormat) {
    prediction = racePrediction.predictions[modelKey];
  } else if (modelKey === "standard" && hasOldFormat) {
    prediction = racePrediction.prediction;
  }

  if (isFinished && prediction) {
    const topPick = prediction.topPick;
    const top3 = prediction.top3;

    const isWinHit = topPick === result.rank1;
    const isPlaceHit = topPick === result.rank1 || topPick === result.rank2;
    const is3FukuHit =
      top3.includes(result.rank1) &&
      top3.includes(result.rank2) &&
      top3.includes(result.rank3);
    const is3TanHit =
      top3[0] === result.rank1 &&
      top3[1] === result.rank2 &&
      top3[2] === result.rank3;

    if (isWinHit) hitBadges.push({ label: "単", type: "win" });
    if (isPlaceHit) hitBadges.push({ label: "複", type: "place" });
    if (is3FukuHit) hitBadges.push({ label: "3複", type: "trifecta" });
    if (is3TanHit) hitBadges.push({ label: "3単", type: "trio" });
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
          <span className="race-number">{race.raceNumber}R</span>
        </div>
      </div>
      {isFinished && (
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
                ✅ {badge.label}
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
              ❌ 外れ
            </span>
          )}
        </div>
      )}
      <button className="predict-btn" onClick={() => onAnalyzeRace(race)}>
        予想を見る
      </button>
    </div>
  );
}

export default RaceCard;
