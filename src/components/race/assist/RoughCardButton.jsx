import ClassLineup from "./ClassLineup";
import BaselineBar from "../BaselineBar";
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

/** バーの名前。inCautionMode のときだけ範囲の件数を並べる */
function BarLabel({ name, scopeText, inCautionMode }) {
  return inCautionMode ? (
    <RowLabel name={name} scopeText={scopeText} />
  ) : (
    name
  );
}

/** 級の並びの絵は万舟の範囲。1着の根拠に見えないよう名前を付ける（#1604 ファン評価1周目 P2） */
function LineupBlock({ lineup, inCautionMode }) {
  return inCautionMode ? (
    <span className="ta-rough-lineup">
      <span className="ta-rough-scope">{ASSIST_COPY.roughManshuScope}</span>
      <ClassLineup lineup={lineup} />
    </span>
  ) : (
    <ClassLineup lineup={lineup} />
  );
}

/** 足元の注記（件数、または材料のシートへの誘い） */
function FootNote({ scope, round, inCautionMode }) {
  return (
    <span className="ta-note ta-num">
      {inCautionMode ? (
        ASSIST_COPY.roughOpen
      ) : (
        <>{ASSIST_COPY.roughCount(scope.cell.n, round)}</>
      )}
    </span>
  );
}

/** 2本のバー＋級の並び＋件数を載せた、材料のシートを開くボタン */
export default function RoughCardButton({
  rough,
  scope,
  lineup,
  round,
  onOpen,
  inCautionMode,
  b1Scope,
  classScope,
}) {
  return (
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
          <BarLabel
            name={ASSIST_COPY.roughB1}
            scopeText={b1Scope}
            inCautionMode={inCautionMode}
          />
        }
        row={rough.b1}
      />
      <MiniBar
        label={
          <BarLabel
            name={ASSIST_COPY.roughManshu}
            scopeText={classScope}
            inCautionMode={inCautionMode}
          />
        }
        row={rough.manshu}
      />
      {/* 矢印を単独で読めるようにする（BOA-808 の4） */}
      <span className="ta-note">{ASSIST_COPY.roughLegend}</span>
      <span className="ta-rough-foot">
        <LineupBlock lineup={lineup} inCautionMode={inCautionMode} />
        <FootNote scope={scope} round={round} inCautionMode={inCautionMode} />
      </span>
    </button>
  );
}
