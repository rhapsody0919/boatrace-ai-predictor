/** MotorConditionChart のドリルダウンの画面と下の注記（MotorConditionChart.jsx から本文を字のまま移した） */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import MotorStatBadgeRow from "../MotorStatBadgeRow";
import MotorRecordStatCards from "../MotorRecordStatCards";
import DrillDownHeader from "./DrillDownHeader";
import MotorWakuStatsGrid from "./MotorWakuStatsGrid";
import MotorRacerWakuDrillDown from "./MotorRacerWakuDrillDown";
import { formatPowerIndex } from "../../utils/smallSampleRate";
import { formatGenerationDate } from "../../utils/motorGeneration";
import { POWER_INDEX_TONE_CLASS } from "./motorConditionView";
import {
  ChampionshipHistorySection,
  ExhibitionTrendSection,
  PartsHistorySection,
  RateTrendSection,
  UsageHistorySection,
} from "./MotorConditionDrillSections";
import { DrillPreGenerationView, MotorListView } from "./MotorConditionList";
import MotorGenerationTrend, { MotorMetricChips, MotorViewHead } from "./MotorGenerationTrend";

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

// 一覧と「今の値｜推移」。切り替えはレース詳細のタブだけ（オーナー 2026-11-25 承認のモック改訂2）。開いた最初は今の値
function MotorListArea({ m, v, scroll, scrollRef }) {
  const [view, setView] = useState("now");
  const [metric, setMetric] = useState("top2Rate");
  const list = <MotorListView m={m} v={v} scroll={scroll} scrollRef={scrollRef} />;
  if (!m.embedded) return list;
  const trend = view === "trend";
  return (
    <>
      {trend && <MotorMetricChips metric={metric} setMetric={setMetric} />}
      <MotorViewHead view={view} setView={setView} metric={metric} />
      {trend ? (
        <MotorGenerationTrend venueCode={m.selectedVenue} raceId={m.selectedRace} rows={m.breakdown} metric={metric}
          onShowNow={() => setView("now")} focusedBoat={m.focusedBoat} onFocusBoat={m.onFocusBoat} />
      ) : (
        list
      )}
    </>
  );
}

export function MotorMain({ m, v, scroll, scrollRef }) {
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
        <MotorListArea m={m} v={v} scroll={scroll} scrollRef={scrollRef} />
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

export function MotorFooterNotes({ m, v }) {
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
