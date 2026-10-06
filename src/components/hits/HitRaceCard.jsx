/**
 * HitRaceCard - 展開予測的中レースカードコンポーネント（BOA-174、unified一本化）
 */
import { useTranslation } from "react-i18next";
import { SocialShareButtons } from "../SocialShareButtons";
import { generateTurnHitShareText, shareUrlFor } from "../../utils/share";
import {
  TECHNIQUE_NAMES,
  isAsPredicted,
  techniqueDiffers,
} from "../../utils/turnPrediction";

function HitRaceCard({
  hitRace,
  // 1着の艇が実際に入ったコース（無ければ null）。艇番と違うときだけ添える（BOA-708）
  winnerEntryCourse = null,
  variant = "today",
  showDate = false,
  onClick,
}) {
  // 共有文は locale の文面（panel.shareTurnHit）。/hit-races は ja 専用なので ja になる（BOA-754）
  const { t } = useTranslation();
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
  // 的中の判定は1着の艇だけで、決まり手は見ない。予想した決まり手が実際と違うときは、
  // 実際の決まり手を添える（BOA-724。「予想: 逃げ」だけだと、逃げが当たったように読めた）
  const actualTechnique = hitRace.result?.winningTechnique ?? null;
  const actualDiffers = techniqueDiffers(technique, actualTechnique);
  // 見出しも共有文と同じ区別にする。本命が予想の決まり手・艇番どおりのコースで勝ったときだけ
  // 「展開予測的中」、それ以外（2番手以下・決まり手外れ・前付け）は「1着の艇が的中」（BOA-724、ユーザー判断）
  const asPredicted = isAsPredicted({
    predictedTechnique: technique,
    actualTechnique,
    winnerBoat: hitRace.winnerBoat,
    winnerEntryCourse,
    isTopPick: hitRace.isTopPick ?? true,
  });

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
        <div className={`hit-badge ${variant}`}>
          {asPredicted ? "🌊 展開予測的中" : "🌊 1着の艇が的中"}
        </div>
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
        {/* 以前は「1マーク先頭 Nコース」だったが、値は1着の艇番（BOA-708）。
            前付けのあったレースでは艇番とコースが違い、誤表示になっていた */}
        <div className="turn-hit-course">
          {/* 上位候補のどれかが1着になれば的中で、ここに出るのはその当たった候補（本命とは限らない）。
              「1マーク先頭」は展開予測の説明（1着）と食い違い、「1着予想」は本命に推したように読めた
              （BOA-710、PR #1197 ファン評価1周目） */}
          <span className="turn-hit-course-label">
            的中した候補
            {/* 括弧の中で折り返さない（「本 / 命」と割れた。ファン評価3周目） */}
            {hitRace.pickRank > 0 && (
              <span className="turn-hit-nowrap">
                （
                {hitRace.pickRank === 1
                  ? "本命"
                  : `予想${hitRace.pickRank}番手`}
                ）
              </span>
            )}
          </span>
          <span className="turn-hit-course-value">
            {hitRace.winnerBoat}号艇
            {winnerEntryCourse != null &&
              winnerEntryCourse !== hitRace.winnerBoat && (
                <span className="turn-hit-nowrap">
                  （{winnerEntryCourse}コース進入）
                </span>
              )}
          </span>
        </div>
        {probability != null && (
          <div className="turn-hit-probability">
            {/* 決まり手は AI の予想として書く（実際の決まり手と違うことがある。的中の判定は1着の艇だけ。
                PR #1197 ファン評価3周目） */}
            予想: {technique ? `${technique} ` : ""}
            {(probability * 100).toFixed(0)}%
            {actualDiffers && (
              <span className="turn-hit-actual">
                （実際: {actualTechnique}）
              </span>
            )}
          </div>
        )}
      </div>

      {/* SNSシェアボタン */}
      <div style={{ textAlign: "center" }} onClick={(e) => e.stopPropagation()}>
        <SocialShareButtons
          // 的中したレースの詳細を共有する（以前はトップ固定、BOA-691）
          shareUrl={shareUrlFor(`/race/${hitRace.raceId}`)}
          title={generateTurnHitShareText(
            {
              venue: hitRace.venue,
              raceNo: hitRace.raceNumber,
              date: hitRace.date,
              winnerBoat: hitRace.winnerBoat,
              winnerEntryCourse,
              technique,
              actualTechnique,
              isTopPick: hitRace.isTopPick,
              probability,
            },
            t,
          )}
          hashtags={["ボートレース", "展開予測", "龍神レーダー"]}
          size={36}
        />
      </div>
    </div>
  );
}

export default HitRaceCard;
