import { useId } from "react";
import ClassLineup from "./ClassLineup";
import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/** 小さいバー1本（値・全国の全レースの線・矢印） */
function MiniBar({ label, row }) {
  if (!row) return null;
  const pct = Math.round(row.rate * 100);
  return (
    <span className="ta-minibar">
      <span>{label}</span>
      <span className="ta-minibar-track" aria-hidden="true">
        <span
          className="ta-minibar-fill"
          style={{ width: `${row.rate * 100}%` }}
        />
        <span className="ta-baseline" style={{ left: `${row.base * 100}%` }} />
      </span>
      <span className="ta-num">
        <b>{pct}%</b> {row.verdict ? ASSIST_COPY.verdictArrow[row.verdict] : ""}{" "}
        {ASSIST_COPY.roughBase(Math.round(row.base * 100))}
      </span>
    </span>
  );
}

/**
 * 「このレースは堅い？荒れる？」の枠（FW-22、screens S-1 A）。2本の小さいバー（1号艇の1着・万舟）と
 * 級の並びの絵＋件数。押すと材料のシート（TC-R1）
 * @param {{rough: object|null, scope: object|null, lineup: object[]|null, status: string, onOpen: () => void}} props
 */
export default function RoughCard({ rough, scope, lineup, status, onOpen }) {
  const titleId = useId();
  return (
    <section className="ta-rough" aria-labelledby={titleId}>
      <h2 className="ta-rough-title" id={titleId}>
        {ASSIST_COPY.roughTitle}
      </h2>
      {rough ? (
        <button
          type="button"
          className="ta-rough-btn"
          aria-label={ASSIST_COPY.roughButton}
          onClick={onOpen}
        >
          <MiniBar label={ASSIST_COPY.roughB1} row={rough.b1} />
          <MiniBar label={ASSIST_COPY.roughManshu} row={rough.manshu} />
          <span className="ta-rough-foot">
            <ClassLineup lineup={lineup} />
            <span className="ta-note ta-num">
              {rough.few && `${ASSIST_COPY.roughFew}・`}
              {ASSIST_COPY.roughCount(
                scope.cell.n,
                scope.kind === "NCR" ? ROUND_LABEL[scope.round] : null,
              )}
            </span>
          </span>
        </button>
      ) : (
        <p className="ta-note">
          {status === "error"
            ? ASSIST_COPY.fetchFailed
            : status === "empty"
              ? ASSIST_COPY.stateNotSaved
              : ASSIST_COPY.loading}
        </p>
      )}
    </section>
  );
}
