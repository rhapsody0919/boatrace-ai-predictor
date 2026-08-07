/**
 * PredictionSection - レース予想セクション全体を管理
 * PredictionPanel（AI予想） + OutcomePatternPreview（出現パターン） + RaceResult（レース結果）
 * をまとめて、コンポーネント間の責務を明確化
 */
import { forwardRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import PredictionPanel from "./PredictionPanel";
import RaceResult from "./RaceResult";
import RaceReview from "./RaceReview";
import { prefetchRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { getRaceId } from "../../utils/raceId";

const PredictionSection = forwardRef(
  (
    {
      prediction,
      selectedRace,
      selectedModel,
      onSwitchModel,
      volatility,
      isAnalyzing,
      date,
    },
    ref,
  ) => {
    const { t } = useTranslation();

    // レース選択直後（AI分析演出の間）に分析データの取得を先行開始する。
    // withCacheのin-flightデデュープにより後続のDataRaceTable/RaceReviewの
    // 取得と重複せず、データ出走表の体感ロード時間を短縮する
    const prefetchRaceId = getRaceId(selectedRace);
    useEffect(() => {
      prefetchRaceAnalysisData(prefetchRaceId);
    }, [prefetchRaceId]);

    if (!selectedRace) return null;

    return (
      <section ref={ref} className="prediction-section">
        <h2>
          &#x1F4CA; {t("section.resultTitle")} -{" "}
          {selectedRace.venueCode
            ? t(`venues.${selectedRace.venueCode}`, selectedRace.venue)
            : selectedRace.venue}{" "}
          {selectedRace.raceNumber}R
        </h2>

        {/* データ出走表 + AIデータ分析（1マーク、配当妙味、出現パターン） */}
        <PredictionPanel
          prediction={prediction}
          selectedRace={selectedRace}
          selectedModel={selectedModel}
          onSwitchModel={onSwitchModel}
          volatility={volatility}
          isAnalyzing={isAnalyzing}
          date={date}
        />

        {/* レース結果セクション */}
        <RaceResult prediction={prediction} volatility={volatility} />

        {/* データで振り返る（結果確定後のみ表示） */}
        <RaceReview prediction={prediction} selectedRace={selectedRace} />
      </section>
    );
  },
);

PredictionSection.displayName = "PredictionSection";

export default PredictionSection;
