import BoatChip from "./BoatChip";
import { BOAT_COLORS } from "./boat-colors";
import { THEME, barWidthPct, formatStartTime } from "./HolmesSherlockLogic";

/**
 * HolmesSherlock のレースカード（移すだけ）
 */

function ProbBar({ boat, isTop }) {
  const pct = boat.prob * 100;
  const c = BOAT_COLORS[boat.boatNumber] || BOAT_COLORS[1];
  return (
    <div className={`sherlock-prob-row ${isTop ? "top" : ""}`}>
      <BoatChip boatNumber={boat.boatNumber} />
      <span className="sherlock-player">
        {boat.playerName || "—"}
        <span className="sherlock-grade">{boat.grade}</span>
      </span>
      <div className="sherlock-bar-track">
        <div
          className="sherlock-bar-fill"
          style={{
            width: `${barWidthPct(pct)}%`,
            background: isTop ? THEME : c.border,
            opacity: isTop ? 1 : 0.55,
          }}
        />
      </div>
      <span className="sherlock-prob-value">{pct.toFixed(1)}%</span>
      <span className="sherlock-odds-value">
        {boat.odds ? `${boat.odds}倍` : "—"}
      </span>
    </div>
  );
}

function EvLabel({ race }) {
  return race.bestEv != null ? (
    <span
      className={`sherlock-ev-badge ${race.bestEv >= 1.15 ? "positive" : ""}`}
    >
      EV {race.bestEv.toFixed(2)}
    </span>
  ) : (
    <span className="sherlock-ev-badge muted">オッズ待ち</span>
  );
}

function RaceCard({ race }) {
  return (
    <details className="sherlock-race-card">
      <summary>
        <span className="sherlock-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="sherlock-race-time">
          {formatStartTime(race.startTime)}
        </span>
        <span className="sherlock-race-pick">
          本命 <BoatChip boatNumber={race.topPick} />
        </span>
        <EvLabel race={race} />
      </summary>
      <div className="sherlock-race-body">
        {!race.hasExhibition && (
          <p className="sherlock-note">
            ※ 展示データ未取得（出走表のみで推理）
          </p>
        )}
        {!race.hasOdds && (
          <p className="sherlock-note">
            ※ オッズ未取得のため実力モデル単独の勝率です
          </p>
        )}
        {race.boats.map((b) => (
          <ProbBar
            key={b.boatNumber}
            boat={b}
            isTop={b.boatNumber === race.topPick}
          />
        ))}
        {race.hasOdds && (
          <p className="sherlock-ev-note">
            EV（期待値）= 勝率 × オッズ × 0.95（オッズ変動ヘアカット）。EV ≥
            1.15 で妙味ありと判断
          </p>
        )}
      </div>
    </details>
  );
}

export default RaceCard;
