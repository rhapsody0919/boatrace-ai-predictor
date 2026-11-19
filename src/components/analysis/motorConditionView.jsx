/** MotorConditionChart の表示の値（一覧の棒・会場内順位の欄・機力指数の色）（MotorConditionChart.jsx から本文を字のまま移した） */
import { exhibitionTimeAxis } from "../../utils/chartDomain";
import { SMALL_SAMPLE_THRESHOLD } from "../../pure/basicInfoStats.js";
import { powerIndexTone } from "../../utils/smallSampleRate";
import { getTodayJST } from "../../utils/dateUtils";
import {
  isClippedByGeneration,
  isVenueRankSnapshotBeforeGeneration,
  officialTallyState,
} from "../../utils/motorGeneration";
import { motorRateView } from "../../utils/motorFreshRate";
import { bestOf } from "../../utils/bestOf";
import {
  computeRateView as computeMotorRateView,
  computeStatColumns as computeMotorStatColumns,
  computePeriodView,
  computeRankClasses,
  computeTrendView,
  listPowerIndexOf,
  makeVenueColsLabel,
} from "../../pure/motorChartView.js";

// 機力指数の色（小標本は枠番別成績と同じ参考値の色。BOA-549）
export const POWER_INDEX_TONE_CLASS = {
  good: "power-index-good",
  bad: "power-index-bad",
  small: "is-small-sample",
};

const RATE_DEPS = { motorRateView, bestOf };

const PERIOD_DEPS = { getTodayJST, isClippedByGeneration };

const TREND_DEPS = { officialTallyState, exhibitionTimeAxis };

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

// 画面に出す値を state から導く
export function useMotorView(m) {
  const {
    t, breakdown, venueRanks, selectedRace, generationStart, venues,
    selectedVenue, drillDownMotor, meetParts, partsBoat, powerIndex,
  } = m;
  const currentParts = meetParts?.raceId === selectedRace ? meetParts.rows : [];
  const expandedParts = currentParts.find((row) => row.boat === partsBoat);
  const trend = computeTrendView(m, TREND_DEPS);
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
    ...computePeriodView(m, PERIOD_DEPS),
    // ディープリンク先の会場が「本日開催中」の一覧に無い（過去レースへ飛んだとき）。
    // 選択肢に足し、見出しから「本日開催中」を外す（BOA-428・BOA-719）
    venueOffToday: selectedVenue !== null && !venues.includes(selectedVenue),
  };
}
