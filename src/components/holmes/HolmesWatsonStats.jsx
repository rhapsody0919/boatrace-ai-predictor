/**
 * HolmesWatson の「モデル実測値（時系列検証）」節（移すだけ）
 */

function HolmesWatsonStats({ info }) {
  return (
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
  );
}

export default HolmesWatsonStats;
