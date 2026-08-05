/**
 * BoatChip - 艇番カラーチップ（ホームズ予想の各タブ共通）
 */
import { BOAT_COLORS } from "./boat-colors";
import "./BoatChip.css";

function BoatChip({ boatNumber }) {
  const c = BOAT_COLORS[boatNumber] || BOAT_COLORS[1];
  return (
    <span
      className="holmes-boat-chip"
      style={{ background: c.bg, borderColor: c.border, color: c.text }}
    >
      {boatNumber}
    </span>
  );
}

export default BoatChip;
