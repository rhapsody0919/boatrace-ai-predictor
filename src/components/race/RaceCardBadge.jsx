/**
 * RaceCardBadge - RaceCardヘッダーのバッジ共通スタイル
 */

function RaceCardBadge({
  color,
  children,
  padding = "0.2rem 0.55rem",
  borderRadius = "8px",
  letterSpacing = "0.02em",
  // outline: 塗りでなく枠線だけ（塗りのバッジより目立たせない補足。BOA-543「返還あり」）
  variant = "solid",
}) {
  const isOutline = variant === "outline";
  return (
    <span
      style={{
        padding,
        borderRadius,
        fontSize: "0.7rem",
        fontWeight: "700",
        background: isOutline ? "transparent" : color,
        color: isOutline ? color : "#fff",
        border: isOutline ? `1px solid ${color}` : undefined,
        letterSpacing,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export default RaceCardBadge;
