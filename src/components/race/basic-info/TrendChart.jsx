/**
 * 6艇の推移の線（オーナー 2026-11-24 承認のモック改訂3、docs/reference/design-system.md「表とグラフ」7）。
 * 横は各艇の走の順で右端が最新。選んだ艇だけ太線にし、その艇の日付の目盛りと休みの印を出す。
 * 偶然の幅の帯は付けない（オーナー決定）。軸は0から始めず値の幅に上下の余白を足す。
 * 見た目（trc- のクラス）は TrendChart.css。読み込みは使う側（BasicInfoTrend）が持つ。
 */
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { BOAT_COLORS } from "../../../utils/colors";
import { trendGapIndexes } from "../../../pure/racerTrendSeries.js";
import { trendScaleOf } from "../../../pure/trendMetricScale.js";
import { useChartWidth } from "./useChartWidth.js";
import TrendTooltip from "./TrendTooltip";
import { useChartPick } from "./useChartPick.js";
import { Badge, Line, EndLabels } from "./TrendChartLines.jsx";
import { H, PAD, BAND, FLAG_Y, fmtValue } from "./trendChartGeom.js";

// 勝率の段・モーターの推移が使う（線の部品は TrendChartLines.jsx）
export { Badge };

// 今節の走の図で、1走目を軸から離す幅（下の行の「まわり足」等の見出しが点の列と重ならない）
const ALIGN_START_INSET = 18;

const slash = (date) => `${Number(date.slice(5, 7))}/${date.slice(8, 10)}`;

function scaleOf(seriesByBoat, scale, W, extraValues = []) {
  // 値の無い点（フライング・出遅れ等。印だけ描く）は尺度に入れない。extraValues は重ね書きの値（会場平均など）
  const all = [
    ...[...seriesByBoat.values()].flat().map((p) => p.value),
    ...extraValues,
  ].filter((v) => v !== null && v !== undefined);
  const { step } = scale;
  // 負にならない指標（ST）は 0 より下に伸ばさない
  const lo = Math.max(
    scale.min ?? -Infinity,
    Math.floor(Math.min(...all) / step) * step - step,
  );
  const hi = Math.ceil(Math.max(...all) / step) * step + step;
  const n = Math.max(...[...seriesByBoat.values()].map((s) => s.length));
  // 平均ST は小さいほど良いので上に描く
  const y = (v) => {
    const r = (v - lo) / (hi - lo);
    // 印の帯（F・L）がある尺度は、値の線をその下から描く
    const top = PAD.t + (scale.flags ? BAND : 0);
    return top + (H - top - PAD.b) * (scale.invert ? r : 1 - r);
  };
  // 右端（最新）をそろえる。点の少ない艇は左を空ける。alignStart（今節の走）は各艇の1走目を左にそろえ、
  // 下の行の見出しの分だけ左を空ける
  const inset = scale.alignStart ? ALIGN_START_INSET : 0;
  const x = (i, len) =>
    PAD.l +
    inset +
    ((W - PAD.l - inset - PAD.r) * (scale.alignStart ? i : n - len + i)) /
      Math.max(1, n - 1);
  // 日付の横軸（今節タブの6艇の推移 R-43）: 点が横の位置 xr（0〜1）を持てば、走の順でなくその位置に置く。
  // 艇ごとに同じ日の点が同じ縦の列に並ぶ。xr の無い点は今までどおり
  const at = (r) => PAD.l + inset + (W - PAD.l - inset - PAD.r) * r;
  const xFor = (pts) => (i, len) =>
    pts[i]?.xr == null ? x(i, len) : at(pts[i].xr);
  const { tickStep } = scale;
  const ticks = [];
  for (
    let g = Math.ceil(lo / tickStep) * tickStep;
    g <= hi + 1e-9;
    g += tickStep
  )
    ticks.push(g);
  return { x, y, ticks, n, at, xFor };
}

/** 横の目盛りの線と左の数字（走ごとの線と勝率の段で共通） */
export function GridLines({ ticks, y, x1, x2, label }) {
  return ticks.map((g) => (
    <g key={g}>
      <line x1={x1} x2={x2} y1={y(g)} y2={y(g)} className="trc-grid" />
      <text x={x1 - 4} y={y(g) + 4} className="trc-tick" textAnchor="end">
        {label(g)}
      </text>
    </g>
  ));
}

