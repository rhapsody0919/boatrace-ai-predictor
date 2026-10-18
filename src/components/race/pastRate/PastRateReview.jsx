/**
 * PastRateReview - 結果タブの「振り返り」（BOA-635、spec FR-4・screens S-2）
 *
 * この端末に保存した、締切前に入れた予想を型の順に、入力したときに見せた数字とラベルで出す。最後に決着の行
 * （着順1点と同じ数え方、今の layer の行から数える。ラベルは出さない）。当たり／外れは出さない。
 * 入力したときと layer の中身の印（layerKey）が違えば、比べる相手が変わったことを1行出す。
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LabelTag } from "./PastRateResult";
import {
  mainText,
  orderComboText,
  savedMainText,
  summaryOf,
} from "./format.js";
import { decisionCount } from "../../../utils/pastRate/count.js";
import { isTruncated, layerKey } from "../../../utils/pastRate/layer.js";
import {
  entriesForRace,
  layerChanged,
} from "../../../utils/pastRate/storage.js";
import "./PastRate.css";

const K = "result.pastRate";

/**
 * @param {{layer: object, raceId: string, deadline: Date|null, decision: number[]|null}} props
 *   decision は結果表の1〜3着の艇（そろわないときは null）
 */
export default function PastRateReview({ layer, raceId, deadline, decision }) {
  const { t } = useTranslation();
  const entries = useMemo(
    () => entriesForRace(raceId, { deadline }),
    [raceId, deadline],
  );
  const changed = useMemo(
    () => entries.length > 0 && layerChanged(entries, layerKey(layer)),
    [entries, layer],
  );
  const decisionCounted = decision ? decisionCount(layer.rows, decision) : null;

  if (entries.length === 0 && !decisionCounted) return null;
  return (
    <section
      className="prc-review"
      aria-labelledby="prc-review-title"
      data-testid="past-rate-review"
    >
      <h3 className="prc-review-title" id="prc-review-title">
        {t(`${K}.title`)}
      </h3>
      <ul className="prc-review-list">
        {entries.map((e) => (
          <li key={e.type}>
            {t(`${K}.entry`, {
              summary: summaryOf(e.type, e.input, t),
              main: savedMainText(e.result, t),
            })}
            <LabelTag label={e.result.label} />
          </li>
        ))}
        {decisionCounted && (
          <li>
            {t(`${K}.decision`, {
              combo: orderComboText({
                first: decision[0],
                second: [decision[1]],
                third: [decision[2]],
              }),
              main: mainText(decisionCounted, isTruncated(layer), t),
            })}
          </li>
        )}
      </ul>
      {changed && <p className="prc-note">{t(`${K}.changed`)}</p>}
    </section>
  );
}
