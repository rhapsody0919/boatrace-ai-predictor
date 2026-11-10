import { useTranslation } from "react-i18next";
import RacerPageLink from "../RacerPageLink";
import InlineFetchError from "../../InlineFetchError";
import AccidentSummary from "./AccidentSummary";
import TrendView from "./TrendView";
import VenueRankingView from "./VenueRankingView";
import ConditionsView from "./ConditionsView";

const VIEWS = [
  { key: "trend", label: "basicInfo.viewTrend" },
  { key: "venue", label: "basicInfo.viewVenue" },
  { key: "conditions", label: "basicInfo.viewConditions" },
];

// 艇の行を押して開く内訳（トレンド／当地／条件別）
export default function ExpandedPanel({
  boat,
  player,
  raceId,
  venueCode,
  metric,
  setMetric,
  needsOwnAggregation,
  expandedView,
  setExpandedView,
  rawRecords,
  records,
  accident,
  accidentFailed,
  accidentRangeLabel,
  onRetryAccident,
  nowRow,
  periodStats,
  periodFailed,
  onRetryPeriod,
}) {
  const { t } = useTranslation();
  return (
    <div className="rbit-expanded">
      {/* 選手ページへ（BOA-879）。行は押すと開くボタンのまま、開いた中の一番上に置く */}
      <RacerPageLink racerId={player?.racerId} name={player?.name} />
      {/* 今期の事故率（目安、BOA-327）。どのサブタブでも見えるよう、タブの上に置く */}
      {accidentFailed && (
        <InlineFetchError
          message={t("basicInfo.accidentFetchError")}
          onRetry={onRetryAccident}
        />
      )}
      <AccidentSummary
        acc={accident}
        accidentRangeLabel={accidentRangeLabel}
        player={player}
      />
      <div className="rbit-expanded-tabs">
        {VIEWS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`rbit-expanded-tab${expandedView === key ? " is-active" : ""}`}
            onClick={() => setExpandedView(key)}
          >
            {t(label)}
          </button>
        ))}
      </div>

      {expandedView === "trend" && (
        <TrendView records={rawRecords} raceId={raceId} />
      )}
      {expandedView === "venue" && (
        <VenueRankingView
          records={records}
          metric={metric}
          venueCode={venueCode}
        />
      )}
      {expandedView === "conditions" && (
        <ConditionsView
          records={records}
          raceId={raceId}
          venueCode={venueCode}
          metric={metric}
          boat={boat}
          racerId={player?.racerId}
          needsOwnAggregation={needsOwnAggregation}
          nowRow={nowRow}
          periodStats={periodStats}
          periodFailed={periodFailed}
          onRetryPeriod={onRetryPeriod}
          onSelectTop3={() => setMetric("top3Rate")}
        />
      )}
    </div>
  );
}
