/**
 * HitRaceCard - 展開予測的中レースカードコンポーネント（BOA-174、unified一本化）
 */
import { SocialShareButtons } from "../SocialShareButtons";
import { generateTurnHitShareText } from "../../utils/share";

function HitRaceCard({
  hitRace,
  variant = "today",
  showDate = false,
  onClick,
}) {
  const cardClassName = `race-card ${variant}${onClick ? " clickable" : ""}`;

  const handleClick = () => {
    if (onClick) onClick(hitRace);
  };

  const handleMouseEnter = (e) => {
    if (onClick) e.currentTarget.style.transform = "translateY(-2px)";
  };

  const handleMouseLeave = (e) => {
    if (onClick) e.currentTarget.style.transform = "translateY(0)";
  };

  const probability = hitRace.matchedPattern?.probability;

  return (
    <div
      className={cardClassName}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="race-card-header">
        <div>
          <div className="race-card-venue">{hitRace.venue}</div>
          <div className="race-card-number">{hitRace.raceNumber}R</div>
        </div>
        <div className={`hit-badge ${variant}`}>🌊 展開予測的中</div>
      </div>

      {showDate && (
        <div
          className="race-card-date"
          style={{
            fontSize: "0.85rem",
            color: "#64748b",
            marginBottom: "0.5rem",
          }}
        >
          {hitRace.date}
        </div>
      )}

      <div className="turn-hit-detail">
        <div className="turn-hit-course">
          <span className="turn-hit-course-label">1マーク先頭</span>
          <span className="turn-hit-course-value">
            {hitRace.winnerCourse}コース
          </span>
        </div>
        {probability != null && (
          <div className="turn-hit-probability">
            予想確率 {(probability * 100).toFixed(0)}%
          </div>
        )}
      </div>

      {/* SNSシェアボタン */}
      <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <SocialShareButtons
          shareUrl="https://www.boat-ai.jp/"
          title={generateTurnHitShareText({
            venue: hitRace.venue,
            raceNo: hitRace.raceNumber,
            date: hitRace.date,
            winnerCourse: hitRace.winnerCourse,
            probability,
          })}
          hashtags={["ボートレース", "展開予測", "龍神レーダー"]}
          size={36}
        />
      </div>
    </div>
  );
}

export default HitRaceCard;
