/**
 * MeetFormTrendCard が共通の推移の図（TrendChart）に描き足す物: その日の会場平均の破線（線の下）と、
 * 選んだ艇の日・R・枠・進入・値・着順の行（図の下に伸ばした同じ svg の中、各点の真下）。座標は図から受け取る（BOA-885 承認のモック）
 */
import { ROW_KEYS } from "./MeetFormTrendScales";

const ROW_H = 18;

const cellText = (t, metric, run, key) => {
  switch (key) {
    case "day":
      return t("beforeInfo.meetFormDay", {
        day: Number(run.date.slice(8, 10)),
      });
    case "race":
      return t("beforeInfo.meetFormRace", { no: run.raceNo });
    case "frame":
      return run.boatNumber ?? "—";
    case "course":
      return run.course ?? "—";
    case "value":
      return run.values[metric] === null
        ? t("beforeInfo.meetFormNoValue")
        : run.values[metric].toFixed(2);
    default:
      return run.finish ?? "—";
  }
};

/** その日の会場平均の破線。値の無い日は線を切る */
export function AvgLine({ sel, x, y, avgOf }) {
  const runs = [[]];
  sel.forEach((p, i) => {
    const v = avgOf(p.meetRun.date);
    if (v === null) runs.push([]);
    else runs[runs.length - 1].push(`${x(i, sel.length)},${y(v)}`);
  });
  return runs
    .filter((r) => r.length > 0)
    .map((pts) => (
      <polyline
        key={pts[0]}
        data-venue-avg
        className="mft-avg"
        points={pts.join(" ")}
      />
    ));
}

function Row({ rowKey, j, t, metric, boat, runs, W, x }) {
  const top = j * ROW_H;
  const base = top + ROW_H - 4;
  return (
    <g className="mft-row" data-boat={boat} data-row={rowKey}>
      <line className="mft-grid" x1={0} x2={W} y1={top} y2={top} />
      <text className="mft-axis" x={0} y={base}>
        {rowKey === "value"
          ? t(`beforeInfo.meetFormRowValue_${metric}`)
          : t(`beforeInfo.meetFormRow_${rowKey}`)}
      </text>
      {runs.map((run, i) => {
        const off =
          rowKey === "course" &&
          run.course !== null &&
          run.course !== run.boatNumber;
        const win = rowKey === "finish" && run.finish === 1;
        return (
          <text
            key={run.raceId}
            className={[
              "mft-cell",
              rowKey === "value" || rowKey === "finish" ? "is-strong" : "",
              off ? "is-course-off" : "",
              win ? "is-win" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            x={x(i, runs.length)}
            y={base}
            fontSize={rowKey === "finish" ? 11 : undefined}
            textAnchor="middle"
          >
            {cellText(t, metric, run, rowKey)}
          </text>
        );
      })}
    </g>
  );
}

/** 図の下の行の高さ（図の extraHeight） */
export const ROWS_HEIGHT = ROW_KEYS.length * ROW_H + 2;

/** 図の下の行。図と同じ svg の中で、図の下端 top から描き、横を点にそろえる */
export function RunRows({ t, metric, boat, sel, W, x, top }) {
  const runs = sel.map((p) => p.meetRun);
  return (
    <g className="mft-rows" transform={`translate(0 ${top})`}>
      {ROW_KEYS.map((key, j) => (
        <Row
          key={key}
          rowKey={key}
          j={j}
          t={t}
          metric={metric}
          boat={boat}
          runs={runs}
          W={W}
          x={x}
        />
      ))}
    </g>
  );
}
