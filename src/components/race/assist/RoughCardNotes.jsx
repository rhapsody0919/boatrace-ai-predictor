import { ROUND_LABEL } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/** 読み込み前・失敗・未保存のときの1行 */
function EmptyNote({ status }) {
  return (
    <p className="ta-note">
      {status === "error"
        ? ASSIST_COPY.fetchFailed
        : status === "empty"
          ? ASSIST_COPY.stateNotSaved
          : ASSIST_COPY.loading}
    </p>
  );
}

/** イン崩れ注意度の裏返し（inCautionMode のとき）の2行 */
function CautionNotes({ ic }) {
  return (
    <>
      {ic && (
        <p className="ta-note ta-num" data-testid="rough-in-caution-flip">
          {ASSIST_COPY.roughFlip(100 - ic.pct, ic.pct)}
        </p>
      )}
      {ic?.round && (
        <p className="ta-note" data-testid="rough-in-caution-round">
          {ASSIST_COPY.roughRoundBaseNote(ic.round)}
        </p>
      )}
    </>
  );
}

/** 枠の下の注記（節回りの代替・裏返し・級の注記・状態） */
export default function RoughCardNotes({
  rough,
  scope,
  classes,
  counts,
  status,
  inCautionMode,
  ic,
}) {
  return (
    <>
      {rough?.few && (
        <p className="ta-note" data-testid="rough-round-fallback">
          {ASSIST_COPY.roughRoundFallback(ROUND_LABEL[scope.round])}
        </p>
      )}
      {inCautionMode && <CautionNotes ic={ic} />}
      {rough && counts && (
        <p className="ta-note">
          {ASSIST_COPY.classNote(1, classes[0], counts)}
        </p>
      )}
      {!rough && <EmptyNote status={status} />}
    </>
  );
}