// 縦軸の目盛りと頭の単位
function ValueAxis({ ticks, y, W, scale, t }) {
  return (
    <>
      <GridLines
        ticks={ticks}
        y={y}
        x1={PAD.l}
        x2={W - PAD.r}
        label={(g) =>
          // 目盛りの数字を間引く尺度（ST の 0.05 刻み）は、線は残して数字だけ1つおきに出す
          scale.labelEvery &&
          Math.round(g / scale.tickStep) % scale.labelEvery !== 0
            ? ""
            : fmtValue(g, scale.tickDigits, scale)
        }
      />
      {/* 平均ST は「秒（上ほど速い）」と向きも書く（visual-designer 11/24） */}
      <text
        x={scale.unitKey ? 2 : PAD.l - 4}
        y={PAD.t - 6}
        className="trc-tick"
        textAnchor={scale.unitKey ? "start" : "end"}
      >
        {scale.unitKey ? t(scale.unitKey) : scale.unit}
      </text>
    </>
  );
}

// 日付の横軸の目盛り（xTicks を渡す図だけ。走の順の目盛りの代わり）
function DateAxis({ xTicks, at }) {
  return xTicks.map((k) => (
    <text
      key={`${k.xr}-${k.label}`}
      x={at(k.xr)}
      y={H - 18}
      className="trc-tick"
      textAnchor="middle"
    >
      {k.label}
    </text>
  ));
}

// 横の目盛り。日付の横軸（xTicks）か、選んだ艇の走の日付・「最新」・休みの印
function XAxis({ xTicks, at, ...rest }) {
  return xTicks ? (
    <DateAxis xTicks={xTicks} at={at} />
  ) : (
    <SelectedAxis {...rest} />
  );
}

// 描く順。選んだ艇を最後に描いて上に出す
function drawOrder(seriesByBoat, selected) {
  const order = [...seriesByBoat.keys()].filter((b) => b !== selected);
  if (seriesByBoat.has(selected)) order.push(selected);
  return order;
}

// 選んだ艇の日付の目盛り・「最新」・休みの印
function SelectedAxis({ sel, selected, x, W, runAxisKey, n }) {
  const { t } = useTranslation();
  if (sel.length === 0) return null;
  // 今節の走の図は日付でなく「N走」（艇ごとに走ったレースは違う。日は図の下の行）
  if (runAxisKey)
    return (
      <g>
        {Array.from({ length: n }, (_, i) => (
          <text
            key={i}
            x={x(i, n)}
            y={H - 18}
            className="trc-tick"
            textAnchor="middle"
          >
            {t(runAxisKey, { n: i + 1 })}
          </text>
        ))}
      </g>
    );
  const marks = [
    0,
    Math.floor(sel.length / 3),
    Math.floor((sel.length * 2) / 3),
  ];
  return (
    <g>
      {marks.map((i) => (
        <text
          key={i}
          x={x(i, sel.length)}
          y={H - 18}
          className="trc-tick"
          textAnchor="middle"
        >
          {slash(sel[i].date)}
        </text>
      ))}
      <text
        x={W - PAD.r}
        y={H - 18}
        className="trc-tick trc-latest"
        textAnchor="middle"
      >
        {t("basicInfo.trend.latest")}
      </text>
      <Badge cx={PAD.l + 6} cy={H - 6} boat={selected} r={6} />
      <text x={PAD.l + 16} y={H - 2} className="trc-axisnote">
        {t("basicInfo.trend.axisNote")}
      </text>
      {trendGapIndexes(sel).map((i, k, all) => {
        const gx = (x(i - 1, sel.length) + x(i, sel.length)) / 2;
        // 前の空きの札と近い（70 より狭い）ときは1段下げる（くっついて1本の帯に読めた。visual-designer 11/26）
        const prev = k > 0 ? all[k - 1] : null;
        const gxPrev = prev
          ? (x(prev - 1, sel.length) + x(prev, sel.length)) / 2
          : -Infinity;
        const dy = gx - gxPrev < 70 && k % 2 === 1 ? 12 : 0;
        return (
          <g key={i}>
            <line
              x1={gx}
              x2={gx}
              y1={PAD.t}
              y2={H - PAD.b}
              className="trc-gap"
            />
            <Badge cx={gx - 40} cy={PAD.t - 8 + dy} boat={selected} r={6} />
            <text x={gx - 31} y={PAD.t - 4 + dy} className="trc-axisnote">
              {t("basicInfo.trend.gap", { days: sel[i].gapDays })}
            </text>
          </g>
        );
      })}
    </g>
  );
}

// 選んだ点の縦の点線と印、点を選ぶ当たりの面（図の中の全面、透明）。縦のスクロールは指に任せる
function PickLayer({ picked, px, y, selected, W, pointer, scale }) {
  return (
    <>
      {picked && (
        <g className="trc-pick">
          <line
            x1={px}
            x2={px}
            y1={PAD.t}
            y2={H - PAD.b}
            className="trc-pick-line"
          />
          {/* 値の無い走は印の帯がある尺度だけ帯に印。点の中に着順を描く尺度は着順を隠さない外の輪だけ */}
          {(picked.value != null || scale.flags) && (
            <circle
              cx={px}
              cy={picked.value == null ? FLAG_Y : y(picked.value)}
              r={scale.dotLabel ? 12 : 7.5}
              className="trc-pick-ring"
            />
          )}
          {(picked.value != null || scale.flags) && !scale.dotLabel && (
            <circle
              cx={px}
              cy={picked.value == null ? FLAG_Y : y(picked.value)}
              r={6}
              fill={BOAT_COLORS[selected].bg}
              className="trc-pick-dot"
            />
          )}
        </g>
      )}
      <rect
        className="trc-hit"
        x={PAD.l}
        y={PAD.t}
        width={W - PAD.l - PAD.r}
        height={H - PAD.t - PAD.b}
        fill="transparent"
        {...pointer}
      />
    </>
  );
}

