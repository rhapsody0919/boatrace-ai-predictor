/**
 * 会場ページの見出しの直下に置く常設の要約2行（BOA-1189 GS02-b）。
 * 文はボット向け HTML と同じ venueSummaryLines で組む。数字は月1回作る静的な値（src/data/venueSummaryStats.js）。
 */
import { useTranslation } from "react-i18next";
import { venueSummaryLines } from "../../utils/venueSummary";
import "./VenueSummaryLines.css";

export default function VenueSummaryLines({ venueCode }) {
  const { t } = useTranslation();
  const lines = venueSummaryLines(t, venueCode);
  if (!lines) return null;
  return (
    <section
      className="venue-summary-lines"
      aria-label={t("venueSummary.label")}
      data-testid="venue-summary-lines"
    >
      <p className="venue-summary-lines__course">{lines.course}</p>
      <p className="venue-summary-lines__techniques">{lines.techniques}</p>
    </section>
  );
}
