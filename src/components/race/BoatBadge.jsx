import { BOAT_COLORS } from "../../utils/colors";
import "./BoatBadge.css";

/**
 * 艇番バッジ（公式の艇色の丸）。サイズは既定・sm・xs。
 * オッズ一覧タブ（RaceOddsListTab）から切り出して共用する（BOA-271）。クラス名は
 * 切り出し前の rol- のまま（見た目と e2e のセレクタを変えないため。App.css の .boat-badge とは別物）
 */
export default function BoatBadge({ n, size }) {
  const color = BOAT_COLORS[n] || {};
  return (
    <span
      className={`rol-boat-badge${size ? ` rol-boat-badge-${size}` : ""}`}
      style={{ background: color.bg, color: color.text }}
    >
      {n}
    </span>
  );
}
