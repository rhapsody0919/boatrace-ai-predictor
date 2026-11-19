/** MotorConditionChart のドリルダウンの節（優勝・推移・使用履歴・部品交換）（MotorConditionChart.jsx から本文を字のまま移した） */
import { useTranslation } from "react-i18next";
import RacerGradeBadge from "../racer/RacerGradeBadge";
import TrendLineChart from "./TrendLineChart";
import InlineFetchError from "../InlineFetchError";
import { getTodayJST } from "../../utils/dateUtils";
import { translatePartName } from "../race/raceIndicators";

export function ChampionshipHistorySection({ championshipHistory }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 className="selected-motor-heading">
        {t("analysis.motor.championshipHistoryHeading")}
      </h3>
      {championshipHistory.wins.length > 0 ? (
        <ul className="history-list">
          {championshipHistory.wins.map((win) => (
            <li key={win.raceId}>
              <span className="history-date">{win.date}</span>
              <span translate="no" className="usage-history-player">
                {win.playerName?.replace(/\s+/g, "")}
              </span>
            </li>
          ))}
        </ul>
      ) : championshipHistory.fetchFailed ? (
        <InlineFetchError />
      ) : (
        <div className="empty-state">
          {championshipHistory.generationStart === null
            ? t("analysis.motor.championshipHistoryUnknownGeneration")
            : t("analysis.motor.championshipHistoryEmpty")}
        </div>
      )}
      <p className="table-note">
        {t("analysis.motor.championshipHistoryNote")}
      </p>
    </>
  );
}

export function RateTrendSection({ chartData, trendData, drillTallyState, firstRatedIndex, emptyKey }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 className="selected-motor-heading">
        {t("analysis.motor.rateTrendHeading")}
      </h3>
      {chartData.length > 0 ? (
        <TrendLineChart
          data={chartData}
          yAxisLabel={t("analysis.motor.yAxis")}
          tooltipFormatter={(value) => `${value.toFixed(1)}%`}
          series={[
            {
              dataKey: "motor_2rate",
              name: t("analysis.motor.legend2"),
              stroke: "var(--brand-accent-primary)",
              type: "stepAfter",
            },
            {
              dataKey: "motor_3rate",
              name: t("analysis.motor.legend3"),
              stroke: "var(--brand-accent-secondary)",
              type: "stepAfter",
            },
          ]}
        />
      ) : (
        <div className="empty-state">
          {(trendData?.trend ?? []).length === 0
            ? t(emptyKey("analysis.motor.trendEmpty"))
            : drillTallyState === "pending"
              ? t("analysis.motor.trendNotYetOfficial")
              : t("analysis.motor.trendOfficialZeroUnknown")}
        </div>
      )}
      {/* 先頭の 0 を落としたとき、下の展示タイムのグラフと始まりの日がずれる理由 */}
      {firstRatedIndex > 0 && (
        <p className="table-note">{t("analysis.motor.trendStartNote")}</p>
      )}
    </>
  );
}

export function ExhibitionTrendSection({ exhibitionChartData, exhibitionAxis, emptyKey }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 className="selected-motor-heading">
        {t("analysis.motor.exhibitionTrendHeading")}
      </h3>
      {exhibitionChartData.length > 0 ? (
        <TrendLineChart
          data={exhibitionChartData}
          yAxisLabel={t("analysis.motor.exhibitionYAxis")}
          yTickDecimals={2}
          yAxisDomain={exhibitionAxis?.domain}
          yTicks={exhibitionAxis?.ticks}
          // 速い（小さい）ほど上。素の向きだと「線が上がった＝良くなった」と
          // 逆に読まれる（race-detail-ui-unify FR-5、今節タブのスパークラインと同じ向き）
          yReversed
          tooltipFormatter={(value) => value.toFixed(2)}
          series={[
            {
              dataKey: "exhibition_time",
              name: t("analysis.motor.exhibitionLegend"),
              stroke: "var(--brand-accent-primary)",
              // 点はレースごとの別々の値。曲線だと間に値があるように見える
              type: "linear",
            },
          ]}
        />
      ) : (
        <div className="empty-state">
          {t(emptyKey("analysis.motor.exhibitionTrendEmpty"))}
        </div>
      )}
      <p className="table-note">
        {t("analysis.motor.exhibitionTrendNote")}
      </p>
    </>
  );
}

