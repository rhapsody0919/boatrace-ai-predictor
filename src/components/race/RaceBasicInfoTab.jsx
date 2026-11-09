/**
 * RaceBasicInfoTab - レース詳細ページ「基本情報」タブ（BOA-306）
 *
 * 日和の期間別グリッド（勝率×7区分の数値羅列）をそのまま模倣せず、6艇の
 * 横棒グラフで「どの条件で調子が良いか」を直感的に見せる
 * （[[feedback_ui_visualization_over_statistical_rigor]]の方針）。
 *
 * データソースは2系統:
 * 1. 期間=今期 かつ グレード=全レースの場合（勝率/2連対率/3連対率のみ）:
 *    race_entriesの公式集計済み値（win_rate/local_win_rate/global_2rate/
 *    local_2rate/global_3rate/local_3rate）をそのまま使う。boatrace.jp側で
 *    算出済みの正確な値のため、自社で集計し直す必要が無い
 * 2. それ以外（グレード・期間で絞り込む場合、および平均STは常に）:
 *    getRacerScopedRaceStats(racerId)で選手の過去2年分の出走履歴を取得し、
 *    クライアント側でフィルタ・集計する（basicInfoStats.js）。平均STには
 *    公式集計値の相当品が無いため常にこちら（2026-09-16、レビュー指摘#1で
 *    平均STも会場/グレードでフィルタできるよう対応）。対象は表示中の6選手のみ
 *    （1選手×該当レースのみのライブ集計であり、BOA-303が問題視する
 *    全選手×全会場の横断集計とはスコープが異なる）
 *
 * 「得意会場」ドリルダウンは、上記2と同じgetRacerScopedRaceStatsの生データを
 * 会場別に集計し、現在選択中の指標でランキングする（2026-09-16、レビュー
 * 指摘#3で固定指標(勝率)から選択中指標に連動するよう変更。以前使っていた
 * getRacerVenueStatsは廃止）
 *
 * 部品は basic-info/ に分けてある（BOA-1401）。ここは状態と取得を束ねるだけ
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCurrentMeetFlyingBoats } from "../../hooks/useCurrentMeetFlyingBoats";
import { parseRaceId } from "../../utils/raceId";
import { recordsBeforeRace, currentTermStart } from "./basicInfoStats";
import {
  useOfficialRates,
  useOfficialAvgSt,
  useRacerPeriodStats,
  useAccidentData,
  useScopedStats,
} from "./basic-info/useBasicInfoData";
import {
  computeBarValues,
  buildBarScale,
  findOfficialRow,
} from "./basic-info/barValues";
import FilterControls from "./basic-info/FilterControls";
import BarRow from "./basic-info/BarRow";
import ExpandedPanel from "./basic-info/ExpandedPanel";
import "./RaceBasicInfoTab.css";

function RaceBasicInfoTab({
  raceId,
  venueCode,
  players,
  focusedBoat,
  onFocusBoat,
}) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState("winRate");
  const [scope, setScope] = useState("national");
  const [grade, setGradeState] = useState("all");
  // 初期は「公式」（公式の出走表と同じ値、BOA-775）。公式の値はグレードで絞れないので、
  // グレードを選ぶと今期（term）に、公式に戻すとグレードを全レースに戻す（チップの表示と中身を食い違わせない）
  const [period, setPeriodState] = useState("official");
  const setGrade = (g) => {
    setGradeState(g);
    if (g !== "all" && period === "official") setPeriodState("term");
  };
  const setPeriod = (p) => {
    setPeriodState(p);
    if (p === "official") setGradeState("all");
  };
  // 展開中の艇はタブをまたいで共有する（BOA-492）。null は「誰も展開していない」で、
  // 従来のタブ内stateと同じ初期値。枠別・今節タブで艇を選んでからこのタブへ来ると、
  // その艇が展開済みで開く
  const expandedBoat = focusedBoat ?? null;
  // 展開パネルの内訳（トレンド/当地/条件別）。どの艇のものかを一緒に持ち、
  // 艇が変わったら "trend" に戻す。艇の選択はタブ間共有（BOA-492）で
  // このタブの操作以外でも変わるため、押した瞬間に戻すのでは足りない。
  // 副作用として、同じ艇を閉じて開き直したときは前の内訳が復元される
  // （従来は毎回 "trend" に戻っていた）。同じ選手の同じ切り口に戻るだけなので
  // そのままにしている
  const [expandedViewState, setExpandedViewState] = useState({
    boat: null,
    view: "trend",
  });
  const expandedView =
    expandedViewState.boat === expandedBoat ? expandedViewState.view : "trend";
  const setExpandedView = (view) =>
    setExpandedViewState({ boat: expandedBoat, view });

  const sortedPlayers = [...(players ?? [])].sort(
    (a, b) => a.number - b.number,
  );
  const racerIdsKey = sortedPlayers.map((p) => p.racerId ?? "").join(",");
  const raceDate = parseRaceId(raceId)?.date ?? null;

  // 「公式」（全レース）のときだけ公式の値（勝率/2連対率/3連対率は出走表、平均STは期別成績）を出し、
  // それ以外（今期・直近・グレードで絞る）は当サイトの走（getRacerScopedRaceStats）から計算する（BOA-775）
  const needsOwnAggregation = period !== "official" || grade !== "all";

  const officialRates = useOfficialRates(raceId);
  const { officialAvgSt, retryOfficialAvgSt } = useOfficialAvgSt(raceId);
  const { periodStats, periodFailed, retryPeriod } = useRacerPeriodStats(
    racerIdsKey,
    raceDate,
  );
  const { accidentRecords, accidentByRacer, accidentRangeLabel, retryAccident } =
    useAccidentData(racerIdsKey, raceDate, sortedPlayers);
  const scopedStatsByRacer = useScopedStats({
    sortedPlayers,
    raceId,
    expandedBoat,
    needsOwnAggregation,
  });
  // Fバッジの「今節」の印（BOA-440）
  const currentMeetFlyingBoats = useCurrentMeetFlyingBoats(raceId);

  // 表示中のレースより前の走だけを使う（BOA-605。枠別情報タブの BOA-603 と同じ）。
  // 過去のレースを開いたとき、そのレース自身と後日の走がバー・得意会場・条件別に入り、
  // 結果を知った状態の数字になっていた。取得前（undefined）・失敗（null）はそのまま返す
  const recordsOf = (racerId) => {
    const records = scopedStatsByRacer[racerId];
    return Array.isArray(records)
      ? recordsBeforeRace(records, raceId)
      : records;
  };
  // 「直近3ヶ月・直近1ヶ月」の起点もレースの日にそろえる（当日のレースは今日と同じ）
  const periodAnchor = raceId
    ? new Date(`${raceId.slice(0, 10)}T12:00:00+09:00`)
    : new Date();
  // 「今期」の初日（BOA-775）。表示中のレースの日付で決める
  const currentTermFrom = currentTermStart(raceDate);

  if (sortedPlayers.length === 0) return null;

  const values = computeBarValues(sortedPlayers, {
    metric,
    scope,
    grade,
    period,
    venueCode,
    needsOwnAggregation,
    officialRates,
    officialAvgSt,
    recordsOf,
    periodAnchor,
  });
  const { isRelativeScaleMetric, barWidthPercent, valueDigits, bestBoats } =
    buildBarScale(values, metric, needsOwnAggregation);

  const toggleExpanded = (boatNumber) => {
    onFocusBoat(expandedBoat === boatNumber ? null : boatNumber);
  };

  return (
    <div className="race-basic-info-tab">
      <FilterControls
        metric={metric}
        setMetric={setMetric}
        scope={scope}
        setScope={setScope}
        grade={grade}
        setGrade={setGrade}
        period={period}
        setPeriod={setPeriod}
        needsOwnAggregation={needsOwnAggregation}
        officialAvgSt={officialAvgSt}
        onRetryOfficialAvgSt={retryOfficialAvgSt}
        currentTermFrom={currentTermFrom}
      />

      {/* 勝率（公式の点数）・平均STの棒は、6艇の中の最小〜最大で長さを決める。
          平均STは差が0.03秒でも棒の長さが10%と100%に開くので、長さだけで差の大きさを
          読ませないよう書き添える（#1064 ファン評価2周目） */}
      {isRelativeScaleMetric && (
        <p className="rbit-metric-caveat rbit-relative-note">
          {t("basicInfo.relativeBarNote")}
        </p>
      )}
      {/* PC（1200px 以上）は棒を左、凡例を右の2段（BOA-881）。1199px 以下は囲みが無いのと同じ */}
      <div className="race-split">
        <div className="race-split__main">
          <div className="rbit-bars">
            {values.map(({ boat, value, n, isSmallSample, loading }) => {
              const player = sortedPlayers.find((p) => p.number === boat);
              const accident = accidentByRacer.get(player?.racerId);
              return (
                <div key={boat} className="rbit-bar-block">
                  <BarRow
                    boat={boat}
                    value={value}
                    n={n}
                    isSmallSample={isSmallSample}
                    loading={loading}
                    player={player}
                    expanded={expandedBoat === boat}
                    onToggle={() => toggleExpanded(boat)}
                    barWidth={barWidthPercent(value)}
                    isBest={bestBoats.has(boat)}
                    metric={metric}
                    valueDigits={valueDigits}
                    needsOwnAggregation={needsOwnAggregation}
                    officialRow={findOfficialRow(officialRates, boat)}
                    currentMeet={currentMeetFlyingBoats.has(boat)}
                    accident={accident}
                  />

                  {expandedBoat === boat && (
                    <ExpandedPanel
                      boat={boat}
                      player={player}
                      raceId={raceId}
                      venueCode={venueCode}
                      metric={metric}
                      setMetric={setMetric}
                      needsOwnAggregation={needsOwnAggregation}
                      expandedView={expandedView}
                      setExpandedView={setExpandedView}
                      rawRecords={scopedStatsByRacer[player?.racerId]}
                      records={recordsOf(player?.racerId)}
                      accident={accident}
                      accidentFailed={accidentRecords === null}
                      accidentRangeLabel={accidentRangeLabel}
                      onRetryAccident={retryAccident}
                      nowRow={findOfficialRow(officialRates, player?.number)}
                      periodStats={periodStats}
                      periodFailed={periodFailed}
                      onRetryPeriod={retryPeriod}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="race-split__side">
          {/* Fバッジ・Lバッジの凡例。選手名の行は <button> で「?」を置けず、説明は
              title（ホバー）だけになるため、スマホでは意味を知る手段が無かった
              （BOA-440 ファン評価1周目）。バッジが1つも無いレースでは出さない */}
          {(officialRates ?? []).some(
            (r) => (r.f_count ?? 0) > 0 || (r.l_count ?? 0) > 0,
          ) && <p className="rbit-note">{t("flyingBadge.legend")}</p>}
          {/* 事故率の目印の凡例（BOA-327）。目印が1つでも出ているときだけ。「あと◯点」を予選の得点と
              取り違えないよう、何の点数かを書く（ファン評価1周目） */}
          {[...accidentByRacer.values()].some((a) => a.showBadge) && (
            <p className="rbit-note">{t("basicInfo.accidentLegend")}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default RaceBasicInfoTab;
