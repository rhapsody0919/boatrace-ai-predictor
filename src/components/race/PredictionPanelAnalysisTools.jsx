/**
 * PredictionPanel の分析ツール群（データ出走表・枠番傾向）
 *
 * 以前は下に分析ツールの畳み6つ（選手調子・STのズレ・展示タイム推移・選手別決まり手・
 * 回収率・超展開）を並べていた。出走表の行と重なるか定義・期間が画面に無いため、
 * 既定の画面から外した（オーナー 2026-11-24）。図は /winning-technique に残り、
 * 出走表の行の名前から飛べる
 */
import { useMemo } from "react";
import DataRaceTable from "./DataRaceTable";
import { useDatePredictions } from "../../hooks/useDatePredictions";
import { buildDayRanks } from "../../pure/dayEntrantRank.js";
import VenueTendencyPanel from "./VenueTendencyPanel";

export default function PredictionPanelAnalysisTools({
  analysisRaceId,
  prediction,
  venueCode,
}) {
  // 出走表の節の入口（BOA-1727）。今日出走する選手の中の位置（意味づけ、オーナー 2026-11-28）。
  // その日の全レースはページが既に読んだ物（withCache の同じ鍵）なので、通信は増えない
  const { races } = useDatePredictions(analysisRaceId?.slice(0, 10));
  const players = prediction?.allPlayers;
  const dayRanks = useMemo(() => buildDayRanks(races, players), [races, players]);
  return (
    <>
      {/* データ出走表（主役）: 出走6選手×客観的な生データの一覧マトリクス */}
      <DataRaceTable
        raceId={analysisRaceId}
        prediction={prediction}
        venueCode={venueCode}
        dayRanks={dayRanks}
      />

      {/* この会場の枠番別傾向（FR-2）: 会場×枠番の過去傾向。選手個人のデータ出走表とは
          主語が異なるため別コンポーネントとして分離する */}
      <VenueTendencyPanel venueCode={venueCode} raceId={analysisRaceId} />
    </>
  );
}
