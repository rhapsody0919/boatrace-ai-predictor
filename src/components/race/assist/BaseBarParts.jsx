import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

const pct0 = (v) => Math.round(v * 100);
const pct1 = (v) => (v * 100).toFixed(1);
const comma = (n) => n.toLocaleString("ja-JP");

export function BaseBarLabel({
  label,
  rate,
  base,
  v,
  few,
  verdict,
  labelRate,
  showBase,
}) {
  return (
    <span className="ta-bar-label">
      {label} {labelRate && <b className="ta-num">{pct1(rate)}%</b>}
      {showBase && base != null && (
        <span className="ta-num">{ASSIST_COPY.baseInline(pct0(base))}</span>
      )}{" "}
      {verdict && (
        <span className={`ta-tag${verdict === "unclear" ? "" : " ta-tag-hit"}`}>
          {ASSIST_COPY.verdict[verdict]}
        </span>
      )}
      {v && few && <span className="ta-tag">{ASSIST_COPY.roughFew}</span>}
    </span>
  );
}

export function BaseBarTrack({ rate, lo, hi, base, refRate }) {
  return (
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
        <span className="ta-bar-ref" style={{ left: `${refRate * 100}%` }} />
      )}
    </span>
  );
}

export function BaseBarValue({ rate, open }) {
  return (
    <span className="ta-num" style={{ textAlign: "right" }}>
      {pct0(rate)}%
      {/* 押すと件数とぶれ幅が開くことの手がかり（PR4 の UI/UX デザイナーのレビュー P2-6） */}
      <span className="ta-bar-more-mark" aria-hidden="true">
        {open ? "▾" : "›"}
      </span>
    </span>
  );
}

export function BaseBarMore({ v, k, n, rate, base, lo, hi }) {
  return (
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
  );
}
