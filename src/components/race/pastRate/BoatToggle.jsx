import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";

/** 艇のボタン（公式色、aria-pressed）。BOA-635 の着順・展開・進入で使う */
export default function BoatToggle({ n, pressed, onClick, disabled = false }) {
  const { t } = useTranslation();
  const c = BOAT_COLORS[n];
  return (
    <button
      type="button"
      className="prc-boat"
      style={{ background: c.bg, color: c.text }}
      aria-pressed={pressed}
      aria-label={t("aiPredictionTab.pastRate.boat", { n })}
      disabled={disabled}
      onClick={onClick}
    >
      {n}
    </button>
  );
}
