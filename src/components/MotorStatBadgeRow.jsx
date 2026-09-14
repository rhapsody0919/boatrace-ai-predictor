import "./MotorStatBadgeRow.css";

/**
 * モーター関連の数値をラベル+丸みバッジで表示する共通行（BOA-264）。
 * MotorConditionChart.jsx（分析ツールのドリルダウン）とRacerMotorStatusCard.jsx
 * （選手ページ）の両方で、鮮度（節数・出走回数）と通算成績（優出・優勝・1着率）の
 * 2種類の表示に使う。会場公式サイトの公開項目差により値が欠けることがあるため、
 * badgesが空なら何も描画しない
 */
export default function MotorStatBadgeRow({ icon, label, badges }) {
  if (badges.length === 0) return null;

  return (
    <div className="motor-stat-badge-row">
      <span className="motor-stat-badge-row-label">
        {icon} {label}
      </span>
      <div className="motor-stat-badge-row-badges">
        {badges.map((badge) => (
          <span key={badge.key} className="motor-stat-badge-row-badge">
            {badge.text}
          </span>
        ))}
      </div>
    </div>
  );
}