export function UsageHistorySection({ usageHistory, usageHistoryChartData, emptyKey }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 className="selected-motor-heading">
        {t("analysis.motor.usageHistoryHeading")}
      </h3>
      {usageHistoryChartData.length > 1 && (
        <TrendLineChart
          data={usageHistoryChartData}
          yAxisLabel={t("analysis.motor.yAxis")}
          slantXLabels
          tooltipFormatter={(value) => `${value.toFixed(1)}%`}
          series={[
            {
              dataKey: "rate2",
              name: t("analysis.motor.legend2"),
              stroke: "var(--brand-accent-primary)",
              // 点は選手（節）ごとの別々の値。曲線でつなぐと間に値があるように
              // 見えるので直線にする（BOA-557）
              type: "linear",
            },
            {
              dataKey: "rate3",
              name: t("analysis.motor.legend3"),
              stroke: "var(--brand-accent-secondary)",
              type: "linear",
            },
          ]}
        />
      )}
      {usageHistory.length > 0 ? (
        <ul className="history-list">
          {usageHistory.map((meet, i) => (
            <li key={`${meet.racerId}-${meet.firstDate}-${i}`}>
              <span className="history-date">
                {meet.firstDate}
                {meet.firstDate !== meet.lastDate && `〜${meet.lastDate}`}
              </span>
              <span translate="no" className="usage-history-player">
                {meet.playerName?.replace(/\s+/g, "")}
              </span>
              <RacerGradeBadge grade={meet.grade} />
              {meet.rate2 !== null && (
                <span className="usage-history-rate">
                  {t("analysis.motor.legend2")} {meet.rate2.toFixed(1)}%
                </span>
              )}
              <span className="usage-history-ranks">
                {meet.races
                  .map((r) =>
                    r.rank !== null
                      ? t("analysis.motor.usageHistoryRank", {
                          n: r.rank,
                        })
                      : // 今日これから走るレースは「未」。欠場・失格等の「-」と区別する
                        r.date >= getTodayJST()
                        ? t("analysis.motor.usageHistoryNotRun")
                        : "-",
                  )
                  .join(" ")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          {t(emptyKey("analysis.motor.usageHistoryEmpty"))}
        </div>
      )}
      <p className="table-note">
        {t("analysis.motor.usageHistoryNote")}
        {/* グラフの向きの説明は、グラフが出ているとき（2節以上）だけ（BOA-557） */}
        {usageHistoryChartData.length > 1 &&
          ` ${t("analysis.motor.usageHistoryChartNote")}`}
      </p>
    </>
  );
}

export function PartsHistorySection({ partsHistory }) {
  const { t } = useTranslation();
  return (
    <>
      <h3 className="selected-motor-heading">
        {t("analysis.motor.partsHistoryHeading")}
      </h3>
      {partsHistory.length > 0 ? (
        <ul className="history-list">
          {partsHistory.map((event, i) => (
            <li key={`${event.date}-${i}`}>
              <span className="history-date">
                {event.date}
                {/* 何Rの展示で記録された交換か（そのレースの前の交換）。
                    同じ日に複数のレースがある（BOA-513、ファン4人のパネル） */}
                {event.raceNos?.length > 0 &&
                  ` ${event.raceNos.map((n) => `${n}R`).join(t("listSeparator"))}`}
              </span>
              <span className="parts-history-items">
                {event.parts && event.parts.length > 0 && (
                  <span className="parts-history-tag">
                    {event.parts
                      .map((part) => translatePartName(t, part))
                      .join(t("listSeparator"))}
                  </span>
                )}
                {event.propellerChanged && (
                  <span className="parts-history-tag">
                    {t("analysis.motor.propellerChanged")}
                  </span>
                )}
              </span>
              {event.interpretation && (
                <span
                  className={`parts-history-badge parts-history-badge-${event.interpretation}`}
                >
                  {t(
                    `analysis.motor.partsInterpretation.${event.interpretation}`,
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          {t("analysis.motor.partsHistoryEmpty")}
        </div>
      )}
      <p className="table-note">{t("analysis.motor.partsHistoryNote")}</p>
    </>
  );
}
