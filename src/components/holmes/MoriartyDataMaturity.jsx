function MoriartyDataMaturity({ totalBets = 0, stage = "starting" }) {
  const target = stage === "starting" ? 30 : stage === "gathering" ? 100 : 300;
  const progress = Math.min((totalBets / target) * 100, 100);

  const stageLabels = {
    starting: "初期段階（30件到達でチャート表示開始）",
    gathering: "データ蓄積中（100件到達で会場分析を開始）",
    growing: "成長中（300件到達で全機能解放）",
    mature: "成熟（全機能利用可能）",
  };

  return (
    <div className="moriarty-maturity">
      <div className="moriarty-maturity-header">
        <span className="moriarty-maturity-label">{stageLabels[stage]}</span>
        <span className="moriarty-maturity-count">
          {totalBets} / {target} 件
        </span>
      </div>
      <div className="moriarty-progress-track">
        <div
          className="moriarty-progress-fill"
          style={{ width: `${progress}%` }}
          role="progressbar"
          aria-valuenow={totalBets}
          aria-valuemax={target}
        />
      </div>
    </div>
  );
}

export default MoriartyDataMaturity;
