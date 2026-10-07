import { BOAT_COLORS } from "../../../utils/colors";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/**
 * 級の並びの絵（spec D-31）。選んだ艇の級を「{n}号艇 固定」、残り5艇は艇の色の枠に級を入れて
 * 今日の艇番順に並べ、点線で囲んで「入れ替わってもOK」
 * @param {{lineup: Array<{boat: number, cls: string, fixed: boolean}>|null}} props assistModel.classLineup の戻り値
 */
export default function ClassLineup({ lineup }) {
  if (!lineup) return null;
  const fixed = lineup.find((x) => x.fixed);
  const rest = lineup.filter((x) => !x.fixed);
  const box = (x) => (
    <span
      key={x.boat}
      className={`ta-cls-box${x.fixed ? " ta-cls-fixed" : ""}`}
      style={{
        background: BOAT_COLORS[x.boat]?.bg,
        color: BOAT_COLORS[x.boat]?.text,
      }}
    >
      {x.cls ?? "—"}
    </span>
  );
  return (
    <span
      className="ta-cls"
      role="img"
      aria-label={ASSIST_COPY.classAria(
        fixed?.boat,
        fixed?.cls ?? "—",
        rest.map((x) => x.cls ?? "—"),
      )}
    >
      {fixed && (
        <span className="ta-cls-one">
          {box(fixed)}
          <span className="ta-cls-cap">
            {ASSIST_COPY.classFixed(fixed.boat)}
          </span>
        </span>
      )}
      <span className="ta-cls-rest">
        <span className="ta-cls-in">{rest.map(box)}</span>
        <span className="ta-cls-cap">{ASSIST_COPY.classRest}</span>
      </span>
    </span>
  );
}
