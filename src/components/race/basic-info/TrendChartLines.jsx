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

// 値の無い走を挟む前後を点線でつなぐ区間（今節の走の図、BOA-885 承認のモック）
function bridgesOf(points, x, y) {
  const idx = points.flatMap((p, i) => (p.value == null ? [] : [i]));
  const at = (i) => `${x(i, points.length)},${y(points[i].value)}`;
  return idx.slice(1).flatMap((to, k) => {
    const from = idx[k];
    return to - from > 1 ? [`${at(from)} ${at(to)}`] : [];
  });
}

// 選んだ艇の点の中の着順（1着は金）。着順の無い走は点だけ
function DotMarks({ points, boat, x, y }) {
  return points.map((p, i) =>
    p.value == null ? null : (
      <g key={`m${p.raceId}`} className="trc-mark">
        <circle
          cx={x(i, points.length)}
          cy={y(p.value)}
          r={9}
          className="trc-mark-dot"
          stroke={BOAT_COLORS[boat].bg}
        />
        <text
          x={x(i, points.length)}
          y={y(p.value) + 4}
          textAnchor="middle"
          className={p.mark === 1 ? "trc-mark-text is-win" : "trc-mark-text"}
        >
          {p.mark ?? "—"}
        </text>
      </g>
    ),
  );
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

export function Line({ points, boat, selected, x, y, scale, lineClass }) {
  const segs = segmentsOf(points, x, y);
  const w = selected ? 3 : 1.4;
  // 1走ごとの生の値は6本が重なって塊になるので、選んでいない艇を薄くする（visual-designer 11/26）
  const dim = scale.dimOthers && !selected;
  // lineClass は使う側の試験・撮影の当て先（今節の足の mft-series）。選んだ艇に is-active
  const cls = lineClass
    ? ` ${lineClass}${selected ? " is-active" : ""}`
    : "";
  return (
    <g
      className={`trc-line trc-line-${boat}${cls}`}
      data-boat={lineClass ? boat : undefined}
      opacity={dim ? 0.35 : undefined}
    >
      {/* 1号艇の白・2号艇の黒は地に溶けるので縁を付ける */}
      {(boat === 1 || boat === 2) &&
        (!dim || scale.dimHalo) &&
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
      {scale.bridgeGaps &&
        bridgesOf(points, x, y).map((d) => (
          <polyline
            key={`b${d}`}
            className="trc-stroke trc-bridge"
            points={d}
            fill="none"
            strokeWidth={w}
            strokeDasharray="3 4"
          />
        ))}
      {scale.dotLabel && selected && (
        <DotMarks points={points} boat={boat} x={x} y={y} />
      )}
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
        {/* 点の中に着順を描く図（dotLabel）は、選んだ艇の右端の点で着順を隠さない */}
        {!e.flag && !(scale.dotLabel && e.boat === selected) && (
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
