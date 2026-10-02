import "./RateBar.css";

/**
 * セルの中に横棒と値ラベルを出す小さな部品（BOA-428）。
 *
 * レース詳細の6艇表（公式2連率、塗りは艇色）と、分析ツールの「モーターランキング」
 * （2連率、塗りは中立色）で使う。良し悪しで棒を塗り分けない（UI統一ルール R4）。
 * 最良は値ラベルで示す（`best`。同じ値の最良が複数あれば、どれも true）。
 *
 * 値ラベルは棒の右端に重ねた札にする。札の背景を `--surface-card` にして、2号艇（黒）・
 * 4号艇（青）の塗りの上でも読めるようにする。札を棒の外に出すと、375px で6艇表の列幅が
 * 約36px増え、会場内順位まで横スクロールなしで入らなくなる（モックで実測）。
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
      {ratio !== null && (
        <div
          className="rate-bar-fill"
          style={{ width: `${(ratio * 100).toFixed(2)}%`, background: fill }}
        />
      )}
      <span className={`rate-bar-label${best ? " is-best ind-best" : ""}`}>
        {label}
      </span>
    </div>
  );
}
