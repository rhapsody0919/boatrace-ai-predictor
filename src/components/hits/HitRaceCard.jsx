/**
 * HitRaceCard - 展開予測的中レースカードコンポーネント（BOA-174、unified一本化）
 */
import { SocialShareButtons } from "../SocialShareButtons";
import { generateTurnHitShareText, shareUrlFor } from "../../utils/share";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";

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
  // 予想確率は「その艇がその決まり手で1着になる確率」なので、決まり手も添える。無いと艇の1着確率に
  // 読めた（同じ艇の別の決まり手の確率は含まない。PR #1197 ファン評価2周目）
  const technique = TECHNIQUE_NAMES[hitRace.matchedPattern?.technique] ?? null;

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
          {/* 上位候補のどれかが1着になれば的中で、ここに出るのはその当たった候補（本命とは限らない）。
              「1マーク先頭」は展開予測の説明（1着）と食い違い、「1着予想」は本命に推したように読めた
              （BOA-710、PR #1197 ファン評価1周目） */}
          <span className="turn-hit-course-label">的中した候補</span>
          <span className="turn-hit-course-value">
            {hitRace.winnerCourse}コース
          </span>
        </div>
        {probability != null && (
          <div className="turn-hit-probability">
            {/* 決まり手は AI の予想として書く（実際の決まり手と違うことがある。的中の判定は1着の艇だけ。
                PR #1197 ファン評価3周目） */}
            予想: {technique ? `${technique} ` : ""}
            {(probability * 100).toFixed(0)}%
          </div>
        )}
      </div>

      {/* SNSシェアボタン */}
      <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <SocialShareButtons
          // 的中したレースの詳細を共有する（以前はトップ固定、BOA-691）
          shareUrl={shareUrlFor(`/race/${hitRace.raceId}`)}
          title={generateTurnHitShareText({
            venue: hitRace.venue,
            raceNo: hitRace.raceNumber,
            date: hitRace.date,
            winnerCourse: hitRace.winnerCourse,
            technique,
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
