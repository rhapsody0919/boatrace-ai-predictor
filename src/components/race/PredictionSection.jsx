/**
 * PredictionSection - レース予想セクション全体を管理
 * PredictionPanel（AI予想） + OutcomePatternPreview（出現パターン） + RaceResult（レース結果）
 * をまとめて、コンポーネント間の責務を明確化
 */
import { forwardRef } from "react";
import PredictionPanel from "./PredictionPanel";
import OutcomePatternPreview from "./OutcomePatternPreview";
import RaceResult from "./RaceResult";
import { useRaceData } from "../../hooks/useRaceData";

const PredictionSection = forwardRef(({
  prediction,
  selectedRace,
  selectedModel,
  onSwitchModel,
  volatility,
  isAnalyzing,
  date,
  showExhibition,
}, ref) => {
  if (!selectedRace) return null;

  const { venueCode, venueName } = useRaceData(selectedRace);

  return (
    <section ref={ref} className="prediction-section">
      <h2>
        &#x1F4CA; AI予想結果 - {venueName} {selectedRace.raceNumber}R
      </h2>

      {/* AI予想セクション（予想テーブル、1マーク、配当妙味、超展開データ） */}
      <PredictionPanel
        prediction={prediction}
        selectedRace={selectedRace}
        selectedModel={selectedModel}
        onSwitchModel={onSwitchModel}
        volatility={volatility}
        isAnalyzing={isAnalyzing}
        date={date}
        showExhibition={showExhibition}
      />

      {/* 出現パターンセクション（会場の過去90日3連単分析） */}
      {venueCode && venueName && (
        <OutcomePatternPreview
          venueCode={venueCode}
          venueName={venueName}
          prediction={prediction}
          selectedModel={selectedModel}
        />
      )}

      {/* レース結果セクション */}
      <RaceResult prediction={prediction} volatility={volatility} />
    </section>
  );
});

PredictionSection.displayName = "PredictionSection";

export default PredictionSection;
