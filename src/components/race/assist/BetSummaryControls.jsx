import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

export default function BetSummaryControls({
  budgetId,
  budget,
  mode,
  onBudget,
  onMode,
}) {
  return (
    <div className="ta-calc">
      <label htmlFor={budgetId}>{ASSIST_COPY.budget}（円）</label>
      <input
        id={budgetId}
        type="number"
        inputMode="numeric"
        min="100"
        step="100"
        value={budget}
        onChange={(e) => onBudget(e.target.value)}
      />
      <span
        className="ta-radio"
        role="radiogroup"
        aria-label={ASSIST_COPY.allocation}
      >
        {[
          ["equalPayout", ASSIST_COPY.modeEqualPayout],
          ["equal", ASSIST_COPY.modeEqual],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={`${budgetId}-mode`}
              value={value}
              checked={mode === value}
              onChange={() => onMode(value)}
            />
            {label}
          </label>
        ))}
      </span>
    </div>
  );
}
