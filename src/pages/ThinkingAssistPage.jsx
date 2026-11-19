/**
 * 思考アシスト（BOA-430）。1レースの予想を、レースの図と4つの見方（軸・展開・機力・買い目）で組み立てるページ。
 * ja 専用（languages.js の isFullyTranslatedPath の例外）。公開まで noindex（spec D-36 (9)）。
 * 状態は useReducer 1つで、URL・localStorage に残さない（plan「状態」）。買い目・予算・配分の方式・着順・レンズだけは
 * 同じタブの中でレースごとに sessionStorage に残し、ソナー等へ移ってから戻る・再読み込みで消えないようにする（utils/assistSession.js）。
 * レンズの要約・図の印・深掘りは PR4。セオリーカード・用語・会場の特徴・ガイドは PR5。上部の切り替え（AssistViewSwitch）は PR6
 */
import { useReducer, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Header from "../components/Header";
import LensBar from "../components/race/assist/LensBar";
import BetFooter from "../components/race/assist/BetFooter";
import LensSummary from "../components/race/assist/LensSummary";
import { AssistSheetContext } from "../components/race/assist/assistSheetContext";
import {
  AssistDeepDive,
  AssistFigColumn,
  AssistHeaderSection,
} from "../components/race/assist/AssistPageParts";
import { AssistSheets } from "../components/race/assist/AssistPageSheets";
import {
  assistBase,
  assistLabelsOf,
  assistOddsOf,
  assistRoughOf,
  assistSheetOf,
} from "../components/race/assist/assistPageValues";
import { buildSummary } from "../components/race/assist/assistPageSummary";
import {
  useAppHeaderHeight,
  useAssistAct,
  useAssistBets,
  useAssistBoard,
  useAssistFacts,
  useAssistFlow,
  useAssistGuide,
  useAssistScope,
  useAssistSessionSave,
  useAssistSheetActs,
} from "../components/race/assist/useAssistPage";
import {
  THINKING_ASSIST_PUBLIC,
  isThinkingAssistEnabled,
} from "../config/featureFlags";
import AssistViewSwitch from "../components/race/assist/AssistViewSwitch";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { useThinkingAssistData } from "../hooks/useThinkingAssistData";
import { assistBetType, boxBets } from "../utils/assistModel";
import { ASSIST_COPY } from "../data/thinkingAssistCopy";
import { parseRaceId } from "../utils/raceId";
import { loadAssistSession } from "../utils/assistSession";
import {
  createAssistReducer,
  initialState,
} from "../pure/predictionAssistState";
import "../components/race/assist/ThinkingAssist.css";

// 「選んだ艇でボックス」の組みは utils/assistModel のまま（src/pure の reducer へ渡す）
const reducer = createAssistReducer({ boxBets, assistBetType });

/**
 * レースが替わったら状態を作り直す（別のレースの買い目を持ち越さない）。同じレースに戻ったら sessionStorage から戻す
 */
export default function ThinkingAssistPage() {
  const { raceId } = useParams();
  return <ThinkingAssistBody key={raceId} />;
}

const initState = (raceId) => ({
  ...initialState,
  ...(loadAssistSession(raceId) ?? {}),
});

function AssistMain(p) {
  if (p.data.racecard.status === "loading") {
    return <p className="ta-status">{ASSIST_COPY.loading}</p>;
  }
  if (p.data.racecard.status === "error") {
    return <p className="ta-status">{ASSIST_COPY.fetchFailed}</p>;
  }
  if (!p.race) {
    // 次に行ける所を1つ置く（ファン評価 3周目 指摘11）
    return (
      <div className="ta-status">
        <p>{ASSIST_COPY.raceNotFound}</p>
        <Link className="ta-link" to="/">
          {ASSIST_COPY.backToRaces}
        </Link>
      </div>
    );
  }
  return (
    <>
      <AssistHeaderSection {...p} />
      <LensBar
        lens={p.state.lens}
        onLens={(lens) => p.act({ type: "lens", lens })}
        guideOn={p.state.guide !== null}
        onGuide={() => p.onGuideStep(p.state.guide === null ? 0 : null)}
      />
      {/* PC（1024px 以上）は図を左・押して変わる結果を右に（BOA-801 5・BOA-820、龍神ソナーの PC 表示 BOA-813 と同じ決まり）。
          狭い画面では囲みが無いのと同じ（display: contents） */}
      <div className="ta-split">
        <AssistFigColumn {...p} />
        <div className="ta-split-side">
          {p.deepBoat && <AssistDeepDive {...p} />}
          {!(p.cancelled && p.state.lens === "bet") && (
            <LensSummary
              lens={p.state.lens}
              axis={p.summary.axis}
              flow={p.summary.flow}
              power={p.summary.power}
              place={p.summary.place}
              bet={p.summary.bet}
            />
          )}
        </div>
      </div>
      <p className="ta-disclaimer">{ASSIST_COPY.disclaimer}</p>
      {!p.cancelled && <AssistFoot {...p} />}
    </>
  );
}

function AssistFoot({
  state,
  act,
  betType,
  bets,
  betOdds,
  tickets,
  composite,
  oddsNote,
  removedNote,
  steps,
}) {
  return (
    <BetFooter
      bets={bets}
      betType={betType.id}
      priced={
        betOdds
          ? tickets.filter((t) => betOdds[t] != null && betOdds[t] > 0).length
          : tickets.length
      }
      points={tickets.length}
      composite={composite}
      oddsNote={oddsNote}
      removedNote={removedNote}
      onOpen={() => act({ type: "sheet", sheet: "mark" })}
      hidden={state.guide !== null && steps[state.guide].target !== "foot"}
    />
  );
}

function AssistPageShell({ view, sheetApi, showViewSwitch, parsedRaceId }) {
  const { raceId, venueName, headerHeight, sheetOpen } = view;
  return (
    <AssistSheetContext.Provider value={sheetApi}>
      <title>{`${ASSIST_COPY.title}（${raceId}）`}</title>
      {parsedRaceId && (
        <meta
          name="description"
          content={ASSIST_COPY.metaDescription({
            date: parsedRaceId.date,
            venue: venueName,
            raceNo: parsedRaceId.raceNo,
          })}
        />
      )}
      {/* ja 専用のページ。canonical は自分自身（レース詳細とは別の画面） */}
      <link
        rel="canonical"
        href={`https://www.boat-ai.jp/race/${raceId}/assist`}
      />
      <Header />
      {/* 上部の切り替え（PR6、D-22）。フラグがあるときだけ。レース詳細と同じ位置（サイトのヘッダーの直下） */}
      {showViewSwitch && <AssistViewSwitch current="assist" raceId={raceId} />}
      <main
        className="ta-page"
        style={{ "--ta-sticky-top": `${headerHeight}px` }}
        aria-hidden={sheetOpen ? "true" : undefined}
        inert={sheetOpen ? true : undefined}
      >
        <AssistMain {...view} />
      </main>
      <AssistSheets {...view} />
    </AssistSheetContext.Provider>
  );
}

function ThinkingAssistBody() {
  const { raceId } = useParams();
  const parsedRaceId = parseRaceId(raceId);
  useRobotsMeta(!THINKING_ASSIST_PUBLIC);
  const [state, dispatch] = useReducer(reducer, raceId, initState);
  useAssistSessionSave(raceId, state);
  const { act, onTarget } = useAssistAct(raceId, state, dispatch);
  const [showViewSwitch] = useState(isThinkingAssistEnabled);
  const data = useThinkingAssistData(raceId, {
    stage: state.stage,
    deep: state.deep,
    venueOpen: state.sheet === "venue",
  });
  const b = assistBase(data);
  const headerHeight = useAppHeaderHeight();
  const facts = useAssistFacts(state, data, b);
  const flow = useAssistFlow(state, b.ncScenario, b.today);
  const base = { raceId, state, dispatch, act, onTarget, data, headerHeight };
  const c0 = { ...base, ...b, ...facts, ...flow };
  const board = useAssistBoard(state, data, c0);
  const scope = useAssistScope(data, b);
  const bet = useAssistBets(state, data);
  const { toggleBet, closeSheet } = useAssistSheetActs(dispatch);
  const c1 = { ...c0, ...board, scope, ...bet, toggleBet, closeSheet };
  const c2 = { ...c1, ...assistRoughOf(c1), ...assistOddsOf(c1) };
  const c3 = { ...c2, ...assistLabelsOf(c2) };
  const c4 = { ...c3, summary: buildSummary(c3), ...assistSheetOf(c3) };
  const { sheetApi, onGuideStep } = useAssistGuide(act, c4.steps);
  const view = { ...c4, onGuideStep };
  return (
    <AssistPageShell
      view={view}
      sheetApi={sheetApi}
      showViewSwitch={showViewSwitch}
      parsedRaceId={parsedRaceId}
    />
  );
}
