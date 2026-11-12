/** MeetFormTrendCard の指標タブと艇チップ */
import { BOAT_COLORS, getBoatChipBackground } from "../../utils/colors";

export function MetricTabs({ metrics, metric, metricLabel, onSelect }) {
  return (
    <div className="mft-metrics" role="tablist">
      {metrics.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={key === metric}
          className={`mft-metric${key === metric ? " is-active" : ""}`}
          onClick={() => onSelect(key)}
        >
          {metricLabel(key)}
        </button>
      ))}
    </div>
  );
}

export function BoatChips({ t, boats, selected, onSelect }) {
  return (
    <div className="mft-boats">
      {boats.map((b) => (
        <button
          key={b.boat}
          type="button"
          data-boat={b.boat}
          aria-pressed={b.boat === selected?.boat}
          aria-label={t("beforeInfo.meetFormBoatLabel", { boat: b.boat })}
          className={`mft-boat${b.boat === selected?.boat ? " is-active" : ""}`}
          style={{
            background: getBoatChipBackground(b.boat),
            color: BOAT_COLORS[b.boat]?.text,
          }}
          onClick={() => onSelect(b.boat)}
        >
          {b.boat}
        </button>
      ))}
    </div>
  );
}
