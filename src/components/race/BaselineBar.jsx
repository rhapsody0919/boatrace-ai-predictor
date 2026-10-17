import "./BaselineBar.css";

/**
 * 割合の小さい棒（値・基準の点線）。思考アシストの「堅い？荒れる？」（RoughCard）、イン崩れ注意度のカード
 * （InCautionCard）、段ごとの実績（InCautionAccuracyChart）で共通（BOA-822、screens「部品の作り方」）。
 * 左に名前、真ん中に棒、右に数字（children）の3列。表のセルの2段の棒（src/components/common/RateBar.jsx、BOA-428）とは別の形。
 *
 * @param {{label?: import("react").ReactNode, rate: number, base?: number|null, children?: import("react").ReactNode}} props
 *   rate・base は 0〜1
 */
export default function BaselineBar({ label, rate, base = null, children }) {
  return (
    <span className="baseline-bar">
      <span>{label}</span>
      <span className="baseline-bar-track" aria-hidden="true">
        <span className="baseline-bar-fill" style={{ width: `${rate * 100}%` }} />
        {base !== null && (
          <span className="baseline-bar-base" style={{ left: `${base * 100}%` }} />
        )}
      </span>
      <span className="baseline-bar-num">{children}</span>
    </span>
  );
}
