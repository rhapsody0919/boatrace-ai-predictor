import { useState } from "react";
import { baseVerdict } from "../../../utils/assistModel";
import { wilsonInterval } from "../../../utils/wilson";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const pct0 = (v) => Math.round(v * 100);
const pct1 = (v) => (v * 100).toFixed(1);
const comma = (n) => n.toLocaleString("ja-JP");

/**
 * 基準つきバー（spec D-21）と普通のバー（base を渡さない）。値・ぶれ幅・全国の全レースの太い点線・
 * 参考の細い点線（refRate）・3段階の言葉。件数・ぶれ幅・ポイント差はバーを押すと開く（D-32）。
 * 件数が0なら出さない（Codex U02）。few のときは高め・低めを付けず「件数少なめ」（D-37）。
 * labelRate=false は名前の横の割合を出さない（右端の割合だけ。決まり手の棒のように同じ割合を2回書かない）
 */
export default function BaseBar({
  label,
  k,
  n,
  base = null,
  refRate = null,
  few = false,
  labelRate = true,
}) {
  const [open, setOpen] = useState(false);
  if (!n) return null;
  const v = base == null ? null : baseVerdict(k, n, base);
  const [lo, hi] = v ? [v.lo, v.hi] : wilsonInterval(k, n);
  const rate = k / n;
  const verdict = v && !few ? v.verdict : null;
  return (
    <div className="ta-bar">
      <button
        type="button"
        className="ta-bar-btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ta-bar-label">
          {label} {labelRate && <b className="ta-num">{pct1(rate)}%</b>}{" "}
          {verdict && (
            <span
              className={`ta-tag${verdict === "unclear" ? "" : " ta-tag-hit"}`}
            >
              {ASSIST_COPY.verdict[verdict]}
            </span>
          )}
          {v && few && <span className="ta-tag">{ASSIST_COPY.roughFew}</span>}
        </span>
        <span className="ta-bar-track" aria-hidden="true">
          <span className="ta-bar-fill" style={{ width: `${rate * 100}%` }} />
          <span
            className="ta-bar-ci"
            style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }}
          />
          {base != null && (
            <span className="ta-baseline" style={{ left: `${base * 100}%` }} />
          )}
          {refRate != null && (
            <span
              className="ta-bar-ref"
              style={{ left: `${refRate * 100}%` }}
            />
          )}
        </span>
        <span className="ta-num" style={{ textAlign: "right" }}>
          {pct0(rate)}%
        </span>
      </button>
      {open && (
        <p className="ta-bar-more ta-num">
          {v
            ? ASSIST_COPY.baseMore(
                pct1(base),
                Number(((rate - base) * 100).toFixed(1)),
                comma(k),
                comma(n),
                pct0(lo),
                pct0(hi),
              )
            : `${comma(k)}/${comma(n)}件・ぶれ幅${pct0(lo)}〜${pct0(hi)}%`}
        </p>
      )}
    </div>
  );
}
