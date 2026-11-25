import { useEffect, useMemo, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import RacerConditionStats from "./RacerConditionStats";
import { aggregateRacerVenueBoatStats } from "../../utils/racerVenueBoatStats.js";
import "./RacerPerformanceStats.css";
import { techniqueColor } from "../../utils/techniqueColors";
import { ST_TREND_ID } from "../../utils/racerPagePath";
import { useRacerVcState } from "./useRacerVcState";
import {
  NARROW_CHART_RUNS,
  courseStatsOf,
  displayTechniquesOf,
  racePagesOf,
  raceLabelOfWith,
  stAxisOf,
  trendChartsOf,
  vcLabelOf,
} from "./racerPerformanceView";
import FilterScopeFrame from "./RacerFilterScope";
import { VcFilterBar, VcHistoryError } from "./RacerPerformanceFilters";
import { SummaryCards, VcCards, WinRateChart } from "./RacerPerformanceCards";
import {
  BothFixedNoRuns,
  CourseBreakdown,
  CrossBoatBreakdown,
  CrossVenueBreakdown,
  ReturnRateTable,
  VenueBreakdown,
} from "./RacerPerformanceBreakdown";
import {
  ExhibitionChart,
  RaceList,
  StTrendChart,
} from "./RacerPerformanceTrends";

// 決まり手内訳のバー+凡例。フィルタ選択時（決まり手タブ）・未選択時（unfiltered
// セクション）の両方で同じ見た目を使うため共通化（BOA-159レビューで発見）
function TechniqueBarLegend({ techniques }) {
  return (
    <>
      <div className="racer-technique-bar" translate="no">
        {techniques.map((tech) => (
          <div
            key={tech.technique}
            className="racer-technique-bar-segment"
            style={{
              width: `${tech.percentage}%`,
              background: techniqueColor(tech.technique),
            }}
            title={`${tech.technique} ${tech.percentage.toFixed(1)}%`}
          />
        ))}
      </div>
      <ul className="racer-technique-legend" translate="no">
        {techniques.map((tech) => (
          <li key={tech.technique}>
            <span
              className="racer-technique-dot"
              style={{ background: techniqueColor(tech.technique) }}
            />
            {tech.technique} {tech.percentage.toFixed(0)}%（{tech.countLabel}）
          </li>
        ))}
      </ul>
    </>
  );
}

/** 決まり手傾向（常時表示、ADR-0063）。常に現在の全フィルタ条件（vcData）で絞り込んだ内訳を表示する */
function TechniqueSection({ view, vcActive, vcLabel }) {
  const { hasVcData, vcData, displayTechniques } = view;
  return (
    <div className="racer-technique-profile">
      <h3>
        決まり手傾向（
        {hasVcData ? "2025年12月以降・最大過去2年" : "過去90日"}・勝利時）
        {vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
      </h3>
      {displayTechniques.length > 0 ? (
        <TechniqueBarLegend techniques={displayTechniques} />
      ) : hasVcData && vcData.win === 0 ? (
        <p className="racer-stat-note">1着なし（0回/{vcData.n}回）</p>
      ) : hasVcData ? (
        <p className="racer-stat-note">
          決まり手データなし（勝利{vcData.win}回中、記録なし）
        </p>
      ) : null}
    </div>
  );
}

/** 全体集計（決まり手・推移・レース一覧は常時これを使う。ADR-0063）。会場・枠番どちらも"all"の場合はnull/nullで全体集計になる */
function useVcData(vc) {
  const { vcHistory, vcVenueFixed, vcBoatFixed, vcVenue, vcBoat } = vc;
  const vcGradeValue = vc.vcGrade === "all" ? null : vc.vcGrade;
  const vcStageValue = vc.vcStage === "all" ? null : vc.vcStage;
  return useMemo(() => {
    if (!vcHistory) return null;
    return aggregateRacerVenueBoatStats(
      vcHistory,
      vcVenueFixed ? Number(vcVenue) : null,
      vcBoatFixed ? Number(vcBoat) : null,
      vcGradeValue,
      vcStageValue,
    );
  }, [
    vcHistory,
    vcVenueFixed,
    vcBoatFixed,
    vcVenue,
    vcBoat,
    vcGradeValue,
    vcStageValue,
  ]);
}

/** 表示の材料。vcDataの有無で表示ソースを切り替える（履歴ロード中・エラー時は既存props＝サーバー側事前集計をフォールバック表示に使う） */
function useRacerPerformanceView(t, vc, stats) {
  const vcData = useVcData(vc);
  const {
    formTrend,
    techniqueProfile,
    aggregatedStats,
    exhibitionTimeTrend,
    boatReturnRate,
    venueStats,
  } = stats ?? {};
  const hasVcData = !!vcData;
  const showStTrend = hasVcData && vcData.stN > 1;
  useStTrendScroll(showStTrend);
  const isNarrow =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(max-width: 600px)").matches ?? false);
  const hasTechniques = (techniqueProfile?.techniques?.length ?? 0) > 0;
  const courseStats = courseStatsOf(vc.historyCourseStats, aggregatedStats);
  return {
    vcData,
    hasVcData,
    showStTrend,
    isNarrow,
    chartRuns: (rows) => (isNarrow ? rows.slice(-NARROW_CHART_RUNS) : rows),
    raceLabelOf: raceLabelOfWith(t),
    // 進入コースは選んだときだけラベルの末尾に足す（vcLabelOf は4軸のまま）
    vcLabel:
      vc.vcCourse === "all"
        ? vcLabelOf(t, vc)
        : [vcLabelOf(t, vc), `${vc.vcCourse}コース`]
            .filter((s) => s !== "全条件")
            .join("×"),
    ...stAxisOf(vcData),
    displayTechniques: displayTechniquesOf(vcData, techniqueProfile),
    ...trendChartsOf(formTrend, exhibitionTimeTrend),
    hasTechniques,
    // 決まり手傾向セクション（常時表示、ADR-0063）の表示要否。vcDataがあれば
    // 出走自体があるかどうか（n>0）で判定、フォールバック時はhasTechniquesで判定
    showTechniqueSection: hasVcData ? vcData.n > 0 : hasTechniques,
    hasReturnRate: (boatReturnRate?.length ?? 0) > 0,
    ...racePagesOf(vcData, vc.vcRacePage),
    courseStats,
    hasCourseStats: courseStats.length > 0,
    hasVenueStats: (venueStats?.length ?? 0) > 0,
  };
}

// 他の画面の「STの推移 ›」（龍神ソナーの平均STの表、BOA-879）から #st-trend で来たら、描画後に1回だけそこへ移る。
// 成績は非同期で届くので、ブラウザ標準のハッシュの移動（読み込み時の1回）では間に合わない
function useStTrendScroll(showStTrend) {
  const { hash } = useLocation();
  const stTrendScrolled = useRef(false);
  useEffect(() => {
    if (hash !== `#${ST_TREND_ID}` || !showStTrend || stTrendScrolled.current)
      return;
    document.getElementById(ST_TREND_ID)?.scrollIntoView({ block: "start" });
    stTrendScrolled.current = true;
  }, [hash, showStTrend]);
}

const hasAnyDataOf = (stats, view) =>
  stats?.formSummary != null ||
  view.chartData.length > 0 ||
  view.hasTechniques ||
  stats?.aggregatedStats != null ||
  view.exhibitionChartData.length > 0 ||
  view.hasReturnRate ||
  view.hasCourseStats ||
  view.hasVenueStats;

// 全会場の会場別・枠番別の表はグレード・レース種別で集計し直していない。枠の中で「絞り込みが効く」と
// 言う以上、選んでいる間は出さない（効かない値を同じ顔で並べない。ファン評価 #3279 1周 P1）
function overviewBlocks(t, vc, view, venueStats) {
  if (vc.vcGrade !== "all" || vc.vcStage !== "all") {
    if (!view.hasVenueStats && !view.hasCourseStats) return [];
    return [
      <p key="overviewHidden" className="racer-stat-note" data-testid="racer-overview-hidden">
        全会場の会場別・枠番別の表はグレード・レース種別では絞れないため、選んでいる間は出しません。会場か枠番を選ぶと、絞った表が出ます
      </p>,
    ];
  }
  return [
    view.hasVenueStats && (
      <VenueBreakdown key="venue" t={t} vc={vc} venueStats={venueStats} />
    ),
    view.hasCourseStats && (
      <CourseBreakdown key="course" vc={vc} courseStats={view.courseStats} />
    ),
  ];
}

/** 成績ブロック（会場・枠番の固定状況で4分岐、ADR-0063）。並びは元の4つの枠のまま */
function breakdownBlocks(t, vc, view, venueStats) {
  const { vcVenueFixed, vcBoatFixed, vcHistoryLoading, vcHistoryError } = vc;
  const settled = !vcHistoryLoading && !vcHistoryError;
  return [
    ...(!vcVenueFixed && !vcBoatFixed ? overviewBlocks(t, vc, view, venueStats) : []),
    vcVenueFixed && !vcBoatFixed && settled && (
      <CrossBoatBreakdown key="crossBoat" vc={vc} vcLabel={view.vcLabel} />
    ),
    !vcVenueFixed && vcBoatFixed && settled && (
      <CrossVenueBreakdown
        key="crossVenue"
        t={t}
        vc={vc}
        vcLabel={view.vcLabel}
      />
    ),
  ];
}

/**
 * 選手個別ページの成績・調子セクション
 * 選手調子（全国勝率推移）・平均ST・決まり手傾向・展示タイム推移・
 * 枠番別回収率をまとめて表示する。/winning-technique の同種タブと
 * 同じ指標を選手個人ページ単体でも見られるようにする。
 * データが一切無い選手（デビュー直後等）ではセクション自体を非表示にする。
 * profile/grade/newsとは別経路で取得するため、読み込み中は簡易表示にする
 *
 * フィルタ（vcVenue/vcBoat/vcGrade/vcStage、見出し直下に常時表示。ADR-0063）:
 * racerIdが確定したら常にgetRacerRaceHistoryで選手の過去2年分の出走履歴を
 * 1回取得し（racerId単位でキャッシュ）、以後の絞り込みはフロント側の純粋関数
 * （aggregateRacerVenueBoatStats/aggregateRacerCrossStats、I/O無し）で
 * メモリ上に即座に再集計する。フィルタを切り替えるたびにネットワークI/Oが
 * 発生しないようにするための設計（履歴取得自体はracerId確定時に1回のみ）。
 * 履歴ロード中・エラー時は既存props（techniqueProfile等、サーバー側事前集計）
 * をフォールバック表示する。「枠番」表示は、実際の進入コースがBOA-257の制約
 * により取得できない（course_1〜6が常に艇番と一致）ため、発走前に確定する
 * 枠番（艇番）基準にしている。同じ制約を持つ「超展開データ」タブの文言修正は
 * BOA-299として別スコープにしている。
 *
 * 会場×枠番のクロス集計（ADR-0063）: 会場・枠番のどちらかを固定したら、
 * 固定していない方を一覧化する（例: 会場だけ選んだら、その会場限定の
 * 枠番別成績を一覧表示）。両方未固定なら既存の会場別一覧・枠番別一覧、
 * 両方固定なら単一カードにする。一覧テーブルの行クリックでフィルタに反映する。
 * グレード・レース種別・レース一覧はBOA-159（docs/design/racer-stats-drilldown/）
 * で追加。決まり手・推移・レース一覧はタブ切り替えなしの常時表示（ADR-0063、
 * ADR-0062のタブ化はSuperseded）
 *
 * 会場フィルタの選択肢は全24会場（出走実績の有無に関わらず）。`todayVenueCode`
 * が渡された場合、その会場を選択肢内でマーク表示し、素早く絞り込めるバッジを
 * 表示する（BOA-159フィードバック対応、venueStats由来の実績会場のみに絞ると
 * 実績の薄い会場を選べなくなるバグがあったため）
 */

export default function RacerPerformanceStats({
  racerId,
  racerName,
  stats,
  loading,
  todayVenueCode,
  onHistoryStateChange,
}) {
  const { t } = useTranslation();
  const vc = useRacerVcState(racerId, onHistoryStateChange);
  const view = useRacerPerformanceView(t, vc, stats);
  const { vcData, vcLabel } = view;
  const { snapshotHistoryState, vcActive } = vc;
  const { formSummary, aggregatedStats, boatReturnRate, venueStats } =
    stats ?? {};

  // 見出しに選手名を入れる（「選手名 成績」の語を見出しにも出す。seo-marketer GS00）
  const heading = racerName ? (
    <>
      <span translate="no">{racerName}</span>の成績・調子
    </>
  ) : (
    "成績・調子"
  );

  if (loading) {
    return (
      <div
        className="racer-performance-stats"
        data-snapshot-history={snapshotHistoryState}
      >
        <h2>{heading}</h2>
        <p className="racer-stat-loading">読み込み中...</p>
      </div>
    );
  }

  if (!hasAnyDataOf(stats, view)) {
    return <span hidden data-snapshot-history={snapshotHistoryState} />;
  }

  return (
    <div
      id="racer-stats"
      className="racer-performance-stats"
      data-snapshot-history={snapshotHistoryState}
    >
      <h2>{heading}</h2>
      {/* ここから枠の前までは絞り込みに連動しない（全会場・全条件、または出走表・公式の値） */}
      <SummaryCards
        formSummary={formSummary}
        officialAvgSt={stats?.officialAvgSt}
        aggregatedStats={aggregatedStats}
      />
      <WinRateChart chartData={view.chartData} />
      {/* レース条件別の成績（BOA-336）。フィルタには連動しない（全会場・全条件の履歴から集計） */}
      <RacerConditionStats history={vc.vcHistoryAll} />
      <ReturnRateTable view={view} boatReturnRate={boatReturnRate} />
      {/* 絞り込みの欄と、それが効く節（会場別・枠番別の表、決まり手、推移、レース一覧）を1つの枠にまとめる */}
      <FilterScopeFrame>
        <VcFilterBar
          t={t}
          vc={vc}
          vcData={vcData}
          vcLabel={vcLabel}
          todayVenueCode={todayVenueCode}
        />
        {vc.vcHistoryLoading && <p className="racer-stat-note">集計中…</p>}
        <VcHistoryError vc={vc} />
        {breakdownBlocks(t, vc, view, venueStats)}
        <BothFixedNoRuns vc={vc} vcData={vcData} vcLabel={vcLabel} />
        <VcCards vc={vc} vcData={vcData} />
        {view.showTechniqueSection && (
          <TechniqueSection view={view} vcActive={vcActive} vcLabel={vcLabel} />
        )}
        {view.hasVcData && vcData.series.length === 0 && (
          <p className="racer-stat-note">
            推移を表示するにはデータが不足しています
          </p>
        )}
        <ExhibitionChart view={view} vcActive={vcActive} vcLabel={vcLabel} />
        <StTrendChart view={view} vcActive={vcActive} vcLabel={vcLabel} />
        <div id="racer-race-list">
          <RaceList vc={vc} view={view} vcLabel={vcLabel} />
        </div>
      </FilterScopeFrame>
      <p className="racer-analysis-tools-link">
        <Link to="/winning-technique?tab=techprofile">
          データ分析ツールで本日開催中の会場・レース単位の傾向も見る →
        </Link>
      </p>
    </div>
  );
}
