import { SPARK_VIEW_W } from "../../utils/trendDateLayout";

/**
 * 点の下の文字は HTML で置く。SVG は横に引き伸ばす（preserveAspectRatio none）
 * ので、SVG の text にすると文字が横に潰れる。横位置は点と同じ割合で合わせる
 * 走数が多い（10走以上）と375pxで数字の間隔が10px前後まで詰まる。字を
 * 小さくして、全角の記号（落・欠など）どうしが接しないようにする（BOA-537）
 */
export default function MeetSparklineLabels({ pointLabels, x, labelFontPx }) {
  const W = SPARK_VIEW_W;
  return (
    <div className="meet-sparkline-labels" aria-hidden="true">
      {pointLabels.map((lab, i) =>
        lab === null || lab === undefined ? null : (
          <span
            key={i}
            className={[
              "meet-sparkline-label",
              lab.win ? "is-win" : "",
              lab.mark ? "is-mark" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            style={{
              left: `${((x(i) / W) * 100).toFixed(2)}%`,
              ...(labelFontPx ? { fontSize: `${labelFontPx}px` } : {}),
            }}
          >
            {lab.text}
          </span>
        ),
      )}
    </div>
  );
}
