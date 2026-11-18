/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getMotorGenerationStart } from "../../services/motorQueries.js";
import {
  getMotorPowerIndex,
  getMotorUsageHistory,
} from "../../services/motorQueries2.js";
import {
  getRaceMotorBreakdown,
  getVenueMotorChampionshipHistory,
  getVenueMotorStats,
} from "../../services/motorQueries3.js";
import {
  getVenueMotorRanking,
  getVenueMotorRanks,
} from "../../services/motorQueries4.js";
import {
  getMotorConditionTrend,
  getMotorRacerWakuStats,
  getMotorWakuStats,
} from "../../services/motorQueries5.js";
import { getMotorPartsHistory } from "../../services/motorQueries6.js";
import { STADIUM_NAMES as VENUE_NAMES } from "../../constants";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import RacerGradeBadge from "../racer/RacerGradeBadge";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import MotorRecordStatCards from "../MotorRecordStatCards";
import TrendLineChart from "./TrendLineChart";
import { exhibitionTimeAxis } from "../../utils/chartDomain";
import DrillDownHeader from "./DrillDownHeader";
import MotorWakuStatsGrid from "./MotorWakuStatsGrid";
import MotorRacerWakuDrillDown from "./MotorRacerWakuDrillDown";
import InlineFetchError from "../InlineFetchError";
import { SMALL_SAMPLE_THRESHOLD } from "../../pure/basicInfoStats.js";
import { formatPowerIndex, powerIndexTone } from "../../utils/smallSampleRate";
import { getTodayJST } from "../../utils/dateUtils";
import {
  formatGenerationDate,
  isClippedByGeneration,
  isVenueRankSnapshotBeforeGeneration,
  officialTallyState,
} from "../../utils/motorGeneration";
import { motorRateView, motorRate3View } from "../../utils/motorFreshRate";
import { translatePartName } from "../race/raceIndicators";
import RateBar from "../common/RateBar";
import { BOAT_COLORS, BOAT_LINE_COLORS } from "../../utils/colors";
import { countMeetPartsChanges } from "../../utils/motorMeetParts";
import { bestOf } from "../../utils/bestOf";
import {
  computePeriodClip,
  computeRankClasses,
  computeRateView as computeMotorRateView,
  computeStatColumns as computeMotorStatColumns,
  exhibitionChartDataOf,
} from "../../pure/motorChartView.js";
import "./MotorConditionChart.css";
import "../common/HorizontalScrollHint.css";

// 機力指数の色（小標本は枠番別成績と同じ参考値の色。BOA-549）
const POWER_INDEX_TONE_CLASS = {
  good: "power-index-good",
  bad: "power-index-bad",
  small: "is-small-sample",
};

function MotorListHead({ firstMeet, showVenueRank, officialMode, periodDays, hasPretest, showFirstPlaceRate, showFinalCount, showChampionshipCount }) {
  const { t } = useTranslation();
  return (
    <thead>
      <tr>
        <th>{t("analysis.laneHeader")}</th>
        <th>{t("table.playerName")}</th>
        <th>{t("analysis.motor.motorNumberShortHeader")}</th>
        {/* 公式2連率（節時点、棒）と会場内順位を、機番のすぐ右に置く（BOA-428、
        ユーザー承認のモック）。375px で左から5列が最初の画面に入り、6基の強さの
        差と会場の中での位置が、横に送らずに読める。以前（BOA-451）は再計算した
        2連率を先に置き、公式2連率をそのすぐ右にしていた。再計算した2連率は
        消さずに会場内順位の右へ移す（見比べられる位置は保つ）。過去レースは
        2連率の列そのものが公式値なので、その列を棒にし、再計算の列は無い */}
        {/* 過去レースもこの列は出走表時点の公式値なので、見出しは同じ（承認済みのモック） */}
        {/* 最初の開催は全艇が自前の値なので「公式」を外す（BOA-830、2026-10-11 ユーザー決定） */}
        <th className="motor-wrap-head">
          {t(
            firstMeet
              ? "analysis.motor.freshRate2Header"
              : "analysis.motor.officialRate2Header",
          )}
        </th>
        {showVenueRank && (
          <th className="motor-wrap-head motor-venue-rank-head">
            {t("analysis.motor.venueRankHeader")}
          </th>
        )}
        {/* 期間で集計した2連率。公式2連率と並ぶので、見出しに期間を書く（ファン評価） */}
        {!officialMode && (
          <th>
            {t("analysis.motor.rate2PeriodHeader", {
              period: t(
                periodDays === 30
                  ? "analysis.motor.period30"
                  : "analysis.motor.period90",
              ),
            })}
          </th>
        )}
        {/* 当日のレースの3連率も期間の再計算なので、2連率と同じく期間を書く。
            書かないと公式の3連率と読み違える（ファン評価2周目） */}
        <th>
          {officialMode
            ? t("analysis.motor.rate3Header")
            : t("analysis.motor.rate3PeriodHeader", {
                period: t(
                  periodDays === 30
                    ? "analysis.motor.period30"
                    : "analysis.motor.period90",
                ),
              })}
        </th>
        {hasPretest && (
          <th>{t("analysis.motor.pretestTimeHeader")}</th>
        )}
        {showFirstPlaceRate && (
          <th>{t("analysis.motor.firstPlaceRateHeader")}</th>
        )}
        <th>{t("analysis.motor.powerIndexHeader")}</th>
        {showFinalCount && (
          <th>{t("analysis.motor.finalCountHeader")}</th>
        )}
        {showChampionshipCount && (
          <th>{t("analysis.motor.championshipCountHeader")}</th>
        )}
      </tr>
    </thead>
  );
}

