/**
 * PredictionFlash - 注目データカード
 *
 * 推奨買い目と各艇の選出理由を静的カードとして表示する。
 * 上段: 買い目（コース + 選手名）
 * 下段: 各艇の最も突出した指標 + 展開ストーリー
 */
import { useMemo } from "react";
import { BOAT_COLORS } from "../../utils/colors";
import { TECHNIQUE_NAMES } from "../../utils/turnPrediction";
import "./PredictionFlash.css";

/**
 * secondPlace/thirdPlace分布から最有力コースを取得
 */
function getTopCourse(distribution, excludeCourses) {
  if (!distribution) return null;
  let best = null;
  let bestProb = -1;
  for (const [course, prob] of Object.entries(distribution)) {
    const c = parseInt(course);
    if (excludeCourses.includes(c)) continue;
    if (prob > bestProb) {
      bestProb = prob;
      best = c;
    }
  }
  return best;
}

/**
 * ボート番号バッジ（小）
 */
function BoatBadge({ number }) {
  const colors = BOAT_COLORS[number] || BOAT_COLORS[1];
  return (
    <span
      className="flash-boat-number"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {number}
    </span>
  );
}

/**
 * 買い目データを生成（選択モデルに連動）
 */
function buildBetData(prediction, patternIndex) {
  const tp = prediction.turnPrediction;
  if (!tp?.patterns?.length) return null;
  const pattern = tp.patterns[patternIndex] || tp.patterns[0];
  const c1 = pattern.winnerCourse;
  const c2 = getTopCourse(pattern.secondPlace, [c1]);
  const c3 = getTopCourse(pattern.thirdPlace, [c1, c2].filter(Boolean));
  if (!c1 || !c2 || !c3) return null;

  const players = prediction.allPlayers || [];
  const getName = (course) => {
    const player = players.find((p) => p.number === course);
    if (!player?.name) return "";
    return player.name.split(/[\s　]/)[0];
  };

  return {
    courses: [c1, c2, c3],
    names: [getName(c1), getName(c2), getName(c3)],
    technique: pattern.technique,
  };
}

/**
 * 各艇の最も突出した指標を特定する（6艇中の順位付き）
 */
function findTopStat(boatNumber, allPlayers, racerStats) {
  const player = allPlayers.find((p) => p.number === boatNumber);
  if (!player) return null;

  const candidates = [];

  // 展示ST（小さいほど良い → 順位は昇順）
  const racer = racerStats?.find((r) => r.boatNumber === boatNumber);
  if (racer?.avgST > 0) {
    const stAll = racerStats
      .filter((r) => r.avgST > 0)
      .sort((a, b) => a.avgST - b.avgST);
    const rank = stAll.findIndex((r) => r.boatNumber === boatNumber) + 1;
    if (rank > 0) {
      candidates.push({
        label: "ST",
        value: racer.avgST.toFixed(2),
        rank,
        total: stAll.length,
      });
    }
  }

  // モーター2連率（大きいほど良い）
  if (player.motor2Rate != null) {
    const motorAll = [...allPlayers]
      .filter((p) => p.motor2Rate != null)
      .sort((a, b) => parseFloat(b.motor2Rate) - parseFloat(a.motor2Rate));
    const rank = motorAll.findIndex((p) => p.number === boatNumber) + 1;
    if (rank > 0) {
      candidates.push({
        label: "モーター",
        value: `${parseFloat(player.motor2Rate).toFixed(1)}%`,
        rank,
        total: motorAll.length,
      });
    }
  }

  // 全国勝率（大きいほど良い）
  if (player.winRate != null) {
    const winAll = [...allPlayers]
      .filter((p) => p.winRate != null)
      .sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));
    const rank = winAll.findIndex((p) => p.number === boatNumber) + 1;
    if (rank > 0) {
      candidates.push({
        label: "勝率",
        value: parseFloat(player.winRate).toFixed(2),
        rank,
        total: winAll.length,
      });
    }
  }

  // 当地勝率（大きいほど良い）
  if (player.localWinRate != null) {
    const localAll = [...allPlayers]
      .filter((p) => p.localWinRate != null)
      .sort((a, b) => parseFloat(b.localWinRate) - parseFloat(a.localWinRate));
    const rank = localAll.findIndex((p) => p.number === boatNumber) + 1;
    if (rank > 0) {
      candidates.push({
        label: "当地",
        value: parseFloat(player.localWinRate).toFixed(2),
        rank,
        total: localAll.length,
      });
    }
  }

  // 最も順位が高い（= 最も突出した）指標を返す
  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0] || null;
}

/**
 * 突出した攻撃実績を検出する（2勝以上 AND 勝率30%以上の場合のみ）
 */
