import { STAKE_UNIT } from "../../../utils/oddsMath";
import { compositeText, ticketLabel } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

export function BetSummaryLeadNotes({
  tickets,
  type,
  priced,
  oddsNote,
  result,
  composite,
}) {
  return (
    <>
      {!tickets.length && (
        <p className="ta-note">
          {ASSIST_COPY.betEmptyFor(type.legs, type.ordered)}
        </p>
      )}
      {tickets.length > 0 && !priced && <p className="ta-note">{oddsNote}</p>}
      {result?.insufficient && (
        <p className="ta-warn">
          {ASSIST_COPY.minimum(result.minimum / STAKE_UNIT, result.minimum)}
        </p>
      )}
      {composite != null && composite < 1 && (
        <p className="ta-warn">{ASSIST_COPY.trigamiLine}</p>
      )}
    </>
  );
}

export function BetSummaryResultNotes({
  result,
  settled,
  type,
  typeLabel,
  wide,
  simul,
  showSimilar,
  similarN,
}) {
  return (
    <>
      {simul && (
        <p className="ta-note ta-num">
          {ASSIST_COPY.wideSimulLine(simul.min, simul.max)}
        </p>
      )}
      {result?.topped && <p className="ta-note">{ASSIST_COPY.toppedNote}</p>}
      {result?.missing.length > 0 && (
        <p className="ta-note">
          {ASSIST_COPY.missingOdds(
            result.missing.length,
            result.missing.map((t) => ticketLabel(t, type.ordered)),
            wide,
          )}
        </p>
      )}
      {wide && settled && (
        <>
          <p className="ta-note">{ASSIST_COPY.wideCalcNote}</p>
          <p className="ta-note">{ASSIST_COPY.wideMultiNote}</p>
        </>
      )}
      {settled && (
        <p className="ta-note">
          {wide
            ? ASSIST_COPY.popularityNoteWide(type.combos)
            : ASSIST_COPY.popularityNote(typeLabel, type.combos)}
        </p>
      )}
      {showSimilar && settled && (
        <p className="ta-note">{ASSIST_COPY.similarColNote(similarN)}</p>
      )}
    </>
  );
}

export function BetSummaryOddsNotes({
  composite,
  oddsFinalFailed,
  finished,
  oddsFinal,
  oddsAt,
}) {
  return (
    <>
      {composite != null && (
        <p className="ta-note ta-num">
          {ASSIST_COPY.composite(compositeText(composite))}（
          {ASSIST_COPY.compositeNote}）
        </p>
      )}
      {oddsFinalFailed && finished && (
        <p className="ta-note">{ASSIST_COPY.oddsFinalFailed}</p>
      )}
      {oddsFinal ? (
        <p className="ta-note">{ASSIST_COPY.oddsFinal}</p>
      ) : (
        oddsAt && (
          <p className="ta-note">
            {finished
              ? ASSIST_COPY.oddsCautionFinished(oddsAt)
              : ASSIST_COPY.oddsCaution(oddsAt)}
          </p>
        )
      )}
    </>
  );
}
