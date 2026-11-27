/**
 * 展示の6艇の位置（見せ方の型3、意味づけ 2026-11-26 オーナー承認）。
 * 印の付く行（展示タイム・一周・半周ラップ・まわり足、2026-11-27 オーナー）をボタンで切り替え、
 * 1本の数直線に6艇の札を置く。左ほど速い。札は艇の色のまま、良し悪しの色は付けない
 * （良し悪しは表の ▲▼ が言う。ここは「どれだけ離れているか」だけを見せる）。
 * 近すぎて札が重なる艇は段を上げる。同じタイムは同じ位置に積む。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../utils/colors";

// 札の幅を線の長さの何％と見て重なりを避けるか（375px で約22px の札。目安、根拠なし）
const MIN_GAP_PCT = 9;

// 目盛りの刻み（秒）。目盛りが6本以下になる一番細かい物
const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1];
function ticksOf(min, max) {
  const step = STEPS.find((s) => Math.floor(max / s + 1e-9) - Math.ceil(min / s - 1e-9) + 1 <= 6) ?? 1;
  const out = [];
  for (let i = Math.ceil(min / step - 1e-9); i * step <= max + 1e-9; i += 1) {
    const v = Number((i * step).toFixed(2));
    out.push({ v, x: ((v - min) / (max - min)) * 100 });
  }
  return out;
}

// 速い順に並べ、位置（％）と段を決める。重なる札は空いている一番下の段へ
function place(points, min, max) {
  const lastX = [];
  return points.map((pt) => {
    const x = max === min ? 50 : ((pt.value - min) / (max - min)) * 100;
    let level = lastX.findIndex((lx) => x - lx >= MIN_GAP_PCT);
    if (level < 0) level = lastX.length;
    lastX[level] = x;
    return { ...pt, x, level };
  });
}

// 値のある艇を速い順に（表示の桁2で丸め、同じ値は艇番の順）
function pointsOf(values) {
  return [...(values ?? new Map())]
    .map(([boat, v]) => ({ boat, value: v?.value }))
    .filter((pt) => typeof pt.value === "number" && Number.isFinite(pt.value))
    .map((pt) => ({ ...pt, value: Number(pt.value.toFixed(2)) }))
    .sort((a, b) => a.value - b.value || a.boat - b.boat);
}

function DotsLine({ points }) {
  const min = points[0].value;
  const max = points[points.length - 1].value;
  const placed = place(points, min, max);
  const levels = Math.max(...placed.map((pt) => pt.level)) + 1;
  return (
    <>
      <div className="rbi-posdots-track" style={{ "--rbi-posdots-levels": levels }}>
        {placed.map((pt) => {
          const color = BOAT_COLORS[pt.boat] || {};
          return (
            <span
              key={pt.boat}
              className="rbi-posdots-chip"
              data-boat={pt.boat}
              data-value={pt.value.toFixed(2)}
              style={{
                left: `${pt.x}%`,
                bottom: `calc(${pt.level} * var(--rbi-posdots-step))`,
                background: color.bg,
                color: color.text,
              }}
              title={`${pt.boat}: ${pt.value.toFixed(2)}`}
            >
              {pt.boat}
            </span>
          );
        })}
      </div>
      <div className="rbi-posdots-scale">
        {ticksOf(min, max).map((tick) => (
          <span key={tick.v} className="rbi-posdots-tick" style={{ left: `${tick.x}%` }}>
            {tick.v.toFixed(2)}
          </span>
        ))}
      </div>
    </>
  );
}

/** @param {{rows: {key: string, label: string, values: Map<number, {value: number|null}>|undefined}[]}} props */
export default function ExhibitionPositionDots({ rows }) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState(null);
  // 2艇以上に違う値がある行だけ（全艇同値・1艇だけは位置に意味が無い）
  const usable = (rows ?? [])
    .map((row) => ({ ...row, points: pointsOf(row.values) }))
    .filter((row) => row.points.length >= 2 && row.points[0].value !== row.points.at(-1).value);
  if (usable.length === 0) return null;
  const selected = usable.find((row) => row.key === selectedKey) ?? usable[0];
  return (
    <figure className="rbi-posdots" data-testid="rbi-position-dots">
      <figcaption className="rbi-posdots-title">{t("beforeInfo.positionTitle")}</figcaption>
      {usable.length > 1 && (
        <div className="rbi-posdots-switch" role="group">
          {usable.map((row) => (
            <button
              key={row.key}
              type="button"
              className={`rbi-posdots-switch-btn${row.key === selected.key ? " is-active" : ""}`}
              aria-pressed={row.key === selected.key}
              onClick={() => setSelectedKey(row.key)}
            >
              {row.label}
            </button>
          ))}
        </div>
      )}
      <DotsLine key={selected.key} points={selected.points} />
    </figure>
  );
}
