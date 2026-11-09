import { useTranslation } from "react-i18next";
import { ACCIDENT_BADGE_MIN_STARTS } from "../../../utils/accidentRate";

// 今期の事故率（目安、BOA-327）。どのサブタブでも見えるよう、展開パネルのタブの上に置く
export default function AccidentSummary({ acc, accidentRangeLabel, player }) {
  const { t } = useTranslation();
  if (!acc || !accidentRangeLabel) return null;
  const kinds = ["F", "L1", "K1", "S1", "S2"]
    .filter((k) => acc.counts[k] > 0)
    .map((k) =>
      t("basicInfo.accidentKindCount", {
        kind: t(`basicInfo.accidentKind.${k}`),
        n: acc.counts[k],
      }),
    )
    .join(t("basicInfo.accidentKindSeparator"));
  return (
    <div
      className={`rbit-accident${acc.settled && acc.status === "over" ? " is-over" : ""}`}
    >
      <div className="rbit-accident-heading">
        {accidentRangeLabel.to
          ? t("basicInfo.accidentTitle", accidentRangeLabel)
          : t("basicInfo.accidentTitleOpen", {
              from: accidentRangeLabel.from,
            })}
      </div>
      {acc.starts === 0 ? (
        <p className="rbit-accident-values">
          {t("basicInfo.accidentNoStarts")}
        </p>
      ) : (
        <div className="rbit-accident-values">
          {/* 数字だけを太字にする（承認済みモックどおり） */}
          <span className="rbit-accident-rate">
            {t("basicInfo.accidentRateLabel")}{" "}
            <span className="rbit-accident-rate-num">
              {acc.rate.toFixed(2)}
            </span>
          </span>
          <span className="rbit-accident-breakdown">
            {t("basicInfo.accidentBreakdown", {
              points: acc.points,
              starts: acc.starts,
              kinds: kinds || t("basicInfo.accidentNone"),
            })}
          </span>
          <span className="rbit-accident-line">
            {!acc.settled
              ? t("basicInfo.accidentLineEarly", {
                  min: ACCIDENT_BADGE_MIN_STARTS,
                })
              : acc.status === "over"
                ? t("basicInfo.accidentLineOver")
                : t("basicInfo.accidentLineNear", {
                    need: acc.need,
                  })}
          </span>
        </div>
      )}
      <p className="rbit-accident-note">
        {t(
          player.grade === "B2"
            ? "basicInfo.accidentNoteB2"
            : "basicInfo.accidentNote",
        )}
      </p>
    </div>
  );
}
