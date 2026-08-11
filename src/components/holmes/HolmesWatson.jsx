/**
 * HolmesWatson - LightGBM LambdaRank によるランキング予想 [β版・稼働中]
 *
 * ワトソンは Python モデルのためブラウザ内推論はせず、日次バッチが
 * watson_predictions テーブルに書いた予測（SHAP診断付き）を表示する。
 */
import { useState, useEffect } from "react";
import {
  getWatsonPredictions,
  getWatsonModelInfo,
} from "../../services/watsonService";
import { WatsonExplanation } from "./explanations";
import BoatChip from "./BoatChip";
import "./HolmesWatson.css";

const THEME = "#0284c7";

function formatJstTime(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tokyo",
    });
  } catch {
    return null;
  }
}

function RankRow({ rank, boat, name, prob, maxProb }) {
  return (
    <div className={`watson-rank-row ${rank === 1 ? "top" : ""}`}>
      <span className="watson-rank-num">{rank}位</span>
      <BoatChip boatNumber={boat} />
      <span className="watson-player-name">{name || ""}</span>
      <div className="watson-bar-track">
        <div
          className="watson-bar-fill"
          style={{
            width: `${Math.max((prob / maxProb) * 100, 2)}%`,
            background: THEME,
            opacity: rank === 1 ? 1 : 0.45,
          }}
        />
      </div>
      <span className="watson-rank-prob">{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

function DiagnosisBox({ boat, items }) {
  if (!items?.length) return null;
  return (
    <div className="watson-diagnosis">
      <div className="watson-diagnosis-title">
        🔬 本命 {boat}号艇の診断ポイント（SHAP寄与 上位3つ）
      </div>
      <ul>
        {items.map((it) => (
          <li key={it.feature}>
            <span
              className={`watson-contrib-sign ${
                it.contrib >= 0 ? "plus" : "minus"
              }`}
            >
              {it.contrib >= 0 ? "↑" : "↓"}
            </span>
            {it.label}
            <span className="watson-contrib-value">
              {it.contrib >= 0 ? "+" : ""}
              {it.contrib.toFixed(2)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RaceCard({ race }) {
  const topBoat = race.rankOrder[0];
  const topProb = race.winProbs[String(topBoat)] ?? 0;
  const maxProb = Math.max(topProb, 1e-6);
  return (
    <details className="watson-race-card">
      <summary>
        <span className="watson-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="watson-race-time">
          {race.startTime ? race.startTime.slice(0, 5) : ""}
        </span>
        <span className="watson-race-pick">
          本命 <strong>{topBoat}号艇</strong>
        </span>
        <span className="watson-prob-badge">{(topProb * 100).toFixed(1)}%</span>
      </summary>
      <div className="watson-race-body">
        <div className="watson-rank-list">
          {race.rankOrder.map((boat, i) => (
            <RankRow
              key={boat}
              rank={i + 1}
              boat={boat}
              name={race.playerNames[boat]}
              prob={race.winProbs[String(boat)] ?? 0}
              maxProb={maxProb}
            />
          ))}
        </div>
        <DiagnosisBox
          boat={topBoat}
          items={race.explanations?.[String(topBoat)]}
        />
      </div>
    </details>
  );
}

function HolmesWatson() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getWatsonModelInfo();

  useEffect(() => {
    getWatsonPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  const updatedAt =
    races.length > 0 ? formatJstTime(races[0].predictedAt) : null;

  return (
    <div
      className="holmes-detective-card"
      style={{ borderTop: `4px solid ${THEME}` }}
    >
      <div className="holmes-detective-header">
        <div className="holmes-detective-icon" style={{ background: THEME }}>
          🩺
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">ワトソン予想</div>
          <div className="holmes-detective-title">
            信頼できる相棒 - データドリブンの医師
          </div>
          <div className="holmes-detective-tech">
            技術: <code>LightGBM LambdaRank（順位の直接学習 + SHAP診断）</code>
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
        <div className="watson-stats-grid">
          <div className="watson-stat">
            <div className="watson-stat-value">
              {info.metrics
                ? `${(info.metrics.top1_hit_rate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="watson-stat-label">
              1着的中率
              <span className="watson-stat-sub">（本命艇が1着になる率）</span>
            </div>
          </div>
          <div className="watson-stat">
            <div className="watson-stat-value">
              {info.deltaR2 != null
                ? `${info.deltaR2 >= 0 ? "+" : ""}${info.deltaR2.toFixed(3)}`
                : "—"}
            </div>
            <div className="watson-stat-label">
              ΔR²（市場への上乗せ）
              <span className="watson-stat-sub">
                （オッズ単独より結合が良い分）
              </span>
            </div>
          </div>
          <div className="watson-stat">
            <div className="watson-stat-value">
              {info.metrics?.auc?.toFixed(3) ?? "—"}
            </div>
            <div className="watson-stat-label">
              1着AUC
              <span className="watson-stat-sub">
                {info.vsPoirotV2?.auc
                  ? `ポアロV2: ${info.vsPoirotV2.auc.toFixed(3)}（同水準）`
                  : ""}
              </span>
            </div>
          </div>
          <div className="watson-stat">
            <div className="watson-stat-value">
              {info.nRaces?.toLocaleString() ?? "—"}
            </div>
            <div className="watson-stat-label">
              学習レース数
              <span className="watson-stat-sub">
                最終学習: {info.trainedAt ? info.trainedAt.slice(0, 10) : "—"}
                （週次更新）
              </span>
            </div>
          </div>
        </div>
        <p className="watson-honesty-note">
          ⚠️ 正直な注記:
          表示するのは「勝つ確率のランキング」であり、儲かる買い目では
          ありません。オッズとの結合・期待値計算は未対応です。予測は1日3回
          （朝・昼・夕方）の更新のため、展示データが未反映のレースがあります。
          研究目的の実験モデルとしてご覧ください。
        </p>
      </section>

      {/* 本日のライブ診断 */}
      <section className="holmes-section">
        <h3>🩺 本日の診断（1日3回更新）</h3>
        {loading ? (
          <p className="watson-loading">診断中…</p>
        ) : races.length === 0 ? (
          <p className="watson-loading">
            本日の予測データがまだありません（朝8時以降に生成されます）
          </p>
        ) : (
          <>
            <p className="watson-summary-line">
              {races.length}レースを診断
              {updatedAt ? `（予測更新: ${updatedAt} JST）` : ""}
            </p>
            <div className="watson-race-list">
              {races.map((r) => (
                <RaceCard key={r.raceId} race={r} />
              ))}
            </div>
          </>
        )}
      </section>

      <WatsonExplanation />
    </div>
  );
}

export default HolmesWatson;
