/**
 * RateWithBaseline - 率＋地力＋予測＋母数＋確信度の表示（BOA-402、screens.md C-4）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 *
 * ## なぜ「率」だけを出さないか（ADR-0071）
 *
 * 会場によって逃げ率は20.3pt、グレードによって11.1pt開く。率をそのまま出すと
 * 「戸田での70%」と「尼崎での70%」が同じに見えてしまう。そこで
 *   - 地力 = 実績率 − その選手が走った会場・グレード構成から期待される率
 *   - 予測 = 本日の会場・グレードのベースライン + 地力
 * の2つを併記する。前者が「この選手の性質」、後者が「今日このレースで起きそうなこと」。
 *
 * ## 確信度は下限値で見せる（plan.md §2.3.1）
 *
 * 二値の小標本フラグは実データで判別力を持たなかった（まくり100%・逃げ89.4%の行に
 * 立った）。母数が20未満のときだけ「母数が少ない」と明示し、確からしさは
 * Wilson95%下限を数値で併記する。下限は逃げで46.9〜78.0%と実際にばらつく。
 */
import "./RateWithBaseline.css";

function DeltaBadge({ value }) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  const positive = n >= 0;
  return (
    <span
      className={`rate-baseline__delta rate-baseline__delta--${positive ? "up" : "down"}`}
    >
      {/* 色だけに頼らず記号でも向きを示す（色覚特性への配慮） */}
      地力 {positive ? "+" : ""}
      {n.toFixed(1)}pt {positive ? "▲" : "▼"}
    </span>
  );
}

function RateWithBaseline({
  label,
  rate,
  skillDelta,
  predicted,
  venueName,
  sampleSize,
  isSmallSample = false,
  wilsonLower = null,
  rate90d = null,
  sampleSize90d = null,
  venueBaseline = null,
}) {
  return (
    <div className="rate-baseline">
      <div className="rate-baseline__main">
        <div className="rate-baseline__primary">
          <span className="rate-baseline__label">{label}</span>
          <span className="rate-baseline__value">
            {Number(rate).toFixed(1)}
            <span className="rate-baseline__unit">%</span>
          </span>
        </div>
        <div className="rate-baseline__side">
          <DeltaBadge value={skillDelta} />
          {predicted !== null && predicted !== undefined && (
            <span className="rate-baseline__predicted">
              {venueName}での予測{" "}
              <strong>{Number(predicted).toFixed(1)}%</strong>
            </span>
          )}
        </div>
      </div>

      <div className="rate-baseline__meta">
        <span>母数 {sampleSize}走</span>
        {wilsonLower !== null && (
          <span
            title="この母数だと、真の率は95%の確からしさでこの値以上と言える"
            className="rate-baseline__wilson"
          >
            信頼下限 {Number(wilsonLower).toFixed(1)}%
          </span>
        )}
        {venueBaseline !== null && (
          <span>
            {venueName}の平均 {Number(venueBaseline).toFixed(1)}%
          </span>
        )}
        {sampleSize90d !== null &&
          (rate90d !== null ? (
            <span>
              直近90日 <strong>{Number(rate90d).toFixed(1)}%</strong>（
              {sampleSize90d}走）
            </span>
          ) : (
            <span>
              直近90日 {sampleSize90d}走（母数が少なく率は出しません）
            </span>
          ))}
        {isSmallSample && (
          <span className="rate-baseline__small-sample">
            ⚠ 母数が少なく振れ幅が大きい
          </span>
        )}
      </div>
    </div>
  );
}

export default RateWithBaseline;
