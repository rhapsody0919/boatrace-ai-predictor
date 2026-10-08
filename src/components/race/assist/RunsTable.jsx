import { Link } from "react-router-dom";
import { STADIUM_NAMES } from "../../../constants";
import {
  finishClass,
  finishOf,
  monthDay as md,
  runPoints,
} from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";

const raceNo = (run) => Number(run.raceId.slice(14, 16));
const st2 = (run) => {
  const v = run.startTiming ?? run.flyingStartTiming;
  if (v == null) return "—";
  const s = `.${String(Math.round(Math.abs(v) * 100)).padStart(2, "0")}`;
  return run.flyingStartTiming != null ? `F${s}` : s;
};
/**
 * 1走ずつの表（FR-5・D-29・D-34）。今節の各走（日・R・進入・ST・展示・着・点、今日の走は灰色で点は「—」）と
 * 平均の計算、今節より前の5走（日付・場・R・進入・ST・着）、今節タブへの導線
 * @param {{meet: ReturnType<import("../../../utils/assistSummary").meetRuns>, prior: object[], venue: string, raceId: string, boat: number}} props
 */
export default function RunsTable({ meet, prior, venue, raceId, boat }) {
  const row = (run, today) => {
    const f = finishOf(run);
    const pts = runPoints(run, today);
    return (
      <tr key={run.raceId} className={today ? "ta-run-today" : undefined}>
        <td>{today ? C.todayRow : md(run.date)}</td>
        <td className="ta-num">{raceNo(run)}R</td>
        <td className="ta-num">{run.entryCourse ?? "—"}</td>
        <td className="ta-num">{st2(run)}</td>
        <td className="ta-num">
          {run.exhibitionTime == null
            ? "—"
            : Number(run.exhibitionTime).toFixed(2)}
        </td>
        <td className={`ta-num${today ? "" : finishClass(f)}`}>
          {f ?? run.finishMark ?? "—"}
        </td>
        <td className="ta-num">{pts ?? "—"}</td>
      </tr>
    );
  };
  return (
    <div className="ta-runs">
      <table className="ta-table ta-table-runs">
        <caption>
          {C.captionMeet(venue)}
        </caption>
        <thead>
          <tr>
            <th scope="col">{C.colDay}</th>
            <th scope="col">{C.colRace}</th>
            <th scope="col">{C.colCourse}</th>
            <th scope="col">{C.colSt}</th>
            <th scope="col">{C.colExh}</th>
            <th scope="col">{C.colFinish}</th>
            <th scope="col">{C.colPoints}</th>
          </tr>
        </thead>
        <tbody>
          {meet.today.map((r) => row(r, true))}
          {/* 新しい順（承認モック v7。今節より前の5走と同じ並び） */}
          {[...meet.past].reverse().map((r) => row(r, false))}
          {meet.avg != null && (
            <tr>
              <td colSpan={7} className="ta-num ta-run-avg">
                <b>{C.avgRow(meet.avg.toFixed(2), meet.sum, meet.count)}</b>
                {C.avgNote}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <table className="ta-table ta-table-runs">
        <caption>{C.captionPrior}</caption>
        <thead>
          <tr>
            <th scope="col">{C.colDate}</th>
            <th scope="col">{C.colVenue}</th>
            <th scope="col">{C.colRace}</th>
            <th scope="col">{C.colCourse}</th>
            <th scope="col">{C.colSt}</th>
            <th scope="col">{C.colFinish}</th>
          </tr>
        </thead>
        <tbody>
          {prior.map((r) => {
            const f = finishOf(r);
            return (
              <tr key={r.raceId}>
                <td>{md(r.date)}</td>
                <td>{STADIUM_NAMES[r.venueCode] ?? "—"}</td>
                <td className="ta-num">{raceNo(r)}R</td>
                <td className="ta-num">{r.entryCourse ?? "—"}</td>
                <td className="ta-num">{st2(r)}</td>
                <td className={`ta-num${finishClass(f)}`}>
                  {f ?? r.finishMark ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="ta-note">{C.courseMissing}</p>
      <Link className="ta-link" to={`/race/${raceId}?tab=meet&boat=${boat}`}>
        {C.meetTabLink}
      </Link>
    </div>
  );
}
