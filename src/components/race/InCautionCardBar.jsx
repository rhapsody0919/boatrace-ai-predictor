import { IN_CAUTION_CONFIG } from "../../constants/inCautionConfig";
import { useTranslation } from "react-i18next";

/** 棒グラフ（数字・基準線・低/高のゾーン） */
export default function InCautionBar({ ic }) {
  const { t } = useTranslation();
  const [lowEdge, highEdge] = IN_CAUTION_CONFIG.thresholds;
  return (
    <div className="in-caution-card-bar">
      <span
        className="in-caution-card-base-label"
        style={{ left: `${ic.basePct}%` }}
      >
        {t("inCaution.base", { p: ic.basePct })}
      </span>
      <span className="in-caution-card-track" aria-hidden="true">
        <span
          className={`in-caution-card-fill in-caution-card-fill--${ic.level}`}
          style={{ width: `${ic.pct}%` }}
        />
        <span
          className="in-caution-card-base"
          style={{ left: `${ic.basePct}%` }}
        />
      </span>
      <span className="in-caution-card-zones" aria-hidden="true">
        <span
          className="in-caution-card-zone--low"
          style={{ width: `${lowEdge}%` }}
        />
        <span
          className="in-caution-card-zone--high"
          style={{ left: `${highEdge}%` }}
        />
      </span>
      <span className="in-caution-card-edges">
        <span>{t("inCaution.edgeLow", { p: lowEdge })}</span>
        <span>{t("inCaution.edgeHigh", { p: highEdge })}</span>
      </span>
    </div>
  );
}
