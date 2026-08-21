/**
 * HolmesMycroft - Transformer（選手履歴系列）による予想 [β版・稼働中]
 *
 * PyTorch モデルのためブラウザ内推論はせず、日次バッチが mycroft_predictions
 * テーブルに書いた予測（attention 根拠付き）を表示する。
 */
import { useState, useEffect } from "react";
import {
  getMycroftPredictions,
  getMycroftModelInfo,
  venueName,
} from "../../services/mycroftService";
import { MycroftExplanation } from "./explanations";
import BoatChip from "./BoatChip";
import "./HolmesMycroft.css";

// #ca8a04は白文字で2.94:1しかなくAA未達のため濃色に変更（axe-core検出、Holmes.jsxのTABS配列と統一）
const THEME = "#92400e";

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
    <div className={`mycroft-rank-row ${rank === 1 ? "top" : ""}`}>
      <span className="mycroft-rank-num">{rank}位</span>
      <BoatChip boatNumber={boat} />
      <span className="mycroft-player-name">{name || ""}</span>
      <div className="mycroft-bar-track">
        <div
          className="mycroft-bar-fill"
          style={{
            width: `${Math.max((prob / maxProb) * 100, 2)}%`,
            background: THEME,
            opacity: rank === 1 ? 1 : 0.45,
          }}
        />
      </div>
      <span className="mycroft-rank-prob">{(prob * 100).toFixed(1)}%</span>
    </div>
  );
}

function MemoryBox({ boat, items }) {
  if (!items?.length) {
    return (
      <div className="mycroft-memory">
        <div className="mycroft-memory-title">
          🧠 {boat}号艇の記憶: 参照できる過去走がありません（新人・データ欠損）
        </div>
      </div>
    );
  }
  const maxWeight = Math.max(...items.map((it) => it.weight), 1e-6);
  return (
    <div className="mycroft-memory">
      <div className="mycroft-memory-title">
        🧠 本命 {boat}号艇について特に見た過去走
      </div>
      <ul>
        {items.map((it) => (
          <li key={`${it.race_date}-${it.venue_code}`}>
            <span className="mycroft-memory-date">{it.race_date}</span>
            <span className="mycroft-memory-venue">
              {venueName(it.venue_code)}
            </span>
            <span
              className={`mycroft-memory-result ${
                it.result === "着外" ? "bad" : "good"
              }`}
            >
              {it.result}
            </span>
            <span className="mycroft-memory-ago">{it.days_ago}日前</span>
            <div className="mycroft-memory-track">
              <div
                className="mycroft-memory-fill"
                style={{ width: `${(it.weight / maxWeight) * 100}%` }}
              />
            </div>
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
    <details className="mycroft-race-card">
      <summary>
        <span className="mycroft-race-title">
          {race.venueName} {race.raceNumber}R
        </span>
        <span className="mycroft-race-time">
          {race.startTime ? race.startTime.slice(0, 5) : ""}
        </span>
        <span className="mycroft-race-pick">
          本命 <strong>{topBoat}号艇</strong>
        </span>
        <span className="mycroft-prob-badge">
          {(topProb * 100).toFixed(1)}%
        </span>
      </summary>
      <div className="mycroft-race-body">
        <div className="mycroft-rank-list">
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
        <MemoryBox
          boat={topBoat}
          items={race.attentionEvidence?.[String(topBoat)]}
        />
      </div>
    </details>
  );
}

function HolmesMycroft() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getMycroftModelInfo();

  useEffect(() => {
    getMycroftPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  const updatedAt =
    races.length > 0 ? formatJstTime(races[0].predictedAt) : null;
  const gain = info.ensemble?.logloss_gain_vs_watson;

  return (
    <div
      className="holmes-detective-card"
      style={{ borderTop: `4px solid ${THEME}` }}
    >
      <div className="holmes-detective-header">
        <div className="holmes-detective-icon" style={{ background: THEME }}>
          🏛️
        </div>
        <div className="holmes-detective-meta">
          <div className="holmes-detective-name">マイクロフト予想</div>
          <div className="holmes-detective-title">
            ホームズの兄 - 全てを記憶する巨大な頭脳
          </div>
          <div className="holmes-detective-tech">
            技術:{" "}
            <code>
              Transformer（選手の過去{info.maxHistory ?? 32}走を読む）
            </code>
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
        <div className="mycroft-stats-grid">
          <div className="mycroft-stat">
            <div className="mycroft-stat-value">
              {info.metrics
                ? `${(info.metrics.top1_hit_rate * 100).toFixed(1)}%`
                : "—"}
            </div>
            <div className="mycroft-stat-label">
              1着的中率
              <span className="mycroft-stat-sub">
                {info.vsWatson
                  ? `ワトソン: ${(info.vsWatson.top1_hit_rate * 100).toFixed(1)}%`
                  : "（本命艇が1着になる率）"}
              </span>
            </div>
          </div>
          <div className="mycroft-stat">
            <div className="mycroft-stat-value">
              {gain != null ? `${gain >= 0 ? "+" : ""}${gain.toFixed(4)}` : "—"}
            </div>
            <div className="mycroft-stat-label">
              アンサンブル増分
              <span className="mycroft-stat-sub">
                （ワトソンと併用したlogloss改善）
              </span>
            </div>
          </div>
          <div className="mycroft-stat">
            <div className="mycroft-stat-value">
              {info.deltaR2 != null
                ? `${info.deltaR2 >= 0 ? "+" : ""}${info.deltaR2.toFixed(3)}`
                : "—"}
            </div>
            <div className="mycroft-stat-label">
              ΔR²（市場への上乗せ）
              <span className="mycroft-stat-sub">
                （オッズ単独より結合が良い分）
              </span>
            </div>
          </div>
          <div className="mycroft-stat">
            <div className="mycroft-stat-value">
              {info.nRaces?.toLocaleString() ?? "—"}
            </div>
            <div className="mycroft-stat-label">
              学習レース数
              <span className="mycroft-stat-sub">
                最終学習: {info.trainedAt ? info.trainedAt.slice(0, 10) : "—"}
              </span>
            </div>
          </div>
        </div>
        <p className="mycroft-honesty-note">
          ⚠️ 正直な注記:
          マイクロフトは「選手の履歴系列」だけを新しく読むモデルで、
          単独の的中率がワトソンを上回るとは限りません。価値があるかどうかは
          <strong>アンサンブル増分</strong>
          （ワトソンと併用したときに改善するか）で判断してください。
          表示は確率であり儲かる買い目ではありません。予測は1日3回更新のため、
          展示データが未反映のレースがあります。
        </p>
      </section>

      {/* 本日の推理 */}
      <section className="holmes-section">
        <h3>🏛️ 本日の推理（1日3回更新）</h3>
        {loading ? (
          <p className="mycroft-loading">記憶を照会中…</p>
        ) : races.length === 0 ? (
          <p className="mycroft-loading">
            本日の予測データがまだありません（朝8時以降に生成されます）
          </p>
        ) : (
          <>
            <p className="mycroft-summary-line">
              {races.length}レースを推理
              {updatedAt ? `（予測更新: ${updatedAt} JST）` : ""}
            </p>
            <div className="mycroft-race-list">
              {races.map((r) => (
                <RaceCard key={r.raceId} race={r} />
              ))}
            </div>
          </>
        )}
      </section>

      <MycroftExplanation />
    </div>
  );
}

export default HolmesMycroft;
