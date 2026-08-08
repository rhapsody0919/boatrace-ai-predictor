/**
 * HolmesAdler - 位置別温度付き Plackett-Luce による順列確率予想 [β版・稼働中]
 *
 * シャーロックの勝率をブラウザ内で順列確率（2連単・3連単・3連複）に展開する。
 */
import { useState, useEffect } from "react";
import {
  getAdlerPredictions,
  getAdlerModelInfo,
} from "../../services/adlerService";
import { AdlerExplanation } from "./explanations";
import BoatChip from "./BoatChip";
import "./HolmesAdler.css";

const THEME = "#9333ea";

function ComboChips({ boats, ordered }) {
  return (
    <span className="adler-combo-chips">
      {boats.map((b, i) => (
        <span key={b} className="adler-combo-chip-wrap">
          {i > 0 && (
            <span className="adler-combo-sep">{ordered ? "→" : "・"}</span>
          )}
          <BoatChip boatNumber={b} />
        </span>
      ))}
    </span>
  );
}

function PermRow({ perm, rank, maxProb, ordered }) {
  const pct = perm.prob * 100;
  return (
    <div className={`adler-perm-row ${rank === 1 ? "top" : ""}`}>
      <span className="adler-perm-rank">{rank}</span>
      <ComboChips boats={perm.boats} ordered={ordered} />
      <div className="adler-bar-track">
        <div
          className="adler-bar-fill"
          style={{
            width: `${Math.max((perm.prob / maxProb) * 100, 2)}%`,
            background: THEME,
            opacity: rank === 1 ? 1 : 0.45,
          }}
        />
      </div>
      <span className="adler-perm-prob">{pct.toFixed(1)}%</span>
    </div>
  );
}

function PermList({ title, perms, ordered }) {
  if (!perms?.length) return null;
  const maxProb = perms[0].prob;
  return (
    <div className="adler-perm-list">
      <h4>{title}</h4>
      {perms.map((perm, i) => (
        <PermRow
          key={perm.label}
          perm={perm}
          rank={i + 1}
          maxProb={maxProb}
          ordered={ordered}
        />
      ))}
    </div>
  );
}

function RaceCard({ race }) {
  const top = race.permutations.trifecta[0];
  return (
    <details className="adler-race-card">
      <summary>
        <span className="adler-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="adler-race-time">
          {race.startTime ? race.startTime.slice(0, 5) : ""}
        </span>
        <span className="adler-race-pick">
          3連単本命 <strong>{top.label}</strong>
        </span>
        <span className="adler-prob-badge">{(top.prob * 100).toFixed(1)}%</span>
      </summary>
      <div className="adler-race-body">
        {!race.hasExhibition && (
          <p className="adler-note">※ 展示データ未取得（出走表のみで推理）</p>
        )}
        {!race.hasOdds && (
          <p className="adler-note">
            ※ オッズ未取得のため実力モデル単独の勝率から展開しています
          </p>
        )}
        <PermList
          title="🥇 3連単 TOP5"
          perms={race.permutations.trifecta}
          ordered
        />
        <div className="adler-perm-columns">
          <PermList
            title="🥈 2連単 TOP3"
            perms={race.permutations.exacta}
            ordered
          />
          <PermList
            title="🔗 3連複 TOP3"
            perms={race.permutations.trio}
            ordered={false}
          />
        </div>
      </div>
    </details>
  );
}

function HolmesAdler() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getAdlerModelInfo();

  useEffect(() => {
    getAdlerPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  const loglossImprovePct =
    info.eval?.trifecta_logloss_plain && info.eval?.trifecta_logloss_fitted
      ? ((info.eval.trifecta_logloss_plain - info.eval.trifecta_logloss_fitted) /
          info.eval.trifecta_logloss_plain) *
        100
      : null;

  return (
    <div
      className="holmes-detective-card"
      style={{ borderTop: `4px solid ${THEME}` }}
    >
      <div className="holmes-detective-header">
        <div className="holmes-detective-icon" style={{ background: THEME }}>
          💎
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">アドラー予想</div>
          <div className="holmes-detective-title">
            ホームズを唯一出し抜いた女 - 順位確率の魔法使い
          </div>
          <div className="holmes-detective-tech">
            技術: <code>Plackett-Luce（位置別温度・実データフィット）</code>
          </div>
        </div>
        <div
          className="holmes-status-badge"
          style={{ background: THEME, color: "#fff" }}
        >
          β版・稼働中
        </div>
      </div>

      {/* モデル実測値（時系列検証） */}
      <section className="holmes-section">
        <h3>📏 実測パフォーマンス（未来データ検証）</h3>
        <div className="adler-stats-grid">
          <div className="adler-stat">
            <div className="adler-stat-value">
              {info.eval
                ? `${(info.eval.top1_trifecta_hit_rate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="adler-stat-label">
              3連単1点的中率
              <span className="adler-stat-sub">（120通り中の最尤1点）</span>
            </div>
          </div>
          <div className="adler-stat">
            <div className="adler-stat-value">
              {loglossImprovePct != null
                ? `+${loglossImprovePct.toFixed(1)}%`
                : "—"}
            </div>
            <div className="adler-stat-label">
              3連単logloss改善
              <span className="adler-stat-sub">（無補正Harville比）</span>
            </div>
          </div>
          <div className="adler-stat">
            <div className="adler-stat-value">
              γ {info.gamma?.toFixed(2)} / δ {info.delta?.toFixed(2)}
            </div>
            <div className="adler-stat-label">
              フィット済み位置別温度
              <span className="adler-stat-sub">（2着 / 3着の減衰）</span>
            </div>
          </div>
          <div className="adler-stat">
            <div className="adler-stat-value">
              {info.nRaces?.toLocaleString() ?? "—"}
            </div>
            <div className="adler-stat-label">
              フィットレース数
              <span className="adler-stat-sub">
                最終学習: {info.trainedAt ? info.trainedAt.slice(0, 10) : "—"}
                （週次更新）
              </span>
            </div>
          </div>
        </div>
        <p className="adler-honesty-note">
          ⚠️ 正直な注記:
          表示するのは「確率」であり、儲かる買い目ではありません。3連単・3連複の
          オッズデータが未収集のため期待値（EV）は計算できず、確率上位の組み合わせは
          低配当になりがちです。研究目的の実験モデルとしてご覧ください。
        </p>
      </section>

      {/* 本日のライブ推理 */}
      <section className="holmes-section">
        <h3>🕐 本日の推理（ブラウザ内でリアルタイム計算）</h3>
        {loading ? (
          <p className="adler-loading">推理中…</p>
        ) : races.length === 0 ? (
          <p className="adler-loading">本日の出走データがまだありません</p>
        ) : (
          <>
            <p className="adler-summary-line">
              {races.length}レースの順列確率を計算（シャーロックの勝率 ×
              Plackett-Luce 展開）
            </p>
            <div className="adler-race-list">
              {races.map((r) => (
                <RaceCard key={r.raceId} race={r} />
              ))}
            </div>
          </>
        )}
      </section>

      <AdlerExplanation />
    </div>
  );
}

export default HolmesAdler;
