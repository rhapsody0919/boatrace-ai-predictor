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
import { RACE_STATUS } from "../../utils/raceStatus";

const PredictionSection = forwardRef(
  ({ prediction, selectedRace, isAnalyzing, date, status }, ref) => {
    const { t } = useTranslation();

    // レース選択直後（AI分析演出の間）に分析データの取得を先行開始する。
    // withCacheのin-flightデデュープにより後続のDataRaceTable/RaceReviewの
    // 取得と重複せず、データ出走表の体感ロード時間を短縮する
    const prefetchRaceId = getRaceId(selectedRace);
    useEffect(() => {
      prefetchRaceAnalysisData(prefetchRaceId);
    }, [prefetchRaceId]);

    if (!selectedRace) return null;

    // レース前は「予想の作業台」（データ出走表が主役）、
    // 結果確定後は「検証の場」（結果・振り返りが主役）として順序を入れ替える。
    // statusが渡されない呼び出し元向けのフォールバックとして旧ロジックも残す
    const finished = status
      ? status === RACE_STATUS.FINISHED
      : Boolean(prediction?.result?.finished);

    const panel = (
      <PredictionPanel
        prediction={prediction}
        selectedRace={selectedRace}
        isAnalyzing={isAnalyzing}
        date={date}
        status={status}
      />
    );
    const result = <RaceResult prediction={prediction} />;
    const review = (
      <RaceReview prediction={prediction} selectedRace={selectedRace} />
    );

    return (
      <section ref={ref} className="prediction-section">
        <h2>
          &#x1F4CA; {t("section.resultTitle")} -{" "}
          {selectedRace.venueCode
            ? t(`venues.${selectedRace.venueCode}`, selectedRace.venue)
            : selectedRace.venue}{" "}
          {selectedRace.raceNumber}R
        </h2>

        {finished ? (
          <>
            {result}
            {review}
            {panel}
          </>
        ) : (
          <>
            {panel}
            {result}
            {review}
          </>
        )}
      </section>
    );
  },
);

PredictionSection.displayName = "PredictionSection";

export default PredictionSection;
