import { useEffect, useRef, useState } from "react";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import TargetSwitch from "./TargetSwitch";
import LaneRow from "./RaceLaneRow";

/** 平均ST の切り替え（BOA-815 案A）。展示後も横軸は平均ST（spec D-47 (1)） */
function BasisSwitch({ model, onBasis }) {
  return (
    <div className="ta-basis">
      <span>{ASSIST_COPY.stBasisGroup}</span>
      <span
        className="ta-seg"
        role="group"
        aria-label={ASSIST_COPY.stBasisGroup}
      >
        {["course", "overall"].map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={model.basis === b}
            onClick={() => onBasis(b)}
          >
            {ASSIST_COPY.stBasis[b]}
          </button>
        ))}
      </span>
    </div>
  );
}

function BoardAxis({ model, bet }) {
  return (
    <div className="ta-board-axis" aria-hidden="true">
      <span>
        {model.good === "left" && (
          <span className="ta-good">◀ {ASSIST_COPY.good}</span>
        )}
        {model.left}
      </span>
      <span className={`ta-board-title${bet ? " is-bet" : ""}`}>
        {model.title}
      </span>
      <span>
        {model.right}
        {model.good === "right" && (
          <span className="ta-good">{ASSIST_COPY.good} ▶</span>
        )}
      </span>
    </div>
  );
}

function BoardHead({
  model,
  bet,
  oddsNote,
  onBasis,
  onMetric,
  target,
  onTarget,
}) {
  return (
    <>
      {model.basis && onBasis && (
        <BasisSwitch model={model} onBasis={onBasis} />
      )}
      {model.exhCompare && (
        <button
          type="button"
          className="ta-exh-open"
          onClick={() => onMetric("exh_st", null)}
        >
          {ASSIST_COPY.exhStOpen} ›
        </button>
      )}
      {/* 着順の切り替えと注記はオッズの見出しより上に置く。見出しと点の間に挟むと、点の位置まで着順で変わったように見える
          （BOA-831 ファン評価 1周目 指摘4） */}
      {bet && onTarget && <TargetSwitch target={target} onTarget={onTarget} />}
      {bet && <p className="ta-note">{ASSIST_COPY.pastWinNote(target)}</p>}
      {model.kind === "place" && (
        <p className="ta-note">{ASSIST_COPY.placeNote}</p>
      )}
      <BoardAxis model={model} bet={bet} />
      {model.noOdds && <p className="ta-note">{oddsNote}</p>}
    </>
  );
}

function BoardNotes({ model, bet, legUnusedNote, onBack }) {
  return (
    <>
      {bet && legUnusedNote && <p className="ta-note">{legUnusedNote}</p>}
      {bet && model.missingFirst?.length > 0 && (
        <p className="ta-note">
          {ASSIST_COPY.boardMissingFirst(model.missingFirst)}
        </p>
      )}
      {model.basis === "course" && (
        <p className="ta-note">{ASSIST_COPY.flowCourseNote}</p>
      )}
      {model.noSt && <p className="ta-note">{ASSIST_COPY.stNoData}</p>}
      {model.kind === "metric" && (
        <button type="button" className="ta-back" onClick={onBack}>
          × {model.back ?? ASSIST_COPY.backToFigure}
        </button>
      )}
    </>
  );
}

/** 6艇比較に変わったら図の見出しまで送る。深掘りの中の値を押したときは図が画面の上に外れているため（screens「2段目は図の見出しまで送る」、BOA-808 1） */
function useScrollOnCompare(model) {
  const ref = useRef(null);
  const compare = model.kind === "metric" ? model.title : null;
  useEffect(() => {
    if (!compare) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    ref.current?.scrollIntoView?.({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, [compare]);
  return ref;
}

/**
 * レースの図（FR-3、案②レーン）。行＝1〜6号艇（艇の丸・苗字・級）、横軸はレンズで変わる。
 * 艇の行を押すと深掘り、数字を押すと6艇比較（2段目、「図を戻す」で戻る）。
 * 買い目レンズでは行ごとに「1着・2着・3着」の候補。ほかのレンズでは右端の「+」でその行に同じ候補のボタンを出す
 * （開くのは1行だけ。spec D-43・BOA-801 7。マークシートは固定の買い目から開く）。
 * 欠場の艇には候補のボタンを出さない（D-38）。
 * marks はレンズごとの印（良い方の札・凹みの手がかり・攻め手・展示の偏り・チルト・交換。assistSummary から作る）。
 * 印と F は押すとセオリーカード（ファン評価 PR4 で2回出た「押せない」の解消）
 */
export default function RaceLaneBoard({
  model,
  lensLabel,
  oddsNote,
  racers,
  deep,
  bets,
  onDeep,
  onMetric,
  onBack,
  onToggleBet,
  onBasis = null,
  marks = null,
  target = 1,
  onTarget = null,
  legs = 3,
  ordered = true,
  legUnusedNote = null,
}) {
  const bet = model.kind === "bet";
  // 「+」で候補のボタンを開いている行（開くのは1行だけ。レンズが替わったら閉じる。BOA-801 7）
  // レンズの種類と組で持ち、レンズが替わったら開いていないのと同じにする（effect で閉じない）
  const [pick, setPick] = useState(null);
  const pickRow = pick?.kind === model.kind ? pick.boat : null;
  const ref = useScrollOnCompare(model);
  const lane = { model, racers, deep, bets, onDeep, onMetric, onToggleBet };
  return (
    <figure
      ref={ref}
      className="ta-board"
      aria-label={ASSIST_COPY.figure(lensLabel)}
      data-guide="board"
    >
      <BoardHead
        model={model}
        bet={bet}
        oddsNote={oddsNote}
        onBasis={onBasis}
        onMetric={onMetric}
        target={target}
        onTarget={onTarget}
      />
      {model.rows.map((row) => (
        <LaneRow
          key={row.boat}
          row={row}
          bet={bet}
          pickRow={pickRow}
          setPick={setPick}
          marks={marks}
          ordered={ordered}
          legs={legs}
          {...lane}
        />
      ))}
      <BoardNotes
        model={model}
        bet={bet}
        legUnusedNote={legUnusedNote}
        onBack={onBack}
      />
    </figure>
  );
}
