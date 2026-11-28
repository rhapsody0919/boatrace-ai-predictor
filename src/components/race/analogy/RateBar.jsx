import { useTranslation } from "react-i18next";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";

/** 件数が 0 のときは割合 0 */
const rateOf = (hits, n) => (n ? hits / n : 0);
const hasReference = (reference) =>
  reference !== null && reference !== undefined;
const fillStyle = (p, color) => ({
  width: `${p * 100}%`,
  ...(color ? { background: color } : {}),
});
// ぶれ幅のひげは外した（2026-11-29 オーナー承認、plan.md §14）。説明は見出しの「?」（termHints.sonarRateBar）
function BarTrack({ p, reference, color }) {
  return (
    <span className="af-trk">
      <span className="af-trk-f" style={fillStyle(p, color)} />
      {hasReference(reference) && (
        <span className="af-trk-nt" style={{ left: `${reference * 100}%` }} />
      )}
    </span>
  );
}

function BarCount({ hits, countChip }) {
  const { t } = useTranslation();
  const text = t("aiPredictionTab.analogy.count", { n: fmtCount(hits) });
  return countChip ? (
    // 件数の札「168件 ›」: 押すとその件数の元のレースが図の下に開く（BOA-823）
    <span className="af-cnt-chip">{text} ›</span>
  ) : (
    <small>{text}</small>
  );
}

function BarValue({ value, n, p, hits, countChip }) {
  return (
    <span className="af-bar-v">
      {value ?? (
        <>
          {fmtPct(n ? p : null)} <BarCount hits={hits} countChip={countChip} />
        </>
      )}
    </span>
  );
}

/**
 * 割合の横棒（比べる相手の点線つき。承認版モックの wbar）。onClick があればボタン
 * @param {{label: React.ReactNode, hits: number, n: number, reference?: number|null, color?: string,
 *   value?: React.ReactNode, selected?: boolean, onClick?: () => void, ariaLabel?: string, few?: boolean}} props few は件数が少ない棒を薄く出す
 */
export default function RateBar({
  label,
  hits,
  n,
  reference = null,
  color,
  value,
  selected = false,
  onClick,
  ariaLabel,
  few = false,
  countChip = false,
}) {
  const p = rateOf(hits, n);
  const body = (
    <>
      <span>{label}</span>
      <BarTrack p={p} reference={reference} color={color} />
      <BarValue value={value} n={n} p={p} hits={hits} countChip={countChip} />
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={`af-bar${selected ? " is-selected" : ""}${few ? " is-few" : ""}`}
      aria-label={ariaLabel}
      aria-pressed={selected}
      onClick={onClick}
    >
      {body}
    </button>
  ) : (
    <div className={`af-bar${few ? " is-few" : ""}`}>{body}</div>
  );
}
