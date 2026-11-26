/**
 * 推移の図（TrendChart）の線と右端の札。図の大きさの関所（1ファイル400行）のため TrendChart.jsx から分けた。
 * 尺度（src/pure/trendMetricScale.js）の flags・dimOthers・dots・dropZero で、走ごとの生の値の図（R-36 の ST、11/26）
 * だけ見え方を変える。率・平均ST の図は今までどおり。
 */
import { BOAT_COLORS } from "../../../utils/colors";
import { PAD, FLAG_Y, fmtValue } from "./trendChartGeom.js";

export function Badge({ cx, cy, boat, r = 7 }) {
  const c = BOAT_COLORS[boat];
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={c.bg} stroke="#9ca3af" />
      <text
        x={cx}
        y={cy + r / 2}
        fontSize={r + 2}
        fontWeight="700"
        textAnchor="middle"
        fill={c.text}
      >
        {boat}
      </text>
    </g>
  );
}

// 値の無い点で線を切る（フライング・出遅れの走など）
function segmentsOf(points, x, y) {
  const segs = [[]];
  points.forEach((p, i) => {
    if (p.value === null || p.value === undefined) segs.push([]);
    else segs[segs.length - 1].push(`${x(i, points.length)},${y(p.value)}`);
  });
  return segs.filter((g) => g.length > 0).map((g) => g.join(" "));
}

// 帯の印。選んだ艇は艇の色の枠の札、ほかの艇は小さな点（線の切れ目の理由を見せる）
function Flags({ points, boat, selected, x }) {
  return points.map((p, i) =>
    p.flag ? (
      selected ? (
        <g key={p.raceId} className={`trc-flag trc-flag-${p.flag}`}>
          <rect
            x={x(i, points.length) - 6}
            y={FLAG_Y - 7}
            width={12}
            height={14}
            rx={3}
            className="trc-flag-tag"
            stroke={BOAT_COLORS[boat].bg}
          />
          <text x={x(i, points.length)} y={FLAG_Y + 4} textAnchor="middle">
            {p.flag}
          </text>
        </g>
      ) : (
        <circle
          key={p.raceId}
          cx={x(i, points.length)}
          cy={FLAG_Y}
          r={2}
          fill={BOAT_COLORS[boat].bg}
          opacity={0.4}
        />
      )
    ) : null,
  );
}

export function Line({ points, boat, selected, x, y, scale }) {
  const segs = segmentsOf(points, x, y);
  const w = selected ? 3 : 1.4;
  // 1走ごとの生の値は6本が重なって塊になるので、選んでいない艇を薄くする（visual-designer 11/26）
  const dim = scale.dimOthers && !selected;
  return (
    <g className={`trc-line trc-line-${boat}`} opacity={dim ? 0.35 : undefined}>
      {/* 1号艇の白・2号艇の黒は地に溶けるので縁を付ける */}
      {(boat === 1 || boat === 2) &&
        !dim &&
        segs.map((d) => (
          <polyline
            key={`h${d}`}
            className="trc-halo"
            points={d}
            fill="none"
            strokeWidth={w + 1.4}
          />
        ))}
      {segs.map((d) => (
        <polyline
          key={d}
          className="trc-stroke"
          points={d}
          fill="none"
          strokeWidth={w}
        />
      ))}
      {scale.dots &&
        selected &&
        points.map((p, i) =>
          p.value == null ? null : (
            <circle
              key={`d${p.raceId}`}
              cx={x(i, points.length)}
              cy={y(p.value)}
              r={2}
              fill={BOAT_COLORS[boat].bg}
              stroke="#9ca3af"
              strokeWidth={0.5}
            />
          ),
        )}
      {scale.flags && (
        <Flags points={points} boat={boat} selected={selected} x={x} />
      )}
    </g>
  );
}

// 右端の札の1艇ぶん。最新の走が F・L なら値でなく印を出す（直前の値を最新に読ませない。visual-designer 11/26、
// 選んでいない艇もそろえる。ファン評価 11/26）。右端に値が無く印も無いときは値のある最後の点から点線で引く
function endOf(boat, s) {
  const last = s[s.length - 1];
  const i = s.findLastIndex((p) => p.value !== null && p.value !== undefined);
  if (last.value == null && last.flag)
    return { boat, flag: last.flag, at: s.length - 1, len: s.length };
  return {
    boat,
    v: s[i]?.value,
    at: i,
    len: s.length,
    stale: i < s.length - 1,
  };
}

export function EndLabels({ seriesByBoat, selected, x, y, scale, W }) {
  const yOf = (e) => (e.flag ? FLAG_Y : y(e.v));
  const ends = [...seriesByBoat.entries()]
    .map(([boat, s]) => endOf(boat, s))
    .filter((e) => e.at >= 0)
    .sort((a, b) => yOf(a) - yOf(b));
  let last = -99;
  const lx = W - PAD.r + 14;
  return ends.map((e) => {
    const py = yOf(e);
    const yy = Math.max(py, last + 16);
    last = yy;
    const px = x(e.at, e.len);
    return (
      <g key={e.boat}>
        {!e.flag && (
          <circle
            cx={px}
            cy={py}
            r={e.boat === selected ? 4.5 : scale.dimOthers ? 2 : 3}
            fill={BOAT_COLORS[e.boat].bg}
            stroke="#9ca3af"
          />
        )}
        <line
          x1={px + 4}
          y1={py}
          x2={lx - 8}
          y2={yy}
          className="trc-leader"
          strokeDasharray={e.stale ? "2 2" : undefined}
        />
        <Badge cx={lx} cy={yy} boat={e.boat} />
        <text
          x={lx + 10}
          y={yy + 4}
          className={`trc-end${e.flag ? ` trc-end-flag trc-flag-${e.flag}` : ""}`}
          fontWeight={e.boat === selected ? 700 : 400}
        >
          {e.flag ?? fmtValue(e.v, scale.digits, scale)}
        </text>
      </g>
    );
  });
}
