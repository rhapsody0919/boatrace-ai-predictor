import MoriartyStatsHeader from "./MoriartyStatsHeader";
import MoriartyDataMaturity from "./MoriartyDataMaturity";
import MoriartyROIChart from "./MoriartyROIChart";
import MoriartyVenueBreakdown from "./MoriartyVenueBreakdown";
import MoriartyCalibrationDiagram from "./MoriartyCalibrationDiagram";
import MoriartyRecommendationList from "./MoriartyRecommendationList";

export function MoriartyStageStarting({
  stats,
  totalBets,
  stage,
  recommendations,
}) {
  return (
    <div className="moriarty-stage-starting">
      <section className="holmes-section">
        <h3>⏳ データ蓄積中</h3>
        <p className="moriarty-stage-desc">
          運用 {stats.operation_days ?? 0} 日目 / 推奨レース {totalBets} 件
        </p>
        <MoriartyDataMaturity totalBets={totalBets} stage={stage} />
        <div className="moriarty-notice moriarty-notice--warning">
          初期段階のため数値は参考程度です。30件到達でチャートが表示されます。
        </div>
      </section>
      {recommendations.length > 0 && (
        <section className="holmes-section">
          <h3>本日の推奨レース</h3>
          <MoriartyRecommendationList recommendations={recommendations} />
        </section>
      )}
    </div>
  );
}

export function MoriartyStageGathering({
  stats,
  totalBets,
  stage,
  roiHistory,
  recommendations,
}) {
  return (
    <>
      <section className="holmes-section">
        <MoriartyStatsHeader stats={stats} />
      </section>
      <section className="holmes-section">
        <MoriartyDataMaturity totalBets={totalBets} stage={stage} />
      </section>
      <section className="holmes-section">
        <h3>累積回収率推移</h3>
        <MoriartyROIChart data={roiHistory} showSampleWarning />
      </section>
      <section className="holmes-section">
        <h3>本日の推奨レース</h3>
        <MoriartyRecommendationList recommendations={recommendations} />
      </section>
    </>
  );
}

function MoriartyStageBase({ stats, roiHistory, venueBreakdown }) {
  return (
    <>
      <section className="holmes-section">
        <MoriartyStatsHeader stats={stats} />
      </section>
      <section className="holmes-section">
        <h3>累積回収率推移</h3>
        <MoriartyROIChart data={roiHistory} />
      </section>
      <section className="holmes-section">
        <h3>会場別回収率</h3>
        <MoriartyVenueBreakdown data={venueBreakdown} />
      </section>
    </>
  );
}

export function MoriartyStageGrowing({
  stats,
  roiHistory,
  venueBreakdown,
  recommendations,
}) {
  return (
    <>
      <MoriartyStageBase
        stats={stats}
        roiHistory={roiHistory}
        venueBreakdown={venueBreakdown}
      />
      <section className="holmes-section">
        <h3>本日の推奨レース</h3>
        <MoriartyRecommendationList recommendations={recommendations} />
      </section>
    </>
  );
}

export function MoriartyStageMature({
  stats,
  roiHistory,
  venueBreakdown,
  calibrationData,
  recommendations,
}) {
  return (
    <>
      <MoriartyStageBase
        stats={stats}
        roiHistory={roiHistory}
        venueBreakdown={venueBreakdown}
      />
      <section className="holmes-section">
        <h3>予測キャリブレーション</h3>
        <MoriartyCalibrationDiagram data={calibrationData} />
      </section>
      <section className="holmes-section">
        <h3>本日の推奨レース</h3>
        <MoriartyRecommendationList recommendations={recommendations} />
      </section>
    </>
  );
}
