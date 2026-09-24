/**
 * RateWithBaseline - 率＋会場平均との比較バー（BOA-402、screens.md C-4）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 *
 * ## なぜ「率」だけを出さないか（ADR-0071）
 *
 * 会場によって逃げ率は20.3pt、グレードによって11.1pt開く。率をそのまま出すと
 * 「戸田での70%」と「尼崎での70%」が同じに見えてしまう。そこで会場・級別で
 * 補正した差分を求め、本日の会場・グレードのベースラインに足した「この選手」の
 * 見込みを併記する。
 *
 * ## 差分を数値で出さない（2026-09-24、ユーザー指摘で改訂）
 *
 * 当初は「地力 +36.6pt ▲」「津での予測 90.1%」と数値を2つ足していたが、
 * 実物を見て次の指摘を受けた。
 *   - 「地力」はボートレースでは普通「勝率・実力」の意味で、この指標名として通じない
 *   - 「pt」は得点率のポイントと読まれる
 *   - 同じ%の数字が2つ（実績88.2%／予測90.1%）並び、どちらを見ればよいか分からない
 * そこで**差分の数値と「地力」という語をUIから消し**、「会場の平均」→「この選手」の
 * 2本のバーで見せる（案2）。差分そのものは抽出・並び替えの内部計算には引き続き使う。
 * 「数値の羅列ではなくグラフ化することが本質」という既存の方針にも沿う。
 *
 * ## 母数は折りたたんでも隠さない
 *
 * 34走の88%と9走の88%は別物で、母数が見えない率は信用度を判断できない。
 * 母数と小標本の注意は `expanded=false` でも常に出す。確からしさの下限
 * （Wilson95%下限、plan.md §2.3.1）と直近90日だけを畳む。
 */
import "./RateWithBaseline.css";

/** 0〜100%の横バー1本 */
function RateBar({ label, value, emphasis = false }) {
  const pct = Math.max(0, Math.min(100, Number(value)));
  return (
    <div className="rate-baseline__bar-row">
      <span className="rate-baseline__bar-label">{label}</span>
      <span className="rate-baseline__bar-track">
        <span
          className={`rate-baseline__bar-fill${emphasis ? " rate-baseline__bar-fill--emphasis" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span
        className={`rate-baseline__bar-value${emphasis ? " rate-baseline__bar-value--emphasis" : ""}`}
      >
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

function RateWithBaseline({
  label,
  rate,
  predicted,
  venueName,
  sampleSize,
  isSmallSample = false,
  wilsonLower = null,
  rate90d = null,
  sampleSize90d = null,
  venueBaseline = null,
  expanded = true,
}) {
  return (
    <div className="rate-baseline">
      <div className="rate-baseline__headline">
        <span className="rate-baseline__label">{label}</span>
        <span className="rate-baseline__value">
          {Number(rate).toFixed(1)}
          <span className="rate-baseline__unit">%</span>
        </span>
        {/* 母数は畳まない（率の信用度を判断できなくなるため） */}
        <span className="rate-baseline__runs">（{sampleSize}走）</span>
        {isSmallSample && (
          <span className="rate-baseline__small-sample">
            ⚠ 母数が少なく振れ幅が大きい
          </span>
        )}
      </div>

      {(venueBaseline !== null || predicted !== null) && (
        <div className="rate-baseline__bars">
          {venueBaseline !== null && (
            <RateBar label={`${venueName}の平均`} value={venueBaseline} />
          )}
          {predicted !== null && predicted !== undefined && (
            <RateBar label="この選手" value={predicted} emphasis />
          )}
        </div>
      )}

      {expanded && (
        <div className="rate-baseline__meta">
          {wilsonLower !== null && (
            <span
              title="この母数だと、真の率は95%の確からしさでこの値以上と言える"
              className="rate-baseline__wilson"
            >
              信頼下限 {Number(wilsonLower).toFixed(1)}%
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
        </div>
      )}
    </div>
  );
}

export default RateWithBaseline;
