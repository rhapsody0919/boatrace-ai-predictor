/**
 * PC（1024px 以上）で、図を左（画面の高さに収まるときは上に止める）、押して変わる結果を右に並べる
 * （BOA-813、承認モック sonar-tab/mock-pc-v1）。狭い画面では囲みが無いのと同じ縦並び（display: contents）
 * @param {{fig: import("react").ReactNode, children: import("react").ReactNode}} props
 */
export default function AnalogySplit({ fig, children }) {
  return (
    <div className="af-split">
      <div className="af-split-fig">{fig}</div>
      <div className="af-split-side">{children}</div>
    </div>
  );
}
