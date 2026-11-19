/**
 * 思考アシストのページのシート（マークシート・ラフ度・会場・用語・セオリー）とガイド。props はページの本体の袋（view）をそのまま受ける。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）
 */
import MarkSheet from "./MarkSheet";
import RoughSheet from "./RoughSheet";
import VenueSheet from "./VenueSheet";
import GlossarySheet from "./GlossarySheet";
import TheorySheet from "./TheorySheet";
import GuideOverlay from "./GuideOverlay";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { baseVerdict } from "../../../utils/assistModel";
import { b1Usual } from "../../../utils/assistSummary";

function AssistMarkSheet({
  betSummary,
  bets,
  removedNote,
  absentBoats,
  toggleBet,
  closeSheet,
  tickets,
  onBetType,
  act,
  dispatch,
  state,
  similar,
}) {
  return (
    <MarkSheet
      // 配分の props はレンズの買い目と同じ betSummary（拡連複の幅 oddsRange の渡し忘れを防ぐ。BOA-990 ③）
      {...betSummary}
      bets={bets}
      removedNote={removedNote}
      absentBoats={absentBoats}
      onToggle={toggleBet}
      onClose={closeSheet}
      points={tickets.length}
      onBetType={(id) => onBetType(id, "tab")}
      onBox={() => act({ type: "box" })}
      onUndoBox={() => dispatch({ type: "undoBox" })}
      canUndoBox={state.boxUndo != null}
      similarTri={similar?.tri ?? null}
      similarN={similar?.n ?? null}
    />
  );
}

function AssistRoughSheet({
  scope,
  national,
  similar,
  similarFailed,
  venueAll,
  race,
  data,
  lineup,
  today,
  inCaution,
  closeSheet,
}) {
  return (
    <RoughSheet
      scope={scope}
      national={national}
      similar={similar}
      similarFailed={similarFailed}
      venueAll={venueAll}
      venueName={race?.venue ?? null}
      racecardStage={data.similar.racecardStage}
      similarConditions={data.similar.data?.similar?.conditions ?? null}
      lineup={lineup}
      classes={today?.classes ?? null}
      inCaution={inCaution}
      onClose={closeSheet}
    />
  );
}

function AssistVenueSheet({
  venueName,
  data,
  theoryCtx,
  venueAll,
  national,
  closeSheet,
}) {
  return (
    <VenueSheet
      venue={venueName}
      venueCode={data.parsed.venueCode}
      info={data.venueInfo}
      tech={data.venueTech}
      vaB1={theoryCtx.vaFacts ? b1Usual({ facts: theoryCtx.vaFacts }) : null}
      typeVerdict={
        venueAll?.n && national?.n
          ? baseVerdict(
              venueAll.b1_win,
              venueAll.n,
              national.b1_win / national.n,
            )
          : null
      }
      onClose={closeSheet}
    />
  );
}

function AssistGlossarySheet({
  state,
  lineup,
  today,
  restCounts,
  finalRound,
  closeSheet,
}) {
  return (
    <GlossarySheet
      term={state.sheet.term}
      lineup={lineup}
      classNote={
        restCounts && today?.classes
          ? ASSIST_COPY.classNote(1, today.classes[0], restCounts)
          : null
      }
      finalRound={finalRound}
      onClose={closeSheet}
    />
  );
}

export function AssistSheets(p) {
  const { state, closeSheet, sheetCard, sheetOpen } = p;
  return (
    <>
      {state.sheet === "mark" && (
        <AssistMarkSheet {...p} absentBoats={p.data.absentBoats} />
      )}
      {state.sheet === "rough" && p.scope && p.national && (
        <AssistRoughSheet {...p} />
      )}
      {sheetCard && <TheorySheet card={sheetCard} onClose={closeSheet} />}
      {state.sheet?.type === "term" && <AssistGlossarySheet {...p} />}
      {state.sheet === "venue" && p.venueName && p.data.parsed && (
        <AssistVenueSheet {...p} />
      )}
      {state.guide !== null && p.race && !sheetOpen && (
        <GuideOverlay
          steps={p.steps}
          index={state.guide}
          onStep={p.onGuideStep}
          topOffset={p.headerHeight}
        />
      )}
    </>
  );
}
