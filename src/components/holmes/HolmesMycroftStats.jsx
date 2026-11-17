/**
 * HolmesMycroft の「モデル実測値（時系列検証）」節（移すだけ）
 */
import {
  formatTop1,
  formatVsWatson,
  formatGain,
  formatDeltaR2,
  formatNRaces,
  formatTrainedAt,
} from "./HolmesMycroftLogic";

function HolmesMycroftStats({ info, gain }) {
  return (
    <section className="holmes-section">
      <h3>📏 実測パフォーマンス（未来データ検証）</h3>
      <div className="mycroft-stats-grid">
        <div className="mycroft-stat">
          <div className="mycroft-stat-value">{formatTop1(info)}</div>
          <div className="mycroft-stat-label">
            1着的中率
            <span className="mycroft-stat-sub">{formatVsWatson(info)}</span>
          </div>
        </div>
        <div className="mycroft-stat">
          <div className="mycroft-stat-value">{formatGain(gain)}</div>
          <div className="mycroft-stat-label">
            アンサンブル増分
            <span className="mycroft-stat-sub">
              （ワトソンと併用したlogloss改善）
            </span>
          </div>
        </div>
        <div className="mycroft-stat">
          <div className="mycroft-stat-value">{formatDeltaR2(info)}</div>
          <div className="mycroft-stat-label">
            ΔR²（市場への上乗せ）
            <span className="mycroft-stat-sub">
              （オッズ単独より結合が良い分）
            </span>
          </div>
        </div>
        <div className="mycroft-stat">
          <div className="mycroft-stat-value">{formatNRaces(info)}</div>
          <div className="mycroft-stat-label">
            学習レース数
            <span className="mycroft-stat-sub">
              最終学習: {formatTrainedAt(info)}
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
  );
}

export default HolmesMycroftStats;
