import { useTranslation } from "react-i18next";
import InCautionBadge from "./InCautionBadge";
import InCautionBar from "./InCautionCardBar";
import { IN_CAUTION_CONFIG } from "../../constants/inCautionConfig";
import {
  bandRange,
  signedText as signed,
  slashDate,
} from "../../utils/inCautionLevel";

/** 検証済みの段の範囲を文にする */
function useBandText(band) {
  const { t } = useTranslation();
  const range = bandRange(band);
  if (range.from === null)
    return t("inCaution.bandBelow", { v: signed(range.to, 1) });
  if (range.to === null)
    return t("inCaution.bandAbove", { v: signed(range.from, 1) });
  return t("inCaution.bandRange", {
    from: signed(range.from, 1),
    to: signed(range.to, 1),
  });
}

/** 左（数字・棒・範囲） */
export default function InCautionCardMain({
  ic,
  titleId,
  result,
  finished,
  rank,
}) {
  const { t } = useTranslation();
  const bandText = useBandText(ic.band);
  const notes = [
    ic.round === "junyu" && t("inCaution.noteJunyu"),
    ic.round === "yusho" && t("inCaution.noteYusho"),
    ic.absentBoats?.length > 0 &&
      t("inCaution.noteAbsent", { boats: 6 - ic.absentBoats.length }),
    ic.lowSample &&
      t("inCaution.noteLowSample", { n: ic.n.toLocaleString("ja-JP") }),
  ].filter(Boolean);
  return (
    <div className="in-caution-card-main">
      <div className="in-caution-card-head">
        <h3 className="in-caution-card-title" id={titleId}>
          {t("inCaution.title")}
        </h3>
        <InCautionBadge level={ic.level} />
      </div>
      <p className="in-caution-card-figure">
        <span className="in-caution-card-lead">{t("inCaution.lead")}</span>
        <span className="in-caution-card-pct">
          <span>{ic.pct}</span>%
        </span>
      </p>

      <InCautionBar ic={ic} />

      <p className="in-caution-card-range">
        {t("inCaution.range", {
          band: bandText,
          n: ic.n.toLocaleString("ja-JP"),
          from: slashDate(IN_CAUTION_CONFIG.from),
          through: slashDate(ic.through),
        })}
      </p>

      {notes.length > 0 && (
        <ul className="in-caution-card-notes">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {finished && rank !== null && (
        <p className="in-caution-card-result">
          {t("inCaution.result", { rank })}
          {rank !== 1 && result.rank1 != null && (
            <span>{t("inCaution.resultWinner", { boat: result.rank1 })}</span>
          )}
        </p>
      )}
    </div>
  );
}
