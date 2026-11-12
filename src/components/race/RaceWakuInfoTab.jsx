/**
 * RaceWakuInfoTab - レース詳細ページ「枠別情報」タブ（BOA-307）
 * 承認済みモック（Artifact v4、docs/proposal/competitor-kyoteibiyori/
 * race-detail-page-tab-comparison-2026-09-15.md参照）に基づく実装。
 * 選手（艇番）を選び、その選手のコース別（1〜6）成績を棒グラフで見せ、
 * コースをタップするとそのコースで出走した直近10走の着順にドリルダウンできる。
 * 別カードで会場全体の決まり手傾向（全艇合算）を見せる。
 *
 * 役割分担（チケット項目1、同じ会場×枠番データの二重実装を避ける）:
 * - VenueTendencyPanel（会場×枠番の決まり手/トップスタート率/負け決まり手/
 *   展示最速転換率、今節6艇分を横並び）とは主語が異なる。VenueTendencyPanelは
 *   「この会場・この枠番」の傾向を6艇並べて一覧するのに対し、本タブは
 *   「選んだ1選手」がコース別にどんな成績かを掘り下げるドリルダウン型。
 *   このタブがアクティブな間はPredictionPanel側でVenueTendencyPanel・
 *   DataRaceTable・EmbeddedAnalysisSection群を非表示にし二重表示を避ける
 *   （showPreRaceAnalysisTools、他のタブと同じ扱い）
 * - AttackDefenseAnalysis（艇別の攻め手/守り手分布）とも別軸。決まり手傾向
 *   カードは「会場全体でどの決まり手がどのくらいの頻度で発生するか」という
 *   全艇合算の単純集計で、艇別の攻守分布を見せるAttackDefenseAnalysisとは
 *   異なる粒度・目的の情報
 *
 * データソース（phase aのT3-1で差し替え済み。旧記述は下の「廃止した出所」参照）:
 * - コース別成績・直近10走: supabaseDataService.getRacerScopedRaceStats
 *   （選手単位の全走。実進入コースは race_results.actual_course_N）。
 *   集計は courseGridStats.js の純関数に閉じ込め、追加クエリは発行しない
 * - ST考察のベースライン: getStCourseBaseline（st_course_baseline、コース×級別24行）
 * - 逃げシミュレーション: getNigeSimulation（nige_second_by_course、会場別）
 * - 決まり手傾向（全艇）: getWinningTechniqueStatsのデータ
 *   （winning_technique_stats、直近90日）を6艇合算して技法別シェアに変換する。
 *   VenueTendencyPanelは艇別の最頻値1件のみ表示するが、本カードは
 *   技法5種類の全体シェアを見せる別の切り口
 *
 * 廃止した出所: racerStats.courseRaceCounts（racer_aggregated_stats由来、
 * 艇番＝コース前提）と、race_entries.boat_number基準で直近走を引いていた
 * supabaseDataServiceのメソッドは、グリッドを実進入コース基準にした時点で
 * 母集団が合わなくなり使わなくなった（後者は呼び出し元消滅のため削除済み）。
 * 同じサイト内で艇番基準と実進入コース基準が混在する点はBOA-302が横断課題
 * として起票済み（courseGridStats.js のモジュールコメント参照）。
 *
 * 調査結果（チケット項目4）: モーター情報タブのMotorWakuStatsGrid（BOA-283/301）は
 * テーブル形式で、承認済みモックのバーチャート＋インライン展開とは見た目が
 * 合わないため直接流用はしない
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import { useRaceEntryFlyingRows } from "../../hooks/useRaceEntryFlyingRows";
import { useSixBoatCourseStats } from "../../hooks/useSixBoatCourseStats";
import {
  useGridFold,
  useOpenCell,
  useScopedRacerFetch,
  useWakuInfoVenueData,
} from "./RaceWakuInfoTabData";
import RaceWakuInfoTabBody from "./RaceWakuInfoTabBody";
import "./RaceWakuInfoTab.css";

// raceId は受け取らない: コース別成績を racer_aggregated_stats（レース単位の
// getRaceRacerStats）から getRacerScopedRaceStats（選手単位）に切り替えたため不要になった
function RaceWakuInfoTab({
  venueCode,
  players,
  raceId,
  focusedBoat,
  onFocusBoat,
  sixBoatPeriod,
  onSixBoatPeriodChange,
}) {
  const { t } = useTranslation();
  // 選択中の選手の出走履歴（実進入コース付き）。undefined=取得中、null=取得失敗
  const [scopedByRacer, setScopedByRacer] = useState({});
  // 出走表の今期F・L数（艇番→{f_count, l_count}）。データ出走表と同じフック（BOA-638）
  const flyingRowByBoat = useRaceEntryFlyingRows(raceId);
  // Fバッジの「今節」の印（BOA-440）
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);
  const venueData = useWakuInfoVenueData(venueCode);

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );

  // 選んでいる艇はタブをまたいで共有する（BOA-492）。共有値が null（＝まだ
  // どの艇も選んでいない）のときは従来どおり1号艇を見せる
  const selectedBoat = focusedBoat ?? sortedPlayers[0]?.number ?? null;
  const { openCell, toggleCell } = useOpenCell(selectedBoat);
  const fold = useGridFold(selectedBoat, scopedByRacer);

  const selectedPlayer =
    sortedPlayers.find((p) => p.number === selectedBoat) ?? sortedPlayers[0];

  const racerIdsKey = sortedPlayers.map((p) => p.racerId ?? "").join(",");
  useScopedRacerFetch(racerIdsKey, setScopedByRacer);

  // 6艇の表（直近3期）と1艇ずつの表の「直近3期」の行は同じ取得・同じ行を使う（BOA-1295）
  const sixBoatStats = useSixBoatCourseStats({
    raceDate: raceId?.slice(0, 10),
    venueCode,
    players: sortedPlayers,
  });

  if (sortedPlayers.length === 0) return null;

  return (
    <RaceWakuInfoTabBody
      t={t}
      venueCode={venueCode}
      raceId={raceId}
      onFocusBoat={onFocusBoat}
      sixBoatPeriod={sixBoatPeriod}
      onSixBoatPeriodChange={onSixBoatPeriodChange}
      sortedPlayers={sortedPlayers}
      selectedBoat={selectedBoat}
      selectedPlayer={selectedPlayer}
      scopedByRacer={scopedByRacer}
      openCell={openCell}
      toggleCell={toggleCell}
      fold={fold}
      sixBoatStats={sixBoatStats}
      flyingRowByBoat={flyingRowByBoat}
      currentMeetFlyingBoats={currentMeetFlyingBoats}
      venueData={venueData}
    />
  );
}

export default RaceWakuInfoTab;
