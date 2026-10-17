import { useId } from "react";
import ClassLineup from "./ClassLineup";
import BaselineBar from "../BaselineBar";
import { ROUND_LABEL, restClassCounts } from "../../../utils/assistModel";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";

/** 小さいバー1本（値・全国の全レースの線・矢印） */
function MiniBar({ label, row }) {
  if (!row) return null;
  const pct = Math.round(row.rate * 100);
  return (
    <BaselineBar label={label} rate={row.rate} base={row.base}>
      <b>{pct}%</b> {row.verdict ? ASSIST_COPY.verdictArrow[row.verdict] : ""}{" "}
      {ASSIST_COPY.roughBase(Math.round(row.base * 100))}
    </BaselineBar>
  );
}

/** 行の名前の下に、数えた範囲の名前と件数（BOA-822 FR-4） */
function RowLabel({ name, scopeText }) {
  return (
    <>
      {name}
      <span className="ta-rough-scope ta-num">{scopeText}</span>
    </>
  );
}

/**
 * 「このレースは堅い？荒れる？」の枠（FW-22、screens S-1 A）。2本の小さいバー（1号艇の1着・万舟）と
 * 級の並びの絵＋件数。押すと材料のシート（TC-R1）
 * 枠の下に、呼び名「全国・級の並びが同じ」の今日の値の例と注記（2026-10-08 ユーザー決定）
 * BOA-822（inCautionMode、機能フラグの側）: 1着のバーはイン崩れ注意度の裏返し（rough.inCaution、roughWithInCaution）。
 * 1着と万舟で数えた範囲が違うので、件数は行ごとに範囲の名前と並べ、枠の下に裏返しの1行（承認モック mock/4-assist-375.png (a)）
 * @param {{rough: object|null, scope: object|null, lineup: object[]|null, classes: string[]|null, status: string, onOpen: () => void, inCautionMode?: boolean}} props
 */
export default function RoughCard({
  rough,
  scope,
  lineup,
  classes,
  status,
  onOpen,
  inCautionMode = false,
}) {
  const counts = restClassCounts(classes);
  const titleId = useId();
  // 「件数少なめ」は件数の前（フラグの外の「件数少なめ・3,276件 ›」と同じ順。#1604 wording-editor P3）
  const round = scope?.kind === "NCR" ? ROUND_LABEL[scope.round] : null;
  const classScope =
    rough &&
    `${rough.few ? `${ASSIST_COPY.roughFew}・` : ""}${ASSIST_COPY.roughScopeClass(scope.cell.n, round)}`;
  const ic = rough?.inCaution ?? null;
  const b1Scope = ic
    ? `${ic.lowSample ? `${ASSIST_COPY.roughFew}・` : ""}${ASSIST_COPY.roughScopeInCaution(ic.n)}`
    : classScope;
  return (
    <section className="ta-rough" aria-labelledby={titleId} data-guide="rough">
      <h2 className="ta-rough-title" id={titleId}>
        {ASSIST_COPY.roughTitle}
      </h2>
      {rough && (
        <button
          type="button"
          className={
            inCautionMode ? "ta-rough-btn ta-rough-btn--scoped" : "ta-rough-btn"
          }
          aria-label={ASSIST_COPY.roughButton}
          onClick={onOpen}
        >
          <MiniBar
            label={
              inCautionMode ? (
                <RowLabel name={ASSIST_COPY.roughB1} scopeText={b1Scope} />
              ) : (
                ASSIST_COPY.roughB1
              )
            }
            row={rough.b1}
          />
          <MiniBar
            label={
              inCautionMode ? (
                <RowLabel
                  name={ASSIST_COPY.roughManshu}
                  scopeText={classScope}
                />
              ) : (
                ASSIST_COPY.roughManshu
              )
            }
            row={rough.manshu}
          />
          {/* 矢印を単独で読めるようにする（BOA-808 の4） */}
          <span className="ta-note">{ASSIST_COPY.roughLegend}</span>
          <span className="ta-rough-foot">
            <ClassLineup lineup={lineup} />
            <span className="ta-note ta-num">
              {inCautionMode ? (
                ASSIST_COPY.roughOpen
              ) : (
                <>
                  {rough.few && `${ASSIST_COPY.roughFew}・`}
                  {ASSIST_COPY.roughCount(scope.cell.n, round)}
                </>
              )}
            </span>
          </span>
        </button>
      )}
      {inCautionMode && ic && (
        <p className="ta-note ta-num" data-testid="rough-in-caution-flip">
          {ASSIST_COPY.roughFlip(100 - ic.pct, ic.pct)}
        </p>
      )}
      {rough && counts && (
        <p className="ta-note">
          {ASSIST_COPY.classNote(1, classes[0], counts)}
        </p>
      )}
      {!rough && (
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
