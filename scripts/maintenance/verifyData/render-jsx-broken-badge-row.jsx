/**
 * verify-render-jsx.js の「1か所壊した部品」。verify ではない。
 * MotorStatBadgeRow と同じ形の行を描くが、バッジの文字を badge.text でなく badge.key にしてある。
 * 描いた結果の確かめ（checkBadgeRow）が、この壊れた部品では落ちることを示すために使う。
 */
export default function BrokenBadgeRow({ icon, label, badges }) {
  if (badges.length === 0) return null;

  return (
    <div className="motor-stat-badge-row">
      <span className="motor-stat-badge-row-label">
        {icon} {label}
      </span>
      <div className="motor-stat-badge-row-badges">
        {badges.map((badge) => (
          <span key={badge.key} className="motor-stat-badge-row-badge">
            {badge.key}
          </span>
        ))}
      </div>
    </div>
  );
}
