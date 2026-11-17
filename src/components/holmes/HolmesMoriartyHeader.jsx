export default function HolmesMoriartyHeader() {
  return (
    <div className="holmes-detective-header">
      <div className="holmes-detective-icon" style={{ background: "#1f2937" }}>
        🎩
      </div>
      <div className="holmes-detective-meta">
        <div className="holmes-detective-name">モリアーティ予想</div>
        <div className="holmes-detective-title">
          犯罪界のナポレオン - 数学的最適化の教授
        </div>
        <div className="holmes-detective-tech">
          技術: <code>Probability Calibration + Kelly Criterion</code>
        </div>
      </div>
      <div className="holmes-status-badge moriarty-status-badge">稼働中</div>
    </div>
  );
}
