/**
 * AnalysisVenueSelect - 分析タブの会場の選び（24会場、値は "01"〜"24"）。
 * 7つのチャートに同じ会場の表と select が字のまま並んでいたのを部品にした（2026-11-25。まず TopStart・LosingTechnique）。
 * 会場名は src/constants の STADIUM_NAMES、表示は venues.<番号> の訳（無ければ日本語名）
 */
import { STADIUM_NAMES } from "../../constants/index.js";

const CODES = Object.keys(STADIUM_NAMES).map((n) => String(n).padStart(2, "0"));

export default function AnalysisVenueSelect({ id, value, onChange, t }) {
  return (
    <div className="controls-section">
      <label htmlFor={id}>{t("analysis.venueSelectLabel")}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="venue-select"
      >
        {CODES.map((code) => (
          <option key={code} value={code}>
            {t(`venues.${parseInt(code, 10)}`, STADIUM_NAMES[parseInt(code, 10)])}
          </option>
        ))}
      </select>
    </div>
  );
}
