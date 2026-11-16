import { courseWins } from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { Dt, Val } from "./BoatDeepDiveParts";
import SeriesRow from "./BoatDeepDiveSeries";
import {
  CourseRow,
  StRow,
  PretestRow,
  TechniqueRow,
  ExhRow,
  FlyingRow,
} from "./BoatDeepDiveRows";

/** 数字の一覧（dl）。艇の成績・コース・ST・今節の点・モーター・展示・F */
export default function DeepKv({
  boat,
  racer,
  venue,
  raceId,
  today,
  post,
  finalRound,
  round,
  runs,
  meet,
  technique,
  pretest,
  course,
  onMetric,
  runsOpen,
  setRunsOpen,
}) {
  const i = boat - 1;
  const recent = today?.items?.recent_win30?.values?.[i];
  const seriesPos = today?.items?.series_score?.positions?.[i]?.[0] ?? null;
  const cw = meet ? courseWins(runs.data, raceId, course) : null;
  return (
    <dl className="ta-kv">
      <Dt term={C.factNames.nat_win} />
      <dd>
        <Val metric="nat_win" racer={racer} onMetric={onMetric} />
      </dd>
      <Dt term={C.factNames.loc_win} />
      <dd>
        <Val metric="loc_win" racer={racer} onMetric={onMetric} />
      </dd>
      {recent != null && (
        <>
          <Dt term={C.factNames.recent_win30} />
          <dd className="ta-num">{(recent * 100).toFixed(1)}%</dd>
        </>
      )}
      <CourseRow course={course} cw={cw} runs={runs} />
      <StRow
        racer={racer}
        today={today}
        cst={today?.course_st}
        i={i}
        venue={venue}
        onMetric={onMetric}
      />
      <SeriesRow
        boat={boat}
        racer={racer}
        venue={venue}
        raceId={raceId}
        round={round}
        finalRound={finalRound}
        seriesPos={seriesPos}
        meet={meet}
        runs={runs}
        runsOpen={runsOpen}
        setRunsOpen={setRunsOpen}
        onMetric={onMetric}
      />
      <Dt term={C.factNames.motor_2} />
      <dd>
        <Val metric="motor_2" racer={racer} onMetric={onMetric} />
      </dd>
      <PretestRow pretest={pretest} />
      <TechniqueRow technique={technique} />
      <ExhRow post={post} racer={racer} onMetric={onMetric} />
      <FlyingRow racer={racer} boat={boat} />
    </dl>
  );
}
