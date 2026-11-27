import { formatPercent, slashDate } from "../../utils/formatters";
import RacerOfficialStatsChart from "./RacerOfficialStatsChart";

// 選手ページの成績・調子（RacerPerformanceStats）のカード（選手調子・平均ST・会場×枠番の固定時）と勝率の推移

function FormCard({ formSummary }) {
  return (
    <div className="racer-stat-card">
      <h3>選手調子（全国勝率）</h3>
      <div className="racer-stat-value-row">
        <span className="racer-stat-value">
          {formSummary.current_win_rate?.toFixed(2)}
        </span>
        {formSummary.delta !== null && (
          <span
            className={`racer-stat-delta ${
              formSummary.delta > 0
                ? "racer-stat-delta-up"
                : formSummary.delta < 0
                  ? "racer-stat-delta-down"
                  : ""
            }`}
          >
            {formSummary.delta > 0 ? "↑" : formSummary.delta < 0 ? "↓" : "→"}{" "}
            {Math.abs(formSummary.delta).toFixed(2)}
          </span>
        )}
      </div>
      <p className="racer-stat-note">
        約90日前:{" "}
        {formSummary.past_win_rate !== null
          ? formSummary.past_win_rate.toFixed(2)
          : "データなし"}
      </p>
    </div>
  );
}

function AvgStCard({ officialAvgSt, aggregatedStats }) {
  return (
    <div className="racer-stat-card">
      {/* 全会場・全条件の値で、上の絞り込みには連動しない（連動すると「桐生での平均ST」と
          読まれていた、BOA-583）。絞り込み後の平均STは下の表。
          データ出走表と同じ二本立て（BOA-815）: 主は公式の出走表と同じ値（2桁）、注記に直近30走 */}
      <h3>平均ST（公式）</h3>
      <div className="racer-stat-value-row">
        <span className="racer-stat-value">
          {officialAvgSt?.avgSt != null ? officialAvgSt.avgSt.toFixed(2) : "—"}
        </span>
        {aggregatedStats?.flying_rate > 0 && (
          <span className="racer-stat-sub">
            {/* 期間と走数を添える。公式の期別成績（その期の F の回数）と別の集計だと分かるように（ファン評価 GS00 3周目） */}
            F率 {(aggregatedStats.flying_rate * 100).toFixed(1)}%
            （当サイト集計・2025年12月以降
            {aggregatedStats.total_races > 0
              ? `・${aggregatedStats.total_races}走`
              : ""}
            ）
          </span>
        )}
      </div>
      <p className="racer-stat-note">
        {officialAvgSt?.period
          ? `${slashDate(officialAvgSt.period.calcFrom)}〜${slashDate(officialAvgSt.period.calcTo)} の公式の期別成績・全会場（「選手調子（全国勝率）」は出走表の値で、集計の期間が違います）`
          : "公式の期別成績・全会場"}
      </p>
      <p className="racer-stat-note">
        直近30走:{" "}
        {aggregatedStats?.avg_st_last_30 != null
          ? Number(aggregatedStats.avg_st_last_30).toFixed(3)
          : "—"}
        （F・Lを除く。龍神ソナー・思考アシストと同じ考え方）
      </p>
    </div>
  );
}

/** 選手調子と平均ST（公式）のカード */
export function SummaryCards({ formSummary, officialAvgSt, aggregatedStats }) {
  return (
    <div className="racer-stat-cards-grid">
      {formSummary && <FormCard formSummary={formSummary} />}

      {(officialAvgSt?.avgSt != null ||
        aggregatedStats?.avg_st_last_30 != null) && (
        <AvgStCard
          officialAvgSt={officialAvgSt}
          aggregatedStats={aggregatedStats}
        />
      )}
    </div>
  );
}

/**
 * 勝率の推移（公式の期ごと）。全国勝率を期ごとの段で描く（オーナー 2026-11-27「期ごとの段に1つ」）。前は出走表の
 * 全国勝率を日ごとに並べた折れ線（直近約90日、ほぼ平ら）と、公式成績の欄の期別の折れ線の2本があった。
 * 当地勝率は出さない（節ごとに会場が変わる値で、線でつなぐと会場の切り替わりが調子の上下に見える。number-scope.md §5）。
 * 縦軸は winRateAxis で値の幅に合わせ、整数の等間隔（design-system.md、BOA-1196）
 */
export function WinRateChart({ steps }) {
  if (!(steps.chartData.length > 0)) return null;
  return (
    <div className="racer-stat-chart">
      <h3>勝率の推移（公式の期ごと）</h3>
      <RacerOfficialStatsChart
        chartData={steps.chartData}
        rateAxis={steps.rateAxis}
      />
    </div>
  );
}

function VcCard({ title, value, note }) {
  return (
    <div className="racer-stat-card">
      <h3>{title}</h3>
      <span className="racer-stat-value">{value}</span>
      <p className="racer-stat-note">{note}</p>
    </div>
  );
}

const rateOrDash = (v) => (v !== null ? formatPercent(v) : "-");
const returnOrDash = (v) => (v !== null ? `${v.toFixed(0)}%` : "-");

/** 会場・枠番を両方固定したときの7枚のカード */
export function VcCards({ vc, vcData }) {
  if (!(vc.vcVenueFixed && vc.vcBoatFixed && vcData && vcData.n > 0))
    return null;
  return (
    <div className="racer-stat-cards-grid racer-vc-cards-grid">
      <VcCard
        title="1着率"
        value={rateOrDash(vcData.winRate)}
        note={
          <>
            {vcData.win}回/{vcData.n}回
          </>
        }
      />
      <VcCard
        title="2連率"
        value={rateOrDash(vcData.top2Rate)}
        note={
          <>
            {vcData.top2}回/{vcData.n}回
          </>
        }
      />
      <VcCard
        title="3連率"
        value={rateOrDash(vcData.top3Rate)}
        note={
          <>
            {vcData.top3}回/{vcData.n}回
          </>
        }
      />
      <VcCard
        title="単勝回収率"
        value={returnOrDash(vcData.returnRate)}
        note={<>{vcData.n}回</>}
      />
      <VcCard
        title="複勝回収率"
        value={returnOrDash(vcData.placeReturnRate)}
        note={<>{vcData.n}回</>}
      />
      {/* 上の平均STカード（0.175）と桁をそろえる（BOA-624） */}
      <VcCard
        title="平均ST"
        value={vcData.avgSt !== null ? vcData.avgSt.toFixed(3) : "-"}
        note={<>{vcData.stN}回</>}
      />
      <VcCard
        title="平均展示タイム"
        value={
          vcData.avgExhibitionTime !== null
            ? vcData.avgExhibitionTime.toFixed(2)
            : "-"
        }
        note={<>{vcData.exN}回</>}
      />
    </div>
  );
}
