/**
 * PredictionPanel の分析ツール群（データ出走表・枠番傾向・埋め込み分析アコーディオン）
 *
 * 分析ツールコンポーネントの埋め込み（FR-3〜9）: デフォルト閉、開いた時だけ
 * データ取得する。モーター調子（BOA-308）はモータ情報タブへ昇格したため、
 * 重複表示を避けるためここでは表示しない
 */
import DataRaceTable from "./DataRaceTable";
import VenueTendencyPanel from "./VenueTendencyPanel";
import EmbeddedAnalysisSection from "./EmbeddedAnalysisSection";
import RacerFormChart from "../analysis/RacerFormChart";
import StPredictabilityChart from "../analysis/StPredictabilityChart";
import ExhibitionTimeTrendChart from "../analysis/ExhibitionTimeTrendChart";
import RacerTechniqueProfileChart from "../analysis/RacerTechniqueProfileChart";
import RacerBoatReturnRateChart from "../analysis/RacerBoatReturnRateChart";
import AttackDefenseAnalysis from "../analysis/AttackDefenseAnalysis";

const EMBEDDED_ANALYSES = [
  { titleKey: "racer", hintKey: "racerForm", Chart: RacerFormChart },
  { titleKey: "st", hintKey: "stDeviation", Chart: StPredictabilityChart },
  {
    titleKey: "extrend",
    hintKey: "exhibitionTimeTrend",
    Chart: ExhibitionTimeTrendChart,
  },
  {
    titleKey: "techprofile",
    hintKey: "racerTechniqueProfile",
    Chart: RacerTechniqueProfileChart,
  },
  {
    titleKey: "returnrate",
    hintKey: "returnRateAnalysis",
    Chart: RacerBoatReturnRateChart,
  },
  {
    titleKey: "attackdefense",
    hintKey: "attackDefense",
    Chart: AttackDefenseAnalysis,
  },
];

export default function PredictionPanelAnalysisTools({
  analysisRaceId,
  prediction,
  venueCode,
  t,
}) {
  return (
    <>
      {/* データ出走表（主役）: 出走6選手×客観的な生データの一覧マトリクス */}
      <DataRaceTable
        raceId={analysisRaceId}
        prediction={prediction}
        venueCode={venueCode}
      />

      {/* この会場の枠番別傾向（FR-2）: 会場×枠番の過去傾向。選手個人のデータ出走表とは
          主語が異なるため別コンポーネントとして分離する */}
      <VenueTendencyPanel venueCode={venueCode} raceId={analysisRaceId} />

      {venueCode &&
        analysisRaceId &&
        EMBEDDED_ANALYSES.map(({ titleKey, hintKey, Chart }) => (
          <EmbeddedAnalysisSection
            key={hintKey}
            title={t(`analysisPage.tabs.${titleKey}`)}
            hintKey={hintKey}
          >
            <Chart
              embedded
              initialVenueCode={venueCode}
              initialRaceId={analysisRaceId}
            />
          </EmbeddedAnalysisSection>
        ))}
    </>
  );
}
