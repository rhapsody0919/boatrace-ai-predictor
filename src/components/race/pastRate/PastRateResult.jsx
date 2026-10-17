/**
 * 結果（spec FR-2）: 要約、主文（回数を大きく、%を添える）、ラベル、メーター、内訳、除いた件数、比べた相手の注記。
 * 分母0なら主文・メーター・ラベル・内訳の代わりに空の文
 */
import { useTranslation } from "react-i18next";
import {
  breakdownText,
  excludedText,
  mainText,
  noteText,
  summaryOf,
} from "./format.js";
import { thresholdNote } from "../../../utils/pastRate/label.js";

const K = "aiPredictionTab.pastRate";

export function LabelTag({ label }) {
  const { t } = useTranslation();
  if (!label) return null;
  return (
    <span className={`prc-tag prc-tag-${label}`}>
      {t(`${K}.labels.${label}`)}
    </span>
  );
}

export default function PastRateResult({
  layer,
  truncated,
  type,
  input,
  counted,
  label,
}) {
  const { t } = useTranslation();
  const breakdown = breakdownText(type, counted.breakdown, t);
  const pct = counted.n ? (counted.count / counted.n) * 100 : 0;
  return (
    <>
      <p className="prc-summary">{summaryOf(type, input, t)}</p>
      {counted.n > 0 ? (
        <>
          <p className="prc-main">
            {mainText(counted, truncated, t)}
            <LabelTag label={label} />
          </p>
          <div className="prc-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          {breakdown && <p className="prc-breakdown">{breakdown}</p>}
        </>
      ) : (
        <p className="prc-main">{t(`${K}.empty`)}</p>
      )}
      {counted.excluded.map((e) => (
        <p key={e.reason} className="prc-note">
          {excludedText(e, t)}
        </p>
      ))}
      <p className="prc-note">
        {noteText(layer, truncated, thresholdNote(type, input), t)}
      </p>
    </>
  );
}
