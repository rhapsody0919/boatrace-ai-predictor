import { useState, useEffect } from "react";
import {
  getSherlockPredictions,
  getSherlockModelInfo,
} from "../../services/sherlockService";
import { SherlockExplanation } from "./explanations";
import BoatChip from "./BoatChip";
import { BOAT_COLORS } from "./boat-colors";
import "./HolmesSherlock.css";

const THEME = "#059669";

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
            width: `${Math.max(pct, 2)}%`,
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

function RaceCard({ race }) {
  const evLabel =
    race.bestEv != null ? (
      <span
        className={`sherlock-ev-badge ${race.bestEv >= 1.15 ? "positive" : ""}`}
      >
        EV {race.bestEv.toFixed(2)}
      </span>
    ) : (
      <span className="sherlock-ev-badge muted">オッズ待ち</span>
    );

  return (
    <details className="sherlock-race-card">
      <summary>
        <span className="sherlock-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="sherlock-race-time">
          {race.startTime ? race.startTime.slice(0, 5) : ""}
        </span>
        <span className="sherlock-race-pick">
          本命 <BoatChip boatNumber={race.topPick} />
        </span>
        {evLabel}
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

function HolmesSherlock() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getSherlockModelInfo();

  useEffect(() => {
    getSherlockPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  const withOdds = races.filter((r) => r.hasOdds).length;
  const evPicks = races.filter((r) => r.bestEv != null && r.bestEv >= 1.15);

  return (
    <div
      className="holmes-detective-card"
      style={{ borderTop: `4px solid ${THEME}` }}
    >
      <div className="holmes-detective-header">
        <div className="holmes-detective-icon" style={{ background: THEME }}>
          🔍
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">シャーロック予想</div>
          <div className="holmes-detective-title">
            名探偵本人 - 事実と市場、両方を観察する推理機械
          </div>
          <div className="holmes-detective-tech">
            技術: <code>Conditional Logit + Odds Blend (Benter 2段階)</code>
          </div>
        </div>
        <div
          className="holmes-status-badge"
          style={{ background: THEME, color: "#fff" }}
        >
          β版・稼働中
        </div>
      </div>

      {/* モデル実測値（walk-forward） */}
      <section className="holmes-section">
        <h3>📏 実測パフォーマンス（未来データ検証）</h3>
        <div className="sherlock-stats-grid">
          <div className="sherlock-stat">
            <div className="sherlock-stat-value">
              {info.eval
                ? `${(info.eval.combined.accuracy * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="sherlock-stat-label">
              1着的中率
              {info.eval && (
                <span className="sherlock-stat-sub">
                  （オッズ単独 {(info.eval.odds.accuracy * 100).toFixed(1)}%）
                </span>
              )}
            </div>
          </div>
          <div className="sherlock-stat">
            <div className="sherlock-stat-value">
              {info.eval ? `+${info.eval.deltaR2.toFixed(3)}` : "—"}
            </div>
            <div className="sherlock-stat-label">
              ΔR²（市場への上乗せ情報量）
            </div>
          </div>
          <div className="sherlock-stat">
            <div className="sherlock-stat-value">
              {info.trainingRaces?.toLocaleString() ?? "—"}
            </div>
            <div className="sherlock-stat-label">学習レース数</div>
          </div>
          <div className="sherlock-stat">
            <div className="sherlock-stat-value">
              {info.trainedAt ? info.trainedAt.slice(0, 10) : "—"}
            </div>
            <div className="sherlock-stat-label">最終学習日（週次更新）</div>
          </div>
        </div>
        <p className="sherlock-honesty-note">
          ⚠️ 正直な注記:
          的中率・情報量は市場平均を上回りますが、EV選別後の単勝回収率は実測約70%で、
          控除率25%の壁は未突破です。研究目的の実験モデルとしてご覧ください。
        </p>
      </section>

      {/* 本日のライブ推理 */}
      <section className="holmes-section">
        <h3>🕐 本日の推理（ブラウザ内でリアルタイム計算）</h3>
        {loading ? (
          <p className="sherlock-loading">推理中…</p>
        ) : races.length === 0 ? (
          <p className="sherlock-loading">本日の出走データがまだありません</p>
        ) : (
          <>
            <p className="sherlock-summary-line">
              {races.length}レースを推理（オッズ取得済み {withOdds}件 / EV≥1.15
              の妙味候補 <strong>{evPicks.length}件</strong>）
            </p>
            {evPicks.length > 0 && (
              <div className="sherlock-ev-picks">
                <h4>💎 妙味あり（EV上位）</h4>
                {evPicks
                  .slice()
                  .sort((a, b) => b.bestEv - a.bestEv)
                  .slice(0, 5)
                  .map((r) => (
                    <div key={r.raceId} className="sherlock-ev-pick-row">
                      <span>
                        {r.venueName} {r.raceNumber}R
                      </span>
                      <BoatChip boatNumber={r.bestEvBoat} />
                      <span className="sherlock-ev-badge positive">
                        EV {r.bestEv.toFixed(2)}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <div className="sherlock-race-list">
              {races.map((r) => (
                <RaceCard key={r.raceId} race={r} />
              ))}
            </div>
          </>
        )}
      </section>

      <SherlockExplanation />
    </div>
  );
}

export default HolmesSherlock;
