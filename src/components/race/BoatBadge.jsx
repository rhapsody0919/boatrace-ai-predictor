/**
 * BoatBadge - 艇番の丸バッジ（公式配色 BOAT_COLORS の bg/text で塗る）
 *
 * サイズは size prop（xs/sm/md/lg、既定 md）で選ぶ。個別画面で既定と違う寸法が
 * 必要な場合は、呼び出し側のCSSで --boat-badge-size を上書きする
 * （例: .my-lane { --boat-badge-size: 2.2rem }）。
 *
 * 艇番と色の対応そのものを表す要素専用。艇番色を意図的に使わない画面
 * （MotorWakuStatsGridの進入コースバッジ等）や、表の列見出しセル全体を
 * 艇番色で塗る用途（DataRaceTable等）には使わない。
 */
import { BOAT_COLORS } from "../../utils/colors";
import "./BoatBadge.css";

function BoatBadge({ number, size = "md", className = "" }) {
  const color = BOAT_COLORS[number] || {};
  const classes = [
    "boat-badge",
    size !== "md" && `boat-badge-${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      style={{ background: color.bg, color: color.text }}
    >
      {number}
    </span>
  );
}

export default BoatBadge;
