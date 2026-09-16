/**
 * PredictionSection - レース予想セクション全体を管理
 * PredictionPanel（データ出走表・AI予想・基本情報/モータ情報/結果タブ）を
 * ラップし、見出しとレース分析データの先行取得を担う。
 *
 * 2026-09-15（BOA-305〜312、日和スタイルのタブ構成）: 従来はレース状態
 * （未確定/確定）に応じてPredictionPanel/RaceResult/RaceReviewの表示順を
 * 入れ替えていたが、RaceResultは「結果」タブへ、RaceReview（データで振り返る）は
 * 撤去のうえPredictionPanel内のRaceTabsへ統合したため、この入れ替えロジック自体が
 * 不要になった。結果確定後にどちらを優先表示するかは、RaceTabsのdefaultTabId
 * （PredictionPanel内、finished ? "result" : "basic"）が代わりに担う
 *
 * 2026-09-16（BOA-334）: 見出しに締切時刻を追加。selectedRace.startTime
 * （races.start_time相当、"HH:MM"形式）をそのまま表示する。新規データ取得は
 * 不要（RaceDetailPage.jsxのselectedRace構築時に既にracePrediction.startTimeが
 * 渡ってきている）。結果確定後（status===FINISHED）は「締切」表示自体が
 * 過去の事実を今起きていることのように見せてしまうため非表示にする
 * （レビュー指摘、RaceCard.jsxのRaceDeadlineCountdownが締切後は非表示にする
 * のと同じ考え方）
 */
import { forwardRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import PredictionPanel from "./PredictionPanel";
import { prefetchRaceAnalysisData } from "../../hooks/useRaceAnalysisData";
import { getRaceId } from "../../utils/raceId";
import { RACE_STATUS } from "../../utils/raceStatus";

const PredictionSection = forwardRef(
  ({ prediction, selectedRace, isAnalyzing, date, status }, ref) => {
    const { t } = useTranslation();

    // レース選択直後（AI分析演出の間）に分析データの取得を先行開始する。
    // withCacheのin-flightデデュープにより後続のDataRaceTable/RaceBasicInfoTabの
    // 取得と重複せず、データ出走表の体感ロード時間を短縮する
    const prefetchRaceId = getRaceId(selectedRace);
    const prefetchVenueCode = selectedRace?.venueCode ?? null;
    useEffect(() => {
      prefetchRaceAnalysisData(prefetchRaceId, prefetchVenueCode);
    }, [prefetchRaceId, prefetchVenueCode]);

    if (!selectedRace) return null;

    return (
      <section ref={ref} className="prediction-section">
        <h2>
          &#x1F4CA; {t("section.resultTitle")} -{" "}
          {selectedRace.venueCode
            ? t(`venues.${selectedRace.venueCode}`, selectedRace.venue)
            : selectedRace.venue}{" "}
          {selectedRace.raceNumber}R
          {selectedRace.startTime && status !== RACE_STATUS.FINISHED && (
            <span className="prediction-section-deadline">
              {t("section.resultTitleDeadline", {
                time: selectedRace.startTime,
              })}
            </span>
          )}
        </h2>

        <PredictionPanel
          prediction={prediction}
          selectedRace={selectedRace}
          isAnalyzing={isAnalyzing}
          date={date}
          status={status}
        />
      </section>
    );
  },
);

PredictionSection.displayName = "PredictionSection";

export default PredictionSection;
