/**
 * HolmesSherlock の「モデル実測値（walk-forward）」節（移すだけ）
 */

function HolmesSherlockStats({ info }) {
  return (
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
  );
}

export default HolmesSherlockStats;
