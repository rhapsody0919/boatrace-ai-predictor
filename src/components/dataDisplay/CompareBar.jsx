/**
 * 基準と比べる棒（見せ方の型1、意味づけ 2026-11-26 オーナー承認）。
 * 基準の線を中央に固定し、差（diff）の分だけ左右に伸ばす。±range を超えた差は端で切り ▶◀ を付ける。
 * 緑・赤と ▲▼ は dir が high/low（偶然の幅を超えた）ときだけ。良し悪しは better で決める
 * （1着率は高いほど良い "high"、ST は低いほど良い "low"）。▲▼ は高い・低いの向きを表す。
 * dir が "few"（走数が少ない）は点線の外枠、"unclear" は灰。判定は src/pure/compareBaseline.js。
 * 色だけに頼らない（3号艇の赤・6号艇の緑と取り違えないため ▲▼ を必ず添える。visual-designer 2026-11-26）。
 */
import { toneOf } from "../../pure/compareBaseline.js";
import "./CompareBar.css";

// 棒の位置（中央の基準から左右へ、±range で切る）
function geometry(diff, range) {
  const clipped = Math.max(-range, Math.min(range, diff));
  const half = (Math.abs(clipped) / range) * 50;
  return { half, left: clipped < 0 ? 50 - half : 50 };
}

// 偶然の幅を超えたときだけ ▲▼（範囲の外は ▶◀ を足す）。超えなければ印なし
function markOf(dir, diff, range) {
  if (dir !== "high" && dir !== "low") return null;
  const over = Math.abs(diff) > range ? (diff > 0 ? "▶" : "◀") : "";
  return `${dir === "high" ? "▲" : "▼"}${over}`;
}

export default function CompareBar({ diff, dir, better = "high", range = 30, baseLabel }) {
  if (typeof diff !== "number" || !Number.isFinite(diff)) return null;
  const kind = dir === "few" ? "few" : (toneOf(dir, better) ?? "unclear");
  const { half, left } = geometry(diff, range);
  const mark = markOf(dir, diff, range);
  const markSide = `calc(${50 + half}% + 2px)`;
  return (
    <span className={`compare-bar compare-bar--${kind}`} data-dir={dir ?? "none"}>
      <span className="compare-bar__track" aria-hidden="true">
        <span className="compare-bar__bar" style={{ left: `${left}%`, width: `${Math.max(half, 1)}%` }} />
        <span className="compare-bar__base" />
        {mark && (
          <span className="compare-bar__mark" style={diff > 0 ? { left: markSide } : { right: markSide }}>
            {mark}
          </span>
        )}
      </span>
      {baseLabel && <small className="compare-bar__base-label">{baseLabel}</small>}
    </span>
  );
}
