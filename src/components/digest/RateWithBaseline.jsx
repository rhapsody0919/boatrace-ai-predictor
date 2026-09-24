/**
 * RateWithBaseline - 会場平均とこの選手の見込みの比較バー（BOA-402、screens.md C-4）
 *
 * 逃げ／まくり／逃がしの3セクションで使い回す。
 *
 * ## なぜ数値が2つ要るか（ADR-0071）
 *
 * 会場によって逃げ率は20.3pt、グレードによって11.1pt開く。実績率をそのまま出すと
 * 「戸田での70%」と「尼崎での70%」が同じに見える。そこで
 *   - 全国での実績率（その選手が走った全会場ぶん）
 *   - 本日の会場・級別での見込み（会場・級別の平均 + 会場構成で補正した差分）
 * の2つを出す。実測（`morning_digest_rows` 3日分の逃げ75行）で両者の差は平均4.3pt・
 * 最大15.3pt あり、**戸田1Rの上野真之介は全国実績78.9%（57走）に対し戸田での見込み
 * 63.7%**（戸田の平均が39.5%しかないため）。競合は前者しか出さないので、この差が
 * このページの価値そのものであり、片方だけにはできない。
 *
 * ## 「88.2%と90.1%は何が違うのか」への対処（2026-09-24、ユーザー指摘で再改訂）
 *
 * 当初は「地力 +36.6pt」というバッジで差分を数値で出し、指摘を受けて会場平均との
 * 比較バーに替えた。それでもなお「逃げ率88.2%」と「この選手90.1%」が何故違うのか
 * 分からない、という指摘が残った。原因は**どちらも「率」としか書いておらず、対象範囲
 * （全国なのか、この会場なのか）が示されていない**こと。そこで
 *   - 見出しを「◯◯での逃げ率（1コース）」とし、**バー2本が会場の話だと明示する**
 *   - バーは「◯◯の平均」と「この選手」の2本だけにする（同じ土俵の2値）
 *   - 全国での実績率は**バーから外し、根拠の1行**として下に置く
 * とした。「全国では88.2%、津なら90.1%」と読める形にするのが狙い。
 *
 * ## 母数は折りたたんでも隠さない
 *
 * 34走の88%と9走の88%は別物で、母数の見えない率は信用度を判断できない。
 * 母数は根拠行に常に出す。畳むのは確からしさの下限（Wilson95%下限、plan.md §2.3.1）と
 * 直近90日だけ。
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
  const hasPredicted = predicted !== null && predicted !== undefined;

  return (
    <div className="rate-baseline">
      {/* 「◯◯での」を見出しに出すことで、下のバー2本が会場の話だと分かるようにする */}
      <p className="rate-baseline__label">
        {venueName}での{label}
      </p>

      {(venueBaseline !== null || hasPredicted) && (
        <div className="rate-baseline__bars">
          {venueBaseline !== null && (
            <RateBar label={`${venueName}の平均`} value={venueBaseline} />
          )}
          {hasPredicted && (
            <RateBar label="この選手" value={predicted} emphasis />
          )}
        </div>
      )}

      {/* 全国での実績は「見込みの根拠」。バーに混ぜると同じ土俵の値に見えてしまう */}
      <p className="rate-baseline__source">
        全国{sampleSize}走の実績は <strong>{Number(rate).toFixed(1)}%</strong>
        {isSmallSample && (
          <span className="rate-baseline__small-sample">
            ⚠ 母数が少なく振れ幅が大きい
          </span>
        )}
      </p>

      {expanded && (
        <div className="rate-baseline__meta">
          {wilsonLower !== null && (
            <span
              title="この母数だと、全国での実績の真の率は95%の確からしさでこの値以上と言える"
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