function ChampionshipHistorySection({ championshipHistory }) {
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

function RateTrendSection({ chartData, trendData, drillTallyState, firstRatedIndex, emptyKey }) {
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

function ExhibitionTrendSection({ exhibitionChartData, exhibitionAxis, emptyKey }) {
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

function UsageHistorySection({ usageHistory, usageHistoryChartData, emptyKey }) {
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

function PartsHistorySection({ partsHistory }) {
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

function MotorNumCell({ row, currentParts, partsBoat, setPartsBoat }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 見出しが「機番」なので数字だけ（BOA-428、承認済みのモック。375px で棒と
          会場内順位を最初の画面に入れるため「◯号機」を詰めた） */}
      <td className="motor-num">
        {row.motor_number}
        {(() => {
          const parts = currentParts.find((item) => item.boat === row.boat_number);
          return parts && !parts.failed && !parts.unavailable ? (
            <button type="button" className="mcc-parts-badge"
              aria-expanded={partsBoat === row.boat_number}
              aria-controls="mcc-parts-names"
              onClick={(event) => {
                event.stopPropagation();
                setPartsBoat(partsBoat === row.boat_number ? null : row.boat_number);
              }}>
              {t("analysis.motor.partsCountBadge", { n: parts.count })}
            </button>
          ) : null;
        })()}
      </td>
    </>
  );
}

function RateBarCell({ row, i, view, explainBoat, setExplainBoat }) {
  const { t } = useTranslation();
  const { officialRates, officialRateMax, officialRateBestBoats, rateViews, rateLabel } = view;
  return (
    <>
      {/* 連対率は**小数1桁**で出す（BOA-474、2026-09-28）。
        `official_2rate`（`race_entries.motor_2rate`）は、同じ節・同じ
        モーターでもレースによって桁数が違う。出走表の行は二段階で埋まり、
        前夜の初期投入（番組表＝Bファイル由来）は**1桁**、発走60分前ごろの
        出走表更新が**2桁**に上書きするため、当日のまだ更新が走っていない
        レースだけが1桁のまま残る（実測: 2026-09-28 戸田の12R=54.8 /
        6R=54.84、同じ21号機・同じ節・同じ瞬間）。2桁で出すと同じモーターが
        レースによって 54.80 と 54.84 に見える。1桁に揃えると
        **9月の節内不一致748件のうち691件（92.4%）が消える**
        （残りは連続開催の節境界で、桁の問題ではない）。
        基本情報タブのデータ出走表も同じ値を `toFixed(1)` で出しており、
        ボートレース日和も1桁。再計算した2連率/3連率も、母数が数十走で
        2桁目に意味が無いため揃える */}
      <td className="motor-rate-bar-cell">
        <RateBar
          value={officialRates[i]}
          max={officialRateMax}
          // 線用の艇色（1号艇・2号艇はテーマで反転するトークン）。ダークモードで
          // 2号艇の黒い棒が紺の背景に溶けていた（ファン評価）
          fill={BOAT_LINE_COLORS[row.boat_number]}
          best={officialRateBestBoats.has(row.boat_number)}
          label={
            rateViews[i].kind === "own" ? (
              <>
                {rateLabel(rateViews[i], i)}
                {/* 自前の値の印。押すと表の下に出どころを出す（行の
                    ドリルダウンは開かない） */}
                <button
                  type="button"
                  className="motor-fresh-own-mark"
                  aria-expanded={explainBoat === row.boat_number}
                  aria-label={t(
                    "analysis.motor.freshOwnExplain",
                    { n: rateViews[i].runs },
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExplainBoat((b) =>
                      b === row.boat_number
                        ? null
                        : row.boat_number,
                    );
                  }}
                >
                  {t("analysis.motor.freshOwnMark")}
                </button>
              </>
            ) : (
              rateLabel(rateViews[i], i)
            )
          }
        />
        {/* 入れ替えから90日以内の公式の値は、何走で出た数字かを添える（BOA-830） */}
        {rateViews[i].kind === "official" &&
          rateViews[i].priorRuns !== null && (
            <span className="motor-waku-n motor-fresh-prior-runs">
              {t("analysis.motor.freshPriorRuns", {
                n: rateViews[i].priorRuns,
              })}
            </span>
          )}
      </td>
    </>
  );
}

function MotorPeriodRateCells({ row, view }) {
  const { t } = useTranslation();
  const { officialMode, hasPretest } = view;
  return (
    <>
      {!officialMode && (
        <td className="rate">
          {row.motor_2rate?.toFixed(1)}
          {/* このレースより前に結果の出た走が無い新モーター（当日の
              レースのみ判定できる）。公式の 0.0 は消さずに添える
              （BOA-513、ファン4人のパネル） */}
          {row.sample_count === 0 && (
            <span className="motor-waku-n motor-first-use">
              {t("analysis.motor.firstUseBadge")}
            </span>
          )}
        </td>
      )}
      <td className="rate">
        {/* 過去レースは3連率も公式値。2連率を自前にした艇は3連率も自前にそろえる。
            2連率だけ差し替えると、3連率の 0.0 を「3着以内が一度も無い」と読まれる
            （BOA-830。当日のレースは期間の再計算なのでそのまま） */}
        {officialMode
          ? (() => {
              const v3 = motorRate3View(row);
              if (v3.kind === "notRun") return "-";
              return v3.value === null
                ? "-"
                : v3.value.toFixed(1);
            })()
          : row.motor_3rate?.toFixed(1)}
      </td>
      {hasPretest && (
        <td className="rate motor-pretest-cell">
          {row.pretest_time !== null &&
          row.pretest_time !== undefined ? (
            <>
              {Number(row.pretest_time).toFixed(2)}
              {row.pretest_rank ? (
                <span className="motor-waku-n">
                  {t("analysis.motor.pretestRank", {
                    rank: row.pretest_rank,
                  })}
                </span>
              ) : null}
            </>
          ) : (
            "-"
          )}
        </td>
      )}
    </>
  );
}

function MotorVenueStatCells({ row, i, view }) {
  const { showFirstPlaceRate, showFinalCount, showChampionshipCount, firstPlaceRates, firstPlaceRateRankClass, finalCountRankClass, championshipCountRankClass, venueStatsFailedCell, listPowerIndex, firstMeet } = view;
  return (
    <>
      {showFirstPlaceRate && (
        <td
          className={`rate ${firstPlaceRateRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstPlaceRates[i] !== null
            ? `${firstPlaceRates[i].toFixed(1)}%`
            : "-"}
        </td>
      )}
      <td
        className={`rate power-index ${
          POWER_INDEX_TONE_CLASS[
            powerIndexTone(
              listPowerIndex(row).value,
              listPowerIndex(row).n,
              SMALL_SAMPLE_THRESHOLD,
            )
          ] ?? ""
        }`}
      >
        {listPowerIndex(row).value !== null
          ? formatPowerIndex(listPowerIndex(row).value)
          : "-"}
      </td>
      {showFinalCount && (
        <td
          className={`rate ${finalCountRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstMeet
              ? "-"
              : (row.final_count ?? "-")}
        </td>
      )}
      {showChampionshipCount && (
        <td
          className={`rate ${championshipCountRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstMeet
              ? "-"
              : (row.championship_count ?? "-")}
        </td>
      )}
    </>
  );
}

function MotorListRow({ row, i, view, focusedBoat, setDrillDownMotor, onFocusBoat, currentParts, partsBoat, setPartsBoat, explainBoat, setExplainBoat }) {
  const { showVenueRank, venueRankCell } = view;
  return (
    <tr
      className={[
        "motor-ranking-row",
        // 他のタブで選んだ艇は、一覧のまま行で示す（ドリルダウンは
        // 自動で開かない。一覧が主役で、初回の表示を変えない。BOA-494 案A）
        row.boat_number === focusedBoat ? "is-focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        setDrillDownMotor(row.motor_number);
        // 行を押したら、他のタブにもその艇の選択を引き継ぐ
        onFocusBoat?.(row.boat_number);
      }}
    >
      {/* 枠は艇色のチップ（承認済みのモック。結果タブの .rr-boat-chip と同じ） */}
      <td className="rank">
        <span
          className="rr-boat-chip"
          style={{
            background: BOAT_COLORS[row.boat_number]?.bg,
            color: BOAT_COLORS[row.boat_number]?.text,
          }}
        >
          {row.boat_number}
        </span>
      </td>
      <td translate="no">
        {row.player_name?.replace(/\s+/g, "")}
      </td>
      <MotorNumCell row={row} currentParts={currentParts} partsBoat={partsBoat} setPartsBoat={setPartsBoat} />
      <RateBarCell row={row} i={i} view={view} explainBoat={explainBoat} setExplainBoat={setExplainBoat} />
      {showVenueRank && (
        <td className="motor-venue-rank">
          {venueRankCell(row.motor_number)}
        </td>
      )}
      <MotorPeriodRateCells row={row} view={view} />
      <MotorVenueStatCells row={row} i={i} view={view} />
    </tr>
  );
}

function MotorPartsNotes({ expandedParts, currentParts }) {
  const { t } = useTranslation();
  return (
    <>
      {expandedParts && (
        <p id="mcc-parts-names" className="table-note mcc-parts-names">
          {expandedParts.parts.map((part) => translatePartName(t, part)).join("、")}
        </p>
      )}
      <p className="table-note mcc-parts-note">{t("analysis.motor.partsCountNote")}</p>
      {currentParts.some((row) => row.failed) && (
        <div className="mcc-parts-error"><InlineFetchError /></div>
      )}
    </>
  );
}

function OwnRateNote({ rateViews, explainView, explainRow }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 「※」の数字の出どころ（BOA-830）。押した艇の説明を出す。押す前は押せることだけ書く */}
      {rateViews.some((v) => v.kind === "own") && (
        <p className="table-note motor-fresh-own-note">
          {explainView?.kind === "own"
            ? t("analysis.motor.freshOwnExplainBoat", {
                boat: explainRow.boat_number,
                explain: t("analysis.motor.freshOwnExplain", {
                  n: explainView.runs,
                }),
              })
            : t("analysis.motor.freshOwnHint")}
        </p>
      )}
    </>
  );
}

function VenueRankNote({ breakdown, venueRanks, selectedVenue }) {
  const { t } = useTranslation();
  return (
    <>
      {/* BOA-451 / ADR-0067: 生値をそのまま出す列（前検タイム・公式2連率）
        の出典を表のすぐ下に1回だけ置く。集計・加工した列（期間別の
        2連率/3連率・機力指数）は当社の計算なので出典の対象外。
        横スクロールの枠（右端のフェード）の外に置く。枠の中だと375pxで
        各行の末尾がフェードに隠れて読めない（2026-09-29 ファン評価） */}
      {/* 会場内順位の出どころ（BOA-428）。棒は BOATRACE 公式の2連率、順位は会場公式サイトの
          2連率で、出どころが違う（2026-10-02 ユーザー判断で注記の形）。日付は「取得日」と書く。
          会場によっては節ごとにしか中身が変わらず、取得日をデータの時点と読ませないため */}
      {breakdown.length > 0 && (
        <p className="table-note motor-venue-rank-note">
          {venueRanks?.state === "ok" && (
            <>
              {/* 日付は、会場サイトの集計の締め日があればそれ（「9/18 締め」）、無ければ取得日 */}
              {t(
                venueRanks.periodEnd
                  ? "analysis.motor.venueRankSourceNotePeriodEnd"
                  : "analysis.motor.venueRankSourceNote",
                {
                  venue: t(
                    `venues.${selectedVenue}`,
                    VENUE_NAMES[selectedVenue] || String(selectedVenue),
                  ),
                  date: (venueRanks.periodEnd ?? venueRanks.scrapedDate)
                    .replaceAll("-", "/")
                    .replace(/\/0(\d)/g, "/$1"),
                },
              )}
              <br />
            </>
          )}
          {/* 選手の実力が混ざる注意は、会場内順位の有無にかかわらず出す（ファン評価） */}
          {t("analysis.motor.barScaleNote")}
          {t("analysis.motor.motorRiderMixNote")}
        </p>
      )}
    </>
  );
}

function OfficialSourceNote({ breakdown, officialMode, listPowerIndex, venueColsLabel }) {
  const { t } = useTranslation();
  return (
    <>
      {officialMode
        ? t(
            // 自前の値（公式 0 の艇・機力指数）を出している過去レース（BOA-830）
            breakdown.some((r) => r.generation_runs != null)
              ? "analysis.motor.officialModeSourceNoteFresh"
              : "analysis.motor.officialModeSourceNote",
          )
        : t("analysis.motor.officialSourceNote")}
      {/* 会場公式サイト由来の列（1着率・優出数・優勝数）は、表に出ているものだけを
          挙げる。1つも無い会場（戸田など）では文ごと出さない（BOA-513。列名が空の
          まま「…の値、はそのレース日以前…」と文が崩れるのを防ぐ） */}
      {/* 一覧のオレンジ色の機力指数の意味（6走未満の参考値）。該当する行が
          あるときだけ書く（2026-09-29 ファン評価） */}
      {breakdown.some(
        (r) =>
          powerIndexTone(
            listPowerIndex(r).value,
            listPowerIndex(r).n,
            SMALL_SAMPLE_THRESHOLD,
          ) === "small",
      ) &&
        t("analysis.motor.powerIndexSmallSampleNote", {
          n: SMALL_SAMPLE_THRESHOLD,
        })}
      {venueColsLabel &&
        `${t(
          officialMode
            ? "analysis.motor.venueColsPastNote"
            : "analysis.motor.venueColsTodayNote",
          { venueCols: venueColsLabel },
        )}`}
    </>
  );
}

// 画面の state と ref（呼ぶ順は元の MotorConditionChart の本体と同じ）
function useMotorStates(initialMotorNumber) {
  const [breakdown, setBreakdown] = useState([]);
  const [meetParts, setMeetParts] = useState(null);
  const [partsBoat, setPartsBoat] = useState(null);

  // 新しいモーターの最初の開催か等（BOA-830）。{ generationStart, firstMeet }
  const [freshness, setFreshness] = useState(null);
  // 「※」を押した艇（自前の2連率の出どころを表の下に出す。BOA-830）
  const [explainBoat, setExplainBoat] = useState(null);
  const [drillDownMotor, setDrillDownMotor] = useState(null);
  const [trendData, setTrendData] = useState(null);

  const [powerIndex, setPowerIndex] = useState(null);
  const [usageHistory, setUsageHistory] = useState([]);
  const [partsHistory, setPartsHistory] = useState([]);
  const [venueMotorStats, setVenueMotorStats] = useState(null);
  // generationStart: 現行モーターの使用開始日（不明ならnull）。wins: その日以降の優勝
  const [championshipHistory, setChampionshipHistory] = useState({
    generationStart: null,
    wins: [],
  });
  // BOA-301: 会場内順位(FR-1)・枠番別成績(FR-2/3)・選手×枠成績(FR-4)
  const [venueMotorRanking, setVenueMotorRanking] = useState(null);
  // FR-2〜4は現行モーターの世代で集計する。generationStart: 使用開始日（不明ならnull）
  const [motorWakuStats, setMotorWakuStats] = useState({
    generationStart: null,
    rows: [],
  });
  const [motorRacerWakuStats, setMotorRacerWakuStats] = useState({
    generationStart: null,
    rows: [],
  });
  const [selectedWakuCourse, setSelectedWakuCourse] = useState(null);
  // 過去レースで、そのレースのモーターが入れ替え前（現行世代より前）か。
  // 今の同じ番号のモーターとは別物なので、ドリルダウンの中身を出さない（BOA-329）
  const [drillPreGeneration, setDrillPreGeneration] = useState(false);
  // 選択中のレース自体が入れ替え前（過去レースで、レース日 < 使用開始日）か。
  // 一覧の時点で伝え、行を押しても推移が出ないことを先に知らせる
  const [racePreGeneration, setRacePreGeneration] = useState(false);
  // 6基の会場内順位（会場公式サイトの2連率、BOA-428）。{state: "ok"|"empty"|"error"}。
  // null は取得中（列はまだ出さない）
  const [venueRanks, setVenueRanks] = useState(null);
  // 会場の現行モーターの使用開始日（BOATCAST bc_mst）。当日のレースで画面に出す
  // （2026-09-29 ユーザー判断 B、ADR-0067 の 2026-09-28 追記の改訂）
  const [generationStart, setGenerationStart] = useState(null);
  const [periodDays, setPeriodDays] = useState(90);
  const pendingInitialMotorNumber = useRef(initialMotorNumber);
  // レース/会場が変わった時だけドリルダウンをリセットする（期間トグルだけの
  // 変更でドリルダウン中の画面が一覧に戻されてしまわないようにするため）
  const lastRaceVenueRef = useRef(null);
  return {
    breakdown, setBreakdown, meetParts, setMeetParts, partsBoat, setPartsBoat,
    freshness, setFreshness, explainBoat, setExplainBoat,
    drillDownMotor, setDrillDownMotor, trendData, setTrendData,
    powerIndex, setPowerIndex, usageHistory, setUsageHistory,
    partsHistory, setPartsHistory, venueMotorStats, setVenueMotorStats,
    championshipHistory, setChampionshipHistory,
    venueMotorRanking, setVenueMotorRanking, motorWakuStats, setMotorWakuStats,
    motorRacerWakuStats, setMotorRacerWakuStats,
    selectedWakuCourse, setSelectedWakuCourse,
    drillPreGeneration, setDrillPreGeneration,
    racePreGeneration, setRacePreGeneration, venueRanks, setVenueRanks,
    generationStart, setGenerationStart, periodDays, setPeriodDays,
    pendingInitialMotorNumber, lastRaceVenueRef,
  };
}

// 節の使用履歴にこの選手がいれば、その節の部品交換数を数える（embedded の札）
async function loadRowMeetParts(selectedVenue, selectedRace, raceDate, row) {
  try {
    const history = await getMotorUsageHistory(
      selectedVenue, row.motor_number, selectedRace, { includeTarget: true },
    );
    const meet = history.find((item) => String(item.racerId) === String(row.racer_id));
    if (!meet) return { boat: row.boat_number, unavailable: true };
    const parts = await getMotorPartsHistory(
      selectedVenue, row.motor_number, 90, selectedRace, { includeTarget: true },
    );
    return { boat: row.boat_number, ...countMeetPartsChanges(parts.events, {
      from: meet.firstDate, to: raceDate,
    }) };
  } catch (err) {
    console.error("Failed to load meet motor parts:", err);
    return { boat: row.boat_number, failed: true };
  }
}

// 表は待たせず、失敗した基だけ札を隠す。履歴は直近90日と同じ窓。
function startMeetPartsLoad(m, run, data, raceDate) {
  const { selectedVenue, selectedRace, setMeetParts } = m;
  Promise.all(data.map((row) => loadRowMeetParts(selectedVenue, selectedRace, raceDate, row)))
    .then((rows) => {
      if (!run.cancelled) setMeetParts({ raceId: selectedRace, rows });
    });
}

// 会場内順位は一覧表のあとから足す（表の表示を待たせない）。当日のレースは最新の
// スナップショット、過去のレースはレース日以前で最新（BOA-521 と同じ）
function startVenueRanksLoad(m, run, raceDate) {
  m.setVenueRanks(null);
  getVenueMotorRanks(
    m.selectedVenue,
    raceDate !== null && raceDate < getTodayJST() ? raceDate : null,
  )
    .then((ranks) => {
      if (!run.cancelled) m.setVenueRanks(ranks);
    });
}

// 一覧表の取得結果を state に入れる
function applyBreakdown(m, data, dataFreshness, raceDate, venueGenerationStart) {
  const preGeneration =
    raceDate !== null &&
    raceDate < getTodayJST() &&
    venueGenerationStart !== null &&
    raceDate < venueGenerationStart;
  m.setGenerationStart(venueGenerationStart);
  m.setRacePreGeneration(preGeneration);
  m.setBreakdown(data);
  m.setFreshness(dataFreshness ?? null);
  m.setExplainBoat(null);
}

// 機力バッジ等からのディープリンク（?motor=）で指定されたモーターが
// 今回のレースに実在すれば、そのままドリルダウン画面を開く。
// マッチしなかった場合もpendingは消費する（消費せず残すと、後で
// ユーザーが手動で選んだ別レースがたまたま同じモーター番号を含んでいた際に
// 意図せず自動ドリルダウンしてしまうため）
function consumePendingMotor(m, data, pendingSnapshot) {
  const pendingExists =
    pendingSnapshot !== null &&
    data.some((r) => r.motor_number === pendingSnapshot);
  if (pendingExists) {
    m.setDrillDownMotor(pendingSnapshot);
  }
  m.pendingInitialMotorNumber.current = null;
}

async function loadBreakdown(m, run, pendingSnapshot, isNewRaceOrVenue) {
  const { selectedRace, selectedVenue, periodDays, embedded, t } = m;
  try {
    m.setLoading(true);
    m.setError(null);
    m.setMeetParts(null);
    m.setPartsBoat(null);
    if (isNewRaceOrVenue) m.setDrillDownMotor(null);
    // { rows, fetchFailed? }。会場公式のモーター成績が取れなかった行は venue_stats_failed（BOA-740）
    const { rows: data, freshness: dataFreshness } =
      await getRaceMotorBreakdown(
      selectedRace,
      selectedVenue,
      periodDays,
    );
    if (run.cancelled) return;
    const raceDate = selectedRace?.slice(0, 10) ?? null;
    // 使用開始日は、表示（1行・注記の日付）と入れ替え前の判定にだけ使う。取得が
    // 一時的に失敗しても一覧表そのものは出す（日付の行を出さず、入れ替え前とも
    // 判定しない）。以前は過去レースでしか呼んでいなかったので、当日のレースでは
    // この取得の失敗が一覧表のエラーにつながらなかった
    let venueGenerationStart = null;
    try {
      venueGenerationStart =
        await getMotorGenerationStart(selectedVenue);
    } catch (err) {
      console.error("モーター使用開始日取得エラー:", err.message);
    }
    if (run.cancelled) return;
    applyBreakdown(m, data, dataFreshness, raceDate, venueGenerationStart);
    if (embedded) startMeetPartsLoad(m, run, data, raceDate);
    startVenueRanksLoad(m, run, raceDate);
    consumePendingMotor(m, data, pendingSnapshot);
    run.applied = true;
  } catch (err) {
    if (run.cancelled) return;
    m.setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load race motor breakdown:", err);
  } finally {
    if (!run.cancelled) m.setLoading(false);
  }
}

// レース選択時: 枠番別モーター調子を取得（機力指数はvenue確定後に別途取得）
function useBreakdownLoad(m) {
  const { selectedRace, selectedVenue, periodDays } = m;
  useEffect(() => {
    if (selectedRace === null) return;
    const raceVenueKey = `${selectedRace}-${selectedVenue}`;
    const isNewRaceOrVenue = m.lastRaceVenueRef.current !== raceVenueKey;
    m.lastRaceVenueRef.current = raceVenueKey;
    // StrictMode（開発時）の2回実行対策: 使い捨ての1回目でpendingを消費しきって
    // しまわないよう、cleanup側で未適用（cancelled）なら元に戻す
    const pendingSnapshot = m.pendingInitialMotorNumber.current;
    const run = { cancelled: false, applied: false };
    loadBreakdown(m, run, pendingSnapshot, isNewRaceOrVenue);
    return () => {
      run.cancelled = true;
      if (!run.applied) m.pendingInitialMotorNumber.current = pendingSnapshot;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace, selectedVenue, periodDays]);
}

// ドリルダウンの9つの取得を同時に始める（Promise の配列を返す）
function startDrillFetches(m, beforeRaceId, isPast, raceDate) {
  const { selectedVenue, drillDownMotor, periodDays } = m;
  return [
    getMotorConditionTrend(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    getMotorPowerIndex(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    getMotorUsageHistory(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    getMotorPartsHistory(
      selectedVenue,
      drillDownMotor,
      periodDays,
      beforeRaceId,
    ),
    // 公式サイトのスナップショット（鮮度・優出等）は、過去レースならレース日以前の最新
    getVenueMotorStats(
      selectedVenue,
      drillDownMotor,
      isPast ? raceDate : null,
    ),
    getVenueMotorChampionshipHistory(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    // BOA-301 FR-1〜4: 会場内順位（公式の最新スナップショット）・
    // 枠番別成績・選手×枠成績（現行モーターの世代）は、periodDays
    // （既存の2連率/3連率推移トグル）とは独立した集計窓のため渡さない
    getVenueMotorRanking(
      selectedVenue,
      drillDownMotor,
      undefined,
      isPast ? raceDate : null,
    ),
    getMotorWakuStats(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
    getMotorRacerWakuStats(
      selectedVenue,
      drillDownMotor,
      beforeRaceId,
    ),
  ];
}

function applyDrillData(m, drill) {
  const [
    trend,
    power,
    history,
    parts,
    venueStats,
    championships,
    ranking,
    wakuStats,
    racerWakuStats,
  ] = drill;
  m.setTrendData(trend);
  m.setPowerIndex(power);
  m.setUsageHistory(history);
  m.setPartsHistory(parts.events ?? []);
  m.setVenueMotorStats(venueStats);
  m.setChampionshipHistory(championships);
  m.setVenueMotorRanking(ranking);
  m.setMotorWakuStats(wakuStats);
  m.setMotorRacerWakuStats(racerWakuStats);
}

async function loadTrend(m) {
  const { selectedVenue, selectedRace, t } = m;
  try {
    m.setLoading(true);
    m.setError(null);
    m.setDrillPreGeneration(false);
    const raceDate = selectedRace?.slice(0, 10) ?? null;
    const isPast = raceDate !== null && raceDate < getTodayJST();
    if (isPast) {
      const generationStart =
        await getMotorGenerationStart(selectedVenue);
      if (generationStart !== null && raceDate < generationStart) {
        m.setDrillPreGeneration(true);
        return;
      }
    }
    // 「このレースの直前まで」で集計する。過去レース（BOA-521）は今日から遡ると
    // レース後の走りまで入り、「このときモーターはどうだったか」を振り返れない。
    // 当日のレースも同じにする（BOA-557）。終了後に開くとそのレース自身の結果が
    // 入り、翌日（過去レース扱い）に開いたときと数字が変わっていた。発走前は
    // 直前までの結果＝今までの結果なので、見える数字は変わらない
    const beforeRaceId = selectedRace ?? null;
    const drill = await Promise.all(
      startDrillFetches(m, beforeRaceId, isPast, raceDate),
    );
    applyDrillData(m, drill);
  } catch (err) {
    m.setError(err.message || t("analysis.dataLoadError"));
    console.error("Failed to load motor condition trend:", err);
  } finally {
    m.setLoading(false);
  }
}

// モーター選択時: 節ごとの推移と機力指数を取得
function useDrillLoad(m) {
  const { selectedVenue, selectedRace, drillDownMotor, periodDays } = m;
  useEffect(() => {
    if (drillDownMotor === null || selectedVenue === null) return;
    loadTrend(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, selectedRace, drillDownMotor, periodDays]);
}

function usePeriodAndWakuReset(m) {
  const { selectedRace, selectedVenue, drillDownMotor, setPeriodDays, setSelectedWakuCourse } = m;
  // 過去レースでは期間を選ばせないので、90日に戻す（当日のレースで「直近1ヶ月」を
  // 選んだまま過去レースに移ったとき、見えない切り替えの値で集計しないように）
  useEffect(() => {
    if (selectedRace && selectedRace.slice(0, 10) < getTodayJST()) {
      setPeriodDays(90);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRace]);

  // モーター・会場が変わったらFR-4ドリルダウン（枠タップで開く選手一覧）を閉じる
  // （periodDaysトグルだけの変更では閉じない。90/30日切り替えはFR-2〜4の
  // 集計窓とは無関係なため）
  useEffect(() => {
    setSelectedWakuCourse(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVenue, drillDownMotor]);
}

const RATE_DEPS = { motorRateView, bestOf };
const PERIOD_DEPS = { getTodayJST, isClippedByGeneration };

// 2連率・3連率の推移グラフの元データ
function rateChartData(trendData, firstRatedIndex, drillTallyState) {
  return (
    firstRatedIndex === -1
      ? drillTallyState === "tallied"
        ? (trendData?.trend ?? [])
        : []
      : (trendData?.trend ?? []).slice(firstRatedIndex)
  ).map((row) => ({
    date: row.date.slice(5),
    motor_2rate: row.motor_2rate,
    motor_3rate: row.motor_3rate,
  }));
}

// 使用履歴は新しい順の一覧だが、グラフは推移グラフと同じく左が古く右が新しい
// 向きにそろえる（逆向きだと「右肩下がり＝最近悪化」と読み違える。BOA-513）
function usageChartData(usageHistory) {
  const usageHistoryChartData = [...usageHistory]
    .reverse()
    .filter((meet) => meet.rate2 !== null)
    .map((meet) => ({
      date: meet.playerName?.replace(/\s+/g, "") ?? "",
      rate2: meet.rate2,
      rate3: meet.rate3,
    }));
  return usageHistoryChartData;
}

function emptyKeyOf(drillFirstRun, key) {
  return drillFirstRun ? "analysis.motor.drillFirstRunEmpty" : key;
}

// 推移グラフ・展示タイム・使用履歴グラフの元データ
function computeTrendView({ trendData, breakdown, venueMotorStats, powerIndex, usageHistory }) {
  // 入れ替え直後は、公式の累計がまだ付かず 2連率・3連率とも 0 の日が続く。この先頭の
  // 0 の点は「1回も連に絡まなかった」と読めるので描かない（BOA-513、ファン4人のパネル）
  const firstRatedIndex = (trendData?.trend ?? []).findIndex(
    (row) => row.motor_2rate !== 0 || row.motor_3rate !== 0,
  );
  // 全部の点が 0 のとき、集計前（最初の節がまだ終わっていない）なら線を引かない。
  // 0% の横線は「一度も2着以内に来ていない」と読まれる（2026-09-29 ファン評価 P1）。
  // 集計済みで本当に 0%（前の節で3着以内に入らなかった）なら、0 の線を引く。
  // 区別には会場公式サイトの出走数を使う（officialTallyState）
  const venueHasOfficialStats = breakdown.some(
    (r) => r.race_count !== null && r.race_count !== undefined,
  );
  // 会場公式の成績が取れなかったとき（BOA-740）は出走数が無いだけなので、「集計前」とは断定しない
  const drillTallyState = officialTallyState(
    venueHasOfficialStats && !venueMotorStats?.fetchFailed,
    venueMotorStats?.raceCount,
  );
  const chartData = rateChartData(trendData, firstRatedIndex, drillTallyState);

  const exhibitionChartData = exhibitionChartDataOf(trendData);
  // このレースがこのモーターの初出走（直前までの走りが0）。「データが見つかりません」
  // だと取得失敗と区別できないので、理由を書く（BOA-557 ファン評価2周目）
  const drillFirstRun =
    powerIndex?.sample_count === 0 && usageHistory.length === 0;
  const emptyKey = (key) => emptyKeyOf(drillFirstRun, key);
  const exhibitionAxis = exhibitionTimeAxis(
    exhibitionChartData.map((row) => row.exhibition_time),
  );

  const usageHistoryChartData = usageChartData(usageHistory);
  return {
    firstRatedIndex, drillTallyState, chartData, exhibitionChartData,
    emptyKey, exhibitionAxis, usageHistoryChartData,
  };
}

function listPowerIndexOf(row) {
  return row.rate_source === "official"
    ? {
        value: row.generation_power_index ?? null,
        n: row.generation_runs ?? null,
      }
    : { value: row.power_index ?? null, n: row.sample_count };
}

// 棒にする2連率と、その値ラベル・最良の印・一覧の機力指数（整形は src/pure/motorChartView.js）
function computeRateView(breakdown, freshness, explainBoat, t) {
  // 棒にする2連率。公式（節時点。過去レースは2連率の列そのものが公式値、BOA-329）が 0 の艇は、
  // 現世代でこのレースより前の自前の値（BOA-830、2026-10-11 ユーザー決定）。まだ走っていない艇は棒なし
  const rateViews = breakdown.map(motorRateView);
  // 一覧の機力指数（listPowerIndex）。過去レースは公式に相当する値が無く「-」だったが、新しいモーターの
  // 入れ替えから間もない間は自前の値を出す（BOA-830「機力指数はこの間も自前」）
  return {
    ...computeMotorRateView(
      { breakdown, rateViews, freshness, explainBoat, t },
      RATE_DEPS,
    ),
    listPowerIndex: listPowerIndexOf,
  };
}

// 会場内順位の1セル（BOA-428）。会場サイトの値を出さない会場（戸田・平和島・浜名湖・宮島）と、
// その日以前のスナップショットが無いときは列ごと畳む。取得の失敗は列を残して印を出す
// （列が黙って消えると、データが無い会場と区別できない）
function venueRankCellOf({ t, venueRanks, selectedRace, generationStart }, motorNumber) {
  if (venueRanks?.state === "error") {
    return t("analysis.motor.venueRankError");
  }
  if (
    isVenueRankSnapshotBeforeGeneration({
      raceDate: selectedRace?.slice(0, 10) ?? null,
      scrapedDate: venueRanks?.scrapedDate ?? null,
      generationStart,
    })
  ) {
    return "—";
  }
  const hit = venueRanks?.ranks.get(motorNumber);
  // スナップショットに載っていないモーター（入れ替え直後の会場で欠けることがある）
  if (!hit) return "-";
  // 母数（/60）は小さく添える。375px で列幅を詰めるため（BOA-428）
  return (
    <>
      <span className="motor-venue-rank-main">
        {t(
          hit.tied > 1
            ? "analysis.motor.venueRankCellTied"
            : "analysis.motor.venueRankCell",
          { rank: hit.rank },
        )}
      </span>
      {/* 母数の前で折り返せるようにする（「タイ」と「/」の間は、そのままでは折れない） */}
      <wbr />
      <span className="motor-venue-rank-total">
        {t("analysis.motor.venueRankTotal", { total: venueRanks.total })}
      </span>
    </>
  );
}

// 一覧の列を出すか（優出数・優勝数・1着率・前検タイム。src/pure/motorChartView.js）と、失敗の札
function computeStatColumns(breakdown, t) {
  const venueStatsFailedCell = (
    <span className="motor-stat-failed">
      {t("analysis.motor.venueStatsFailedCell")}
    </span>
  );
  return { ...computeMotorStatColumns(breakdown), venueStatsFailedCell };
}

// 会場公式サイト由来で、表に出ている列の名前（出典の注記に挙げる）
function makeVenueColsLabel(t, cols) {
  const { showFirstPlaceRate, showFinalCount, showChampionshipCount } = cols;
  const venueColsLabel = [
    showFirstPlaceRate && "analysis.motor.firstPlaceRateHeader",
    showFinalCount && "analysis.motor.finalCountHeader",
    showChampionshipCount && "analysis.motor.championshipCountHeader",
  ]
    .filter(Boolean)
    .map((key) => t("analysis.motor.quotedLabel", { label: t(key) }))
    .join(t("analysis.motor.quotedLabelSeparator"));
  return venueColsLabel;
}

// 期間トグルを出すか・期間を切り詰めたか
function computePeriodView(m) {
  const { breakdown, selectedRace, drillDownMotor, drillPreGeneration } = m;
  // 過去レースの一覧表は出走表時点の公式値（BOA-329、2026-09-29 ユーザー判断(c)）。
  // 期間の切り替えは効かないので出さず、1行の注記に置き換える
  const officialMode = breakdown.some((r) => r.rate_source === "official");
  const isPastSelectedRace =
    Boolean(selectedRace) && selectedRace.slice(0, 10) < getTodayJST();
  // 過去レースは、一覧でもドリルダウンでも期間を選ばせない（90日固定）。
  // ドリルダウンだけ選べると、押すだけで機力指数の評価が「実力以上」⇔「低調」に
  // 反転し、一覧の「期間は選べません」とも食い違う（2026-09-29 ファン評価2周目）
  const showPeriodToggle =
    drillDownMotor === null
      ? !officialMode
      : !drillPreGeneration && !isPastSelectedRace;
  return {
    officialMode, showPeriodToggle, ...computePeriodClip(m, PERIOD_DEPS),
  };
}

// 画面に出す値を state から導く
function useMotorView(m) {
  const {
    t, breakdown, venueRanks, selectedRace, generationStart, venues,
    selectedVenue, drillDownMotor, meetParts, partsBoat, powerIndex,
  } = m;
  const currentParts = meetParts?.raceId === selectedRace ? meetParts.rows : [];
  const expandedParts = currentParts.find((row) => row.boat === partsBoat);
  const trend = computeTrendView(m);
  const rate = computeRateView(breakdown, m.freshness, m.explainBoat, t);
  // 会場内順位の列（BOA-428）。取得の失敗は列を残して印を出す
  const showVenueRank =
    venueRanks?.state === "ok" || venueRanks?.state === "error";
  const venueRankCell = (motorNumber) =>
    venueRankCellOf({ t, venueRanks, selectedRace, generationStart }, motorNumber);
  // BOA-301: embedded時のFR-2/3枠番グリッドで強調表示する「今日の艇番」。
  // 今日のレースはまだ実施前のため実進入コース(actual_course)は存在せず、
  // このレースへの割り当て艇番をそのまま暫定的な枠として使う
  const todayHighlightCourse =
    drillDownMotor !== null
      ? (breakdown.find((r) => r.motor_number === drillDownMotor)
          ?.boat_number ?? null)
      : null;
  const cols = computeStatColumns(breakdown, t);
  const drillPowerIndexTone = powerIndexTone(
    powerIndex?.power_index,
    powerIndex?.sample_count,
    SMALL_SAMPLE_THRESHOLD,
  );
  return {
    currentParts, expandedParts, ...trend, ...rate, showVenueRank, venueRankCell,
    todayHighlightCourse, ...cols,
    ...computeRankClasses(breakdown, cols.firstPlaceRates, RATE_DEPS),
    drillPowerIndexTone, venueColsLabel: makeVenueColsLabel(t, cols),
    ...computePeriodView(m),
    // ディープリンク先の会場が「本日開催中」の一覧に無い（過去レースへ飛んだとき）。
    // 選択肢に足し、見出しから「本日開催中」を外す（BOA-428・BOA-719）
    venueOffToday: selectedVenue !== null && !venues.includes(selectedVenue),
  };
}

function MotorTitle() {
  const { t } = useTranslation();
  return (
    <>
      <h2>{t("analysis.motor.title")}</h2>
      <p className="section-description">
        {t("analysis.motor.description")}
      </p>
    </>
  );
}

function VenueSelect({ venues, selectedVenue, setSelectedVenue, venueOffToday }) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="motor-venue-select">
        {t(
          venueOffToday
            ? "analysis.venueSelectLabel"
            : "analysis.venueSelectTodayLabel",
        )}
      </label>
      <select
        id="motor-venue-select"
        value={selectedVenue ?? ""}
        onChange={(e) => setSelectedVenue(parseInt(e.target.value, 10))}
        className="venue-select"
      >
        {/* ディープリンク先の会場が「本日開催中」の一覧に無いとき（ランキングの機番・
            機力バッジから過去レースへ飛んだとき）も、選択肢に足す。無いとブラウザが
            先頭の会場を表示し、別会場の同じ番号のモーターと読み違える（BOA-428 ファン評価） */}
        {(venueOffToday
          ? [selectedVenue, ...venues]
          : venues
        ).map((v) => (
          <option key={v} value={v}>
            {t(`venues.${v}`, VENUE_NAMES[v] || String(v))}
          </option>
        ))}
      </select>
    </>
  );
}

function RaceSelect({ races, selectedRace, setSelectedRace }) {
  const { t } = useTranslation();
  return (
    <>
      <label htmlFor="motor-race-select">
        {t("analysis.raceSelectLabel")}
      </label>
      <select
        id="motor-race-select"
        value={selectedRace ?? ""}
        onChange={(e) => setSelectedRace(e.target.value)}
        className="venue-select"
      >
        {/* 選択中のレースが今日の一覧に無い（過去レースへのディープリンク）ときも足す */}
        {selectedRace !== null &&
          !races.some((r) => r.race_id === selectedRace) && (
            <option value={selectedRace}>
              {t("analysis.raceOptionPast", {
                date: selectedRace
                  .slice(5, 10)
                  .replace("-", "/")
                  .replace(/^0/, "")
                  .replace(/\/0/, "/"),
                number: Number(selectedRace.slice(-2)),
              })}
            </option>
          )}
        {races.map((r) => (
          <option key={r.race_id} value={r.race_id}>
            {t("analysis.raceOption", {
              number: r.race_number,
              time: r.start_time?.slice(0, 5),
            })}
          </option>
        ))}
      </select>
    </>
  );
}

function MotorSelectors({ m, venueOffToday }) {
  const { t } = useTranslation();
  const { venues, loading, selectedVenue, setSelectedVenue, races, selectedRace, setSelectedRace } = m;
  return venues.length === 0 && !loading ? (
    <div className="empty-state">{t("analysis.noRacesToday")}</div>
  ) : (
    <div className="controls-section">
      <VenueSelect venues={venues} selectedVenue={selectedVenue} setSelectedVenue={setSelectedVenue} venueOffToday={venueOffToday} />
      {(races.length > 0 || selectedRace !== null) && (
        <RaceSelect races={races} selectedRace={selectedRace} setSelectedRace={setSelectedRace} />
      )}
    </div>
  );
}

function PeriodControls({ m, v }) {
  const { t } = useTranslation();
  const { generationStart, periodDays, setPeriodDays, drillDownMotor, racePreGeneration } = m;
  const { showPeriodToggle, periodChoiceHasEffect, clippedByGeneration, officialMode } = v;
  return showPeriodToggle ? (
    <>
      {/* 現行モーターの使用開始日。いつからのモーターかが分からないと、「入れ替え後の
          ため期間を限っています」を「最近入れ替えた」と読み違える（2026-09-29 ユーザー指摘）。
          当日のレースだけに出す（過去レースは出走表時点の公式値で、取れるのは最新の
          使用開始日1つだけのため、当時の日付を出せない） */}
      {generationStart !== null && (
        <p className="motor-generation-start">
          {t("analysis.motor.generationStartLabel", {
            date: formatGenerationDate(generationStart),
          })}
          <span className="motor-generation-start-source">
            {t("analysis.motor.generationStartSource")}
          </span>
        </p>
      )}
      {periodChoiceHasEffect && (
        <div className="period-toggle" role="group">
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 90 ? "active" : ""}`}
            onClick={() => setPeriodDays(90)}
          >
            {t("analysis.motor.period90")}
          </button>
          <button
            type="button"
            className={`period-toggle-btn ${periodDays === 30 ? "active" : ""}`}
            onClick={() => setPeriodDays(30)}
          >
            {t("analysis.motor.period30")}
          </button>
        </div>
      )}
      {clippedByGeneration && (
        <p className="table-note">
          {t("analysis.motor.periodClippedNote", {
            date: formatGenerationDate(generationStart, { short: true }),
          })}
        </p>
      )}
    </>
  ) : (
    officialMode &&
    drillDownMotor === null && (
      <p className="table-note">
        {t("analysis.motor.periodOfficialNote")}
        {racePreGeneration &&
          ` ${t("analysis.motor.racePreGenerationNote")}`}
      </p>
    )
  );
}

// 新しいモーターの最初の節（BOA-830、2026-10-11 ユーザー決定の文言）
function FreshMeetBanner({ freshness, selectedVenue }) {
  const { t } = useTranslation();
  return (
    <p className="motor-fresh-banner">
      {t("analysis.motor.freshFirstMeetBanner", {
        venue: t(
          `venues.${selectedVenue}`,
          VENUE_NAMES[selectedVenue] || String(selectedVenue),
        ),
        month: Number(freshness.generationStart.slice(5, 7)),
        day: Number(freshness.generationStart.slice(8, 10)),
      })}
    </p>
  );
}

function MotorListTable({ m, v, scroll, scrollRef }) {
  const {
    breakdown, periodDays, focusedBoat, onFocusBoat, setDrillDownMotor,
    partsBoat, setPartsBoat, explainBoat, setExplainBoat,
  } = m;
  return (
    <div
      className={`table-wrapper hscroll-hint mcc-list-hint${scroll.hasMore ? " has-more" : ""}`}
    >
      <HorizontalScrollButtons
        hasMore={scroll.hasMore}
        hasLess={scroll.hasLess}
        onMore={scroll.scrollRight}
        onLess={scroll.scrollLeft}
      />
      <div
        className="table-scroll"
        ref={scrollRef}
        onScroll={scroll.update}
      >
        <table className="motor-ranking-table mcc-list-table">
          <MotorListHead firstMeet={v.firstMeet} showVenueRank={v.showVenueRank} officialMode={v.officialMode} periodDays={periodDays} hasPretest={v.hasPretest} showFirstPlaceRate={v.showFirstPlaceRate} showFinalCount={v.showFinalCount} showChampionshipCount={v.showChampionshipCount} />
          <tbody>
            {breakdown.map((row, i) => (
              <MotorListRow key={row.boat_number} row={row} i={i} view={v} focusedBoat={focusedBoat} setDrillDownMotor={setDrillDownMotor} onFocusBoat={onFocusBoat} currentParts={v.currentParts} partsBoat={partsBoat} setPartsBoat={setPartsBoat} explainBoat={explainBoat} setExplainBoat={setExplainBoat} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MotorListView({ m, v, scroll, scrollRef }) {
  const { t } = useTranslation();
  const { freshness, selectedVenue, embedded, breakdown, venueRanks } = m;
  return (
    <>
      {v.firstMeet && freshness?.generationStart && (
        <FreshMeetBanner freshness={freshness} selectedVenue={selectedVenue} />
      )}
      <MotorListTable m={m} v={v} scroll={scroll} scrollRef={scrollRef} />
      {embedded && (
        <MotorPartsNotes expandedParts={v.expandedParts} currentParts={v.currentParts} />
      )}
      <OwnRateNote rateViews={v.rateViews} explainView={v.explainView} explainRow={v.explainRow} />
      <VenueRankNote breakdown={breakdown} venueRanks={venueRanks} selectedVenue={selectedVenue} />
      {v.venueStatsFailed && (
        <p className="table-note motor-venue-stats-failed-note">
          {t("analysis.motor.venueStatsFailedNote")}
        </p>
      )}
      <p className="table-note motor-official-source-note">
        <OfficialSourceNote breakdown={breakdown} officialMode={v.officialMode} listPowerIndex={v.listPowerIndex} venueColsLabel={v.venueColsLabel} />
      </p>
    </>
  );
}

function DrillPreGenerationView({ drillDownMotor, setDrillDownMotor }) {
  const { t } = useTranslation();
  return (
    <>
      <DrillDownHeader
        onBack={() => setDrillDownMotor(null)}
        backLabel={t("analysis.backToList")}
        heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
      />
      <div className="empty-state">
        {t("analysis.motor.drillPreGeneration", { n: drillDownMotor })}
      </div>
    </>
  );
}

// 走数が少ないときは評価の言葉を出さず、参考値と書く（BOA-549）
function powerIndexVerdict(t, tone) {
  return tone === "small"
    ? t("analysis.motor.powerIndexSmallSample")
    : tone === "good"
      ? ` — ${t("analysis.motor.powerIndexGood")}`
      : tone === "bad"
        ? ` — ${t("analysis.motor.powerIndexBad")}`
        : "";
}

function PowerIndexSummary({ powerIndex, tone, generationStart, periodDays }) {
  const { t } = useTranslation();
  if (powerIndex?.power_index === null || powerIndex?.power_index === undefined) {
    return null;
  }
  return (
    <p
      className={`power-index-summary ${
        POWER_INDEX_TONE_CLASS[tone] ?? ""
      }`}
    >
      {t("analysis.motor.powerIndexSummary", {
        index: formatPowerIndex(powerIndex.power_index),
        count: powerIndex.sample_count,
        // 入れ替え後で期間を切り詰めたときは「過去90日」と書かない
        // （37走が本当に90日分に見えてしまう）
        period: powerIndex.clipped_by_generation
          ? t("analysis.motor.periodSinceGeneration", {
              date: formatGenerationDate(generationStart, {
                short: true,
              }),
            })
          : t(`analysis.motor.period${periodDays}`),
      })}
      {powerIndexVerdict(t, tone)}
    </p>
  );
}

function FreshnessBadgeRow({ venueMotorStats }) {
  const { t } = useTranslation();
  return (
    <MotorStatBadgeRow
      icon="🔧"
      label={t("analysis.motor.freshnessLabel")}
      badges={[
        venueMotorStats?.raceCount !== null &&
          venueMotorStats?.raceCount !== undefined && {
            key: "raceCount",
            text: t("analysis.motor.freshnessRaceBadge", {
              raceCount: venueMotorStats.raceCount,
            }),
          },
        venueMotorStats?.meetCount !== null &&
          venueMotorStats?.meetCount !== undefined && {
            key: "meetCount",
            text: t("analysis.motor.freshnessMeetBadge", {
              meetCount: venueMotorStats.meetCount,
            }),
          },
      ].filter(Boolean)}
    />
  );
}

// BOA-301 FR-1: 会場内ランキング（venue_motor_stats最新スナップショット、
// 自社race_resultsからの再計算はしない）
function VenueRankBadgeRow({ venueMotorRanking }) {
  const { t } = useTranslation();
  return (
    <MotorStatBadgeRow
      icon="🏆"
      label={t("analysis.motor.venueRankLabel")}
      badges={[
        venueMotorRanking && {
          key: "venueRank",
          // 同じ値のモーターがあれば「◯位タイ」（BOA-529。今節タブの順位と同じ）
          text: t(
            venueMotorRanking.tied > 1
              ? "analysis.motor.venueRankBadgeTied"
              : "analysis.motor.venueRankBadge",
            {
              rank: venueMotorRanking.rank,
              total: venueMotorRanking.total,
              // 何の値の順位かを数字で示す。当日のレースは一覧に「2連率（期間の
              // 再計算）」と「公式2連率」の2列があり、どちらの順位か読めなかった
              // （BOA-529 ファン評価2周目）
              value: Number(venueMotorRanking.value).toFixed(1),
            },
          ),
        },
      ].filter(Boolean)}
    />
  );
}

const isPresent = (value) => value !== null && value !== undefined;

function venueRecordCards(t, venueMotorStats) {
  return [
    isPresent(venueMotorStats?.finalCount) && {
      key: "finalCount",
      value: venueMotorStats.finalCount,
      label: t("analysis.motor.finalCountHeader"),
    },
    isPresent(venueMotorStats?.championshipCount) && {
      key: "championshipCount",
      value: venueMotorStats.championshipCount,
      label: t("analysis.motor.championshipCountHeader"),
    },
    isPresent(venueMotorStats?.firstPlaceCount) &&
      venueMotorStats?.raceCount && {
        key: "firstPlaceRate",
        value: `${(
          (venueMotorStats.firstPlaceCount /
            venueMotorStats.raceCount) *
          100
        ).toFixed(1)}%`,
        label: t("analysis.motor.firstPlaceRateHeader"),
      },
  ].filter(Boolean);
}

function DrillRecordCards({ venueMotorStats }) {
  const { t } = useTranslation();
  return (
    <>
      {venueMotorStats?.fetchFailed && (
        <p className="table-note motor-venue-stats-failed-note">
          {t("analysis.motor.venueStatsFailedNote")}
        </p>
      )}
      <MotorRecordStatCards cards={venueRecordCards(t, venueMotorStats)} />
    </>
  );
}

// 鮮度・会場内順位・1着率・優出・優勝は会場公式サイトのスナップショットで、
// 節の終わりにしか更新されない。下の機力指数・使用履歴（当サイトの集計）と
// 走数が合わないことを先に断る（BOA-513、2026-09-28 ファン評価）
function OfficialSnapshotNote({ venueMotorStats, venueMotorRanking }) {
  const { t } = useTranslation();
  if (!((venueMotorStats && !venueMotorStats.fetchFailed) || venueMotorRanking)) {
    return null;
  }
  return (
    <p className="table-note">
      {t("analysis.motor.officialSnapshotNote")}
      {/* 会場内順位に添えた値は会場公式サイトの2連率で、小数2桁目を切り捨てる。
          一覧（BOAT RACE公式、四捨五入）と0.1違うことがある（BOA-529 ファン評価3周目。
          大村32号機: 一覧26.1／会場公式26.0） */}
      {venueMotorRanking &&
        ` ${t("analysis.motor.venueRankRoundingNote")}`}
    </p>
  );
}

// BOA-301 FR-2/3/4: 枠番別成績・展示タイム推移・選手×枠成績
function WakuSection({ m, v }) {
  const { selectedWakuCourse, setSelectedWakuCourse, motorRacerWakuStats, motorWakuStats, embedded } = m;
  return selectedWakuCourse !== null ? (
    <MotorRacerWakuDrillDown
      course={selectedWakuCourse}
      rows={motorRacerWakuStats.rows.filter(
        (r) => r.course === selectedWakuCourse,
      )}
      onBack={() => setSelectedWakuCourse(null)}
    />
  ) : (
    <MotorWakuStatsGrid
      rows={motorWakuStats.rows}
      generationStart={motorWakuStats.generationStart}
      fetchFailed={motorWakuStats.fetchFailed}
      embedded={embedded}
      highlightCourse={v.todayHighlightCourse}
      onSelectCourse={setSelectedWakuCourse}
    />
  );
}

function DrillView({ m, v }) {
  const { t } = useTranslation();
  const {
    drillDownMotor, setDrillDownMotor, selectedRace, powerIndex, generationStart,
    periodDays, venueMotorStats, venueMotorRanking, championshipHistory,
    trendData, usageHistory, partsHistory,
  } = m;
  return (
    <>
      <DrillDownHeader
        onBack={() => setDrillDownMotor(null)}
        backLabel={t("analysis.backToList")}
        heading={t("analysis.motor.trendHeading", { n: drillDownMotor })}
      />
      {/* 過去レースのドリルダウンは「このレースの直前まで」で集計する（BOA-521）。
          期間の切り替えは出さないので、どこまでの集計かをここで示す */}
      {/* 当日のレースも「このレースの直前まで」（BOA-557）。終了後に開いて、
          そのレースの結果が無いことを「データの遅れ」と読まれないように */}
      {selectedRace && (
        <p className="table-note">
          {t("analysis.motor.drillAsOfRaceNote")}
        </p>
      )}

      <PowerIndexSummary powerIndex={powerIndex} tone={v.drillPowerIndexTone} generationStart={generationStart} periodDays={periodDays} />

      <FreshnessBadgeRow venueMotorStats={venueMotorStats} />

      <VenueRankBadgeRow venueMotorRanking={venueMotorRanking} />

      <DrillRecordCards venueMotorStats={venueMotorStats} />
      <OfficialSnapshotNote venueMotorStats={venueMotorStats} venueMotorRanking={venueMotorRanking} />

      <WakuSection m={m} v={v} />

      <ChampionshipHistorySection championshipHistory={championshipHistory} />

      <RateTrendSection chartData={v.chartData} trendData={trendData} drillTallyState={v.drillTallyState} firstRatedIndex={v.firstRatedIndex} emptyKey={v.emptyKey} />

      <ExhibitionTrendSection exhibitionChartData={v.exhibitionChartData} exhibitionAxis={v.exhibitionAxis} emptyKey={v.emptyKey} />

      <UsageHistorySection usageHistory={usageHistory} usageHistoryChartData={v.usageHistoryChartData} emptyKey={v.emptyKey} />

      <PartsHistorySection partsHistory={partsHistory} />
    </>
  );
}

function MotorMain({ m, v, scroll, scrollRef }) {
  const { t } = useTranslation();
  const { loading, error, drillDownMotor, drillPreGeneration, breakdown, setDrillDownMotor } = m;
  const ready = !loading && !error;
  return (
    <>
      {loading && <div className="loading-state">{t("analysis.loading")}</div>}
      {error && (
        <div className="error-state">
          {t("analysis.error", { message: error })}
        </div>
      )}

      {ready && drillDownMotor === null && breakdown.length > 0 && (
        <MotorListView m={m} v={v} scroll={scroll} scrollRef={scrollRef} />
      )}

      {ready && drillDownMotor !== null && drillPreGeneration && (
        <DrillPreGenerationView drillDownMotor={drillDownMotor} setDrillDownMotor={setDrillDownMotor} />
      )}

      {ready && drillDownMotor !== null && !drillPreGeneration && (
        <DrillView m={m} v={v} />
      )}
    </>
  );
}

function MotorFooterNotes({ m, v }) {
  const { t } = useTranslation();
  const { drillDownMotor, racePreGeneration, focusedBoat, drillPreGeneration } = m;
  return (
    <>
      {/* 「行を押すと推移」は一覧でだけ、入れ替え前のレースでは出さない
          （押しても推移が出ないため） */}
      {drillDownMotor === null &&
        (racePreGeneration ? (
          <p className="table-note">{t("analysis.motor.highlightNote")}</p>
        ) : (
          <p className="table-note">{t("analysis.motor.note")}</p>
        ))}
      {drillDownMotor === null && v.hasHighlightedCell && (
        <p className="table-note">{t("analysis.motor.bestCellNote")}</p>
      )}
      {/* 線の意味（BOA-494 ファン評価）。一覧で、他のタブで艇を選んでいるときだけ */}
      {drillDownMotor === null && focusedBoat !== null && (
        <p className="table-note">{t("analysis.motor.focusedRowNote")}</p>
      )}
      {!drillPreGeneration && (
        <p className="table-note">{t("analysis.motor.powerIndexNote")}</p>
      )}
    </>
  );
}

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
  embedded = false,
  // レース詳細で「今どの艇を見ているか」をタブ間で共有する（BOA-492/BOA-494）。
  // /winning-technique は渡さないので、そちらの挙動は変わらない
  focusedBoat = null,
  onFocusBoat = null,
}) {
  const { t } = useTranslation();
  const selector = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });
  const states = useMotorStates(initialMotorNumber);
  const m = { ...selector, ...states, t, embedded, focusedBoat, onFocusBoat };
  useBreakdownLoad(m);
  useDrillLoad(m);
  usePeriodAndWakuReset(m);
  const v = useMotorView(m);
  // 9列の表は390pxでは右が切れる。切れていることに気づけるようにする
  // 会場内順位の列は一覧の後から足される（BOA-428）。足されたときに測り直す
  const rankingScroll = useHorizontalScrollHint([
    m.breakdown.length,
    m.venueRanks?.state,
  ]);
  const scroll = {
    hasMore: rankingScroll.hasMore,
    hasLess: rankingScroll.hasLess,
    scrollRight: rankingScroll.scrollRight,
    scrollLeft: rankingScroll.scrollLeft,
    update: rankingScroll.update,
  };

  return (
    <div className="motor-condition-container">
      {!embedded && <MotorTitle />}
      {!embedded && <MotorSelectors m={m} venueOffToday={v.venueOffToday} />}
      <PeriodControls m={m} v={v} />
      <MotorMain m={m} v={v} scroll={scroll} scrollRef={rankingScroll.ref} />
      <MotorFooterNotes m={m} v={v} />
    </div>
  );
}

export default MotorConditionChart;
