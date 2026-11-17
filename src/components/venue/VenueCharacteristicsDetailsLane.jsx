import { BOAT_COLORS } from "../../utils/colors";

export default function Lane({ boat }) {
  const color = BOAT_COLORS[boat] ?? {};
  return (
    <span
      className="venue-details-lane"
      style={{ background: color.bg, color: color.text }}
    >
      {boat}
    </span>
  );
}
