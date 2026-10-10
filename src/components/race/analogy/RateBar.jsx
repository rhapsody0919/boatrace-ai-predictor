import { useTranslation } from "react-i18next";
import { wilsonInterval } from "../../../utils/wilson";
import { fmtCount, fmtPct } from "../../../utils/analogyFormat";

/**
 * 割合の横棒（ぶれ幅の横線・比べる相手の点線つき。承認版モックの wbar）。onClick があればボタン
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
  const { t } = useTranslation();
  const p = n ? hits / n : 0;
  const ci = n ? wilsonInterval(hits, n) : null;
  const body = (
    <>
      <span>{label}</span>
      <span className="af-trk">
        <span
          className="af-trk-f"
          style={{
            width: `${p * 100}%`,
            ...(color ? { background: color } : {}),
          }}
        />
        {ci && (
          <span
            className="af-trk-w"
            style={{
              left: `${ci[0] * 100}%`,
              width: `${(ci[1] - ci[0]) * 100}%`,
            }}
          />
        )}
        {reference !== null && reference !== undefined && (
          <span className="af-trk-nt" style={{ left: `${reference * 100}%` }} />
        )}
      </span>
      <span className="af-bar-v">
        {value ?? (
          <>
            {fmtPct(n ? p : null)}{" "}
            {countChip ? (
              // 件数の札「168件 ›」: 押すとその件数の元のレースが図の下に開く（BOA-823）
              <span className="af-cnt-chip">
                {t("aiPredictionTab.analogy.count", { n: fmtCount(hits) })} ›
              </span>
            ) : (
              <small>
                {t("aiPredictionTab.analogy.count", { n: fmtCount(hits) })}
              </small>
            )}
          </>
        )}
      </span>
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
