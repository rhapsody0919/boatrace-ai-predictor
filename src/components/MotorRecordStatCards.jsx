import "./MotorRecordStatCards.css";

/**
 * モーター単体の通算成績（優出数・優勝数・1着率）を、比較表のような
 * 一覧性は不要な単一モーターのドリルダウン画面向けに、大きな数字＋
 * ラベルのカードとして見せる（BOA-264、kyoteibiyori比較を踏まえた
 * 「似せた上での昇華」対応）。RacerPerformanceStats.jsxの数値カードと
 * 似た視覚言語だが、データ形状が異なるため独立コンポーネントとして持つ
 */
export default function MotorRecordStatCards({ cards }) {
  if (cards.length === 0) return null;

  return (
    <div className="motor-record-stat-cards">
      {cards.map((card) => (
        <div className="motor-record-stat-card" key={card.key}>
          <div className="motor-record-stat-value">{card.value}</div>
          <div className="motor-record-stat-label">{card.label}</div>
        </div>
      ))}
    </div>
  );
}
