import { BOAT_COLORS } from "../../../utils/colors";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { restClassCounts } from "../../../utils/assistModel";

/**
 * 級の並びの絵（spec D-31）。選んだ艇は「{n}号艇 枠も級も同じ」、残り5艇は艇の色の枠に級を入れて
 * 今日の艇番順に並べ、点線で囲んで「級の艇数だけ同じ・どの枠かは問わない」（2026-10-08 ユーザー決定）
 * @param {{lineup: Array<{boat: number, cls: string, fixed: boolean}>|null, small?: boolean}} props assistModel.classLineup の戻り値。small は表の行の横に置く小さい絵（札なし）
 */
/** 2行の札。行の間の区切り（sep）は見た目では改行、文字としては残す */
function Cap({ lines, sep }) {
  return (
    <span className="ta-cls-cap">
      {lines.map((t, i) => (
        <span key={t} className="ta-cls-line">
          {i > 0 && <span className="ta-sr">{sep}</span>}
          {t}
        </span>
      ))}
    </span>
  );
}

export default function ClassLineup({ lineup, small = false }) {
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
      className={`ta-cls${small ? " ta-cls-small" : ""}`}
      role="img"
      aria-label={ASSIST_COPY.classAria(
        fixed?.boat,
        fixed?.cls ?? "—",
        restClassCounts(
          lineup.map((x) => x.cls),
          fixed?.boat,
        ) ?? "—",
      )}
    >
      {fixed && (
        <span className="ta-cls-one">
          {box(fixed)}
          {!small && <Cap lines={ASSIST_COPY.classFixed(fixed.boat)} sep=" " />}
        </span>
      )}
      <span className="ta-cls-rest">
        <span className="ta-cls-in">{rest.map(box)}</span>
        {!small && <Cap lines={ASSIST_COPY.classRest} sep="・" />}
      </span>
    </span>
  );
}
