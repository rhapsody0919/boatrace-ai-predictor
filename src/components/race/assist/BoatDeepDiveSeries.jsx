import { Link } from "react-router-dom";
import { meetFormSearch } from "../meetFormTrend";
import { finishClass, monthDay, finishOf } from "../../../utils/assistSummary";
import { ASSIST_COPY as C } from "../../../data/thinkingAssistCopy";
import { Dt, Val } from "./BoatDeepDiveParts";

/** 今節の日別の着順の1行（走の取得前後・失敗の文言も） */
function FinLine({ meet, runs, venue }) {
  return (
    <div className="ta-finline ta-num">
      {meet ? (
        <>
          {meet.byDay.map((d, k) => (
            <span key={d.date}>
              {k > 0 && "／"}
              {monthDay(d.date)}{" "}
              {d.finishes.map((f, j) => (
                <span key={j}>
                  {j > 0 && "・"}
                  <span className={finishClass(f).trim()}>{f ?? "—"}</span>
                </span>
              ))}
            </span>
          ))}
          {meet.today.map((r) => (
            <span key={r.raceId} className="ta-run-today">
              {" "}
              {C.todayRun(Number(r.raceId.slice(14, 16)), finishOf(r))}
            </span>
          ))}
        </>
      ) : runs.status === "error" ? (
        C.partFailed(C.captionMeet(venue))
      ) : runs.status === "none" ? (
        C.noRunsData
      ) : (
        C.loading
      )}
    </div>
  );
}

/** 今節の点の行（dt/dd）。着順の1行・今節の足の推移へのリンク・走の表の開閉ボタン */
export default function SeriesRow({
  boat,
  racer,
  venue,
  raceId,
  round,
  finalRound,
  seriesPos,
  meet,
  runs,
  runsOpen,
  setRunsOpen,
  onMetric,
}) {
  return (
    <>
      <Dt term={C.factNames.series_score} />
      <dd>
        {racer.seriesScore == null && meet?.avg != null ? (
          // v16 の値が無いレース（保存なし等）は、今節の走から同じ定義で出す（F・失格は0点。ファン評価 PR4 1周目 指摘5）
          <span className="ta-num">{meet.avg.toFixed(2)}</span>
        ) : (
          <Val metric="series_score" racer={racer} onMetric={onMetric} />
        )}
        {!finalRound && seriesPos && (
          <span className="ta-num"> （{C.seriesRank(seriesPos)}）</span>
        )}{" "}
        <span className="ta-scopechip">{C.beforeToday}</span>
        {meet?.count > 0 && (
          // 何を平均したかの一言（BOA-804）。優勝戦の日は準優勝戦の着順も入る
          <p className="ta-note ta-num">
            {C.seriesAvgNote(meet.count, meet.sum, round === "yusho")}
          </p>
        )}
        <FinLine meet={meet} runs={runs} venue={venue} />
        {meet && (
          // 日別の着順を見たところから、同じ艇の今節の足の推移へ（BOA-885）
          <Link
            className="ta-link ta-meetform-link"
            to={`/race/${raceId}${meetFormSearch(boat)}`}
          >
            {C.meetFormLinkDeep(boat)}
          </Link>
        )}
        {meet && (
          <button
            type="button"
            className="ta-linkish"
            aria-expanded={runsOpen}
            onClick={() => setRunsOpen((o) => !o)}
          >
            {C.runsToggle}{" "}
            <span aria-hidden="true">{runsOpen ? "▲" : "›"}</span>
          </button>
        )}
      </dd>
    </>
  );
}
