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
} from "../../services/mycroftService";
import { MycroftExplanation } from "./explanations";
import HolmesMycroftStats from "./HolmesMycroftStats";
import HolmesMycroftRaceCard from "./HolmesMycroftRaceCard";
import { THEME, summaryUpdatedAt } from "./HolmesMycroftLogic";
import "./HolmesMycroft.css";

function HolmesMycroft() {
  const [races, setRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const info = getMycroftModelInfo();

  useEffect(() => {
    getMycroftPredictions(null)
      .then(setRaces)
      .finally(() => setLoading(false));
  }, []);

  const updatedAt = summaryUpdatedAt(races);
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
      <HolmesMycroftStats info={info} gain={gain} />

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
                <HolmesMycroftRaceCard key={r.raceId} race={r} />
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