function findAttackHighlight(boatNumber, racerStats) {
  const racer = racerStats?.find(
    (r) => r.boatNumber === boatNumber || r.course === boatNumber,
  );
  if (!racer) return null;

  const course = String(racer.course || racer.boatNumber);
  const counts = racer.courseRaceCounts?.[course];
  if (!counts || counts.wins < 2 || counts.total < 3) return null;

  const winRate = counts.wins / counts.total;
  if (winRate < 0.3) return null;

  const attackDist = racer.attackDistribution?.[course];
  if (!attackDist) return null;

  // 最も高い攻撃率の決まり手を取得
  let bestTech = null;
  let bestRate = 0;
  for (const [tech, rate] of Object.entries(attackDist)) {
    if (tech === "nige" || tech === "megumare") continue;
    if (rate > bestRate) {
      bestRate = rate;
      bestTech = tech;
    }
  }

  if (!bestTech || bestRate < 0.3) return null;

  return {
    tech: TECHNIQUE_NAMES[bestTech] || bestTech,
    rate: bestRate,
    wins: counts.wins,
    total: counts.total,
    course: parseInt(course),
  };
}

/**
 * 展開ストーリーを生成
 */
function buildStoryLine(betData) {
  if (!betData) return null;
  const techName = TECHNIQUE_NAMES[betData.technique] || betData.technique;

  // 1着の決まり手 + 2着・3着の流れ
  return `${betData.courses[0]}コース${techName} → ${betData.courses[1]}コース2着 → ${betData.courses[2]}コース3着`;
}

function PredictionFlash({
  prediction,
  selectedRace,
  selectedPatternIndex = 0,
}) {
  const betData = useMemo(
    () => buildBetData(prediction, selectedPatternIndex),
    [prediction, selectedPatternIndex],
  );

  const boatReasons = useMemo(() => {
    if (!betData || !prediction.allPlayers) return [];
    return betData.courses.map((course) => ({
      topStat: findTopStat(course, prediction.allPlayers, prediction.racerStats),
      attack: findAttackHighlight(course, prediction.racerStats),
    }));
  }, [betData, prediction.allPlayers, prediction.racerStats]);

  const storyLine = useMemo(() => buildStoryLine(betData), [betData]);

  if (!prediction?.turnPrediction || !prediction?.allPlayers) return null;
  if (!betData) return null;

  return (
    <div className="prediction-flash">
      <div className="flash-card-title">注目データ</div>

      {/* 上段: 買い目 */}
      <div className="flash-bet-section">
        <div className="flash-bet-courses">
          {betData.courses.map((course, i) => {
            const colors = BOAT_COLORS[course] || BOAT_COLORS[1];
            return (
              <div key={i} style={{ display: "contents" }}>
                {i > 0 && <span className="flash-bet-separator">&rarr;</span>}
                <div className="flash-bet-course-wrapper">
                  <div
                    className="flash-bet-course"
                    style={{
                      backgroundColor: colors.bg,
                      color: colors.text,
                    }}
                  >
                    {course}
                  </div>
                  <span className="flash-bet-rank">
                    {i === 0 ? "1着" : i === 1 ? "2着" : "3着"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="flash-bet-names">
          {betData.names.map((name, i) => (
            <span key={i} className="flash-bet-name">
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="flash-divider" />

      {/* 下段: 各艇の選出理由 */}
      <div className="flash-reasons">
        {betData.courses.map((course, i) => {
          const { topStat, attack } = boatReasons[i] || {};
          const rankLabel = i === 0 ? "1着" : i === 1 ? "2着" : "3着";
          return (
            <div key={course} className="flash-reason-block">
              <div className="flash-reason-row">
                <span className="flash-reason-rank">{rankLabel}</span>
                <BoatBadge number={course} />
                <span className="flash-reason-name">{betData.names[i]}</span>
                {topStat && (
                  <span className="flash-reason-stat">
                    {topStat.label}{" "}
                    <span className="flash-highlight">{topStat.value}</span>
                    <span className="flash-reason-position">
                      ({topStat.rank}位)
                    </span>
                  </span>
                )}
              </div>
              {attack && (
                <div className="flash-attack-highlight">
                  <span className="flash-attack-icon">&#x26A1;</span>
                  {attack.course}コース{attack.tech}率
                  <span className="flash-highlight">
                    {(attack.rate * 100).toFixed(0)}%
                  </span>
                  <span className="flash-reason-position">
                    ({attack.wins}勝/{attack.total}R)
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 展開ストーリー */}
      {storyLine && (
        <>
          <div className="flash-divider" />
          <div className="flash-story">
            <span className="flash-story-label">展開</span>
            <span className="flash-story-text">{storyLine}</span>
          </div>
        </>
      )}

    </div>
  );
}

export default PredictionFlash;
