import "./RateBar.css";

/**
 * セルの中に値ラベルと横棒を出す小さな部品（BOA-428）。
 *
 * レース詳細の6艇表（公式2連率、塗りは艇色）と、分析ツールの「モーターランキング」
 * （2連率、塗りは中立色）で使う。良し悪しで棒を塗り分けない（UI統一ルール R4）。
 * 最良は値ラベルで示す（`best`。同じ値の最良が複数あれば、どれも true）。見た目は共通クラス
 * `.ind-best`（src/styles/indicators.css、UI統一ルール R1）。
 *
 * 値ラベルを上、細い棒を下に置く2段にする。棒の上に札を重ねる形だと、375px（棒は約56px）で
 * 札（約44px）が棒の大半を隠し、長さの差が読めなかった。文字を棒の塗りの上に直接書く形は、
 * 艇色（2号艇の黒・4号艇の青）の上で読めない
 *
 * @param {object} props
 * @param {number|null} props.value 棒の長さに使う値
 * @param {number|null} props.max 全長にする値（0・null なら棒を描かない）
 * @param {string} props.fill 塗りの色（CSS の値）
 * @param {boolean} [props.best] 最良の値か
 * @param {import("react").ReactNode} props.label 値ラベル（桁は呼び出し側で決める）
 */
export default function RateBar({ value, max, fill, best = false, label }) {
  const ratio =
    value !== null && value !== undefined && max > 0
      ? Math.min(Math.max(Number(value) / max, 0), 1)
      : null;
  return (
    <div className="rate-bar">
      <span className={`rate-bar-label${best ? " is-best ind-best" : ""}`}>
        {label}
      </span>
      <div className="rate-bar-track">
        {ratio !== null && (
          <div
            className="rate-bar-fill"
            style={{ width: `${(ratio * 100).toFixed(2)}%`, background: fill }}
          />
        )}
      </div>
    </div>
  );
}
