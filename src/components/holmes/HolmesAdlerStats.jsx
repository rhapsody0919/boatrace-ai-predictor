import { calcLoglossImprovePct } from "./HolmesAdlerLogic";

// モデル実測値（時系列検証）
export function AdlerStatsSection({ info }) {
  const loglossImprovePct = calcLoglossImprovePct(info);
  return (
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
  );
}