// 選んだ艇の点を拾う（吹き出しの点と横の位置）
function useSelectedPick(sel, xSel, selected, W) {
  const boxRef = useRef(null);
  const { pick, close, handlers } = useChartPick({
    xs: sel.map((_, i) => xSel(i, sel.length)),
    key: selected,
    W,
    boxRef,
  });
  return {
    boxRef,
    pick,
    close,
    pointer: handlers,
    picked: pick ? sel[pick.i] : null,
    px: pick ? xSel(pick.i, sel.length) : 0,
  };
}

/**
 * @param {{ seriesByBoat: Map<number, Array<object>>, metric: string, selected: number,
 *   scale?: ReturnType<typeof trendScaleOf>, label?: string,
 *   renderOver?: (g: {x: Function, y: Function, W: number, pad: object, sel: Array<object>}) => any,
 *   renderBelow?: (g: {x: Function, W: number, pad: object, sel: Array<object>}) => any }} props
 *   scale を渡さなければ metric の既定の尺度。label は図の読み上げの名前（無ければ基本情報の題）。
 *   renderOver は線の下に重ねる SVG、renderBelow は図の下に描く物（どちらも図と同じ横の座標 x(i, len)）。
 *   extraValues は縦軸の範囲に含める重ね書きの値、lineClass は線の g に足すクラス（使う側の試験の当て先）。
 *   extraHeight は図の下に足す高さで、renderOver が y >= h に同じ svg の中で描く（今節の足の走の行）。
 *   xTicks（[{xr, label}]）は日付の横軸の目盛り。点の xr（0〜1）と breakBefore（走らない日をまたぐ）と組で使う
 */
export default function TrendChart({
  seriesByBoat,
  metric,
  selected,
  scale = trendScaleOf(metric),
  label,
  renderOver,
  renderBelow,
  extraValues,
  lineClass,
  extraHeight = 0,
  xTicks,
}) {
  const { t } = useTranslation();
  const [ref, W] = useChartWidth();
  const { x, y, ticks, n, at, xFor } = scaleOf(
    seriesByBoat,
    scale,
    W,
    extraValues,
  );
  const sel = seriesByBoat.get(selected) ?? [];
  const xSel = xFor(sel);
  const order = drawOrder(seriesByBoat, selected);
  const { boxRef, pick, close, pointer, picked, px } = useSelectedPick(
    sel,
    xSel,
    selected,
    W,
  );
  return (
    <div className="trc-chartbox" ref={boxRef}>
      <svg
        ref={ref}
        className="trc-svg"
        viewBox={`0 0 ${W} ${H + extraHeight}`}
        role="img"
        aria-label={
          label ??
          t("basicInfo.trend.title", {
            metric: t(`basicInfo.metrics.${metric}`),
          })
        }
      >
        <ValueAxis ticks={ticks} y={y} W={W} scale={scale} t={t} />
        <XAxis
          {...{ xTicks, at, sel, selected, x, W, n }}
          runAxisKey={scale.runAxisKey}
        />
        {/* 使う側が線の下に重ねる物（会場平均の線など）。座標は図と同じ */}
        {renderOver?.({ x, y, W, h: H, pad: PAD, sel })}
        {order.map((boat) => (
          <Line
            key={boat}
            points={seriesByBoat.get(boat)}
            boat={boat}
            selected={boat === selected}
            x={xFor(seriesByBoat.get(boat))}
            y={y}
            scale={scale}
            lineClass={lineClass}
          />
        ))}
        <EndLabels
          seriesByBoat={seriesByBoat}
          selected={selected}
          xFor={xFor}
          y={y}
          scale={scale}
          W={W}
        />
        <PickLayer
          picked={picked}
          px={px}
          y={y}
          selected={selected}
          W={W}
          pointer={pointer}
          scale={scale}
        />
      </svg>
      {renderBelow?.({ x, W, pad: PAD, sel })}
      {picked && (
        <TrendTooltip
          point={picked}
          metric={metric}
          scale={scale}
          leftPct={(px / W) * 100}
          pinned={pick.pinned}
          onClose={close}
        />
      )}
    </div>
  );
}
