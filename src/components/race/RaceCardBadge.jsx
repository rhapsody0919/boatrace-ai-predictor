/**
 * RaceCardBadge - RaceCardヘッダーのバッジ共通スタイル
 */

function RaceCardBadge({
  color,
  children,
  padding = "0.2rem 0.55rem",
  borderRadius = "8px",
  letterSpacing = "0.02em",
}) {
  return (
    <span
      style={{
        padding,
        borderRadius,
        fontSize: "0.7rem",
        fontWeight: "700",
        background: color,
        color: "#fff",
        letterSpacing,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export default RaceCardBadge;
