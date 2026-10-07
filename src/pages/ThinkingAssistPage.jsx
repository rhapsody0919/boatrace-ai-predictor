/**
 * 思考アシスト（BOA-430）。1レースの予想を、レースの図と4つの見方（軸・展開・機力・買い目）で組み立てるページ。
 * ja 専用（languages.js の isFullyTranslatedPath の例外）。公開まで noindex（spec D-36 (9)）。
 * 状態は useReducer 1つで、URL・localStorage に残さない（plan「状態」）。
 * 深掘り・セオリーカード・用語・会場の特徴・ガイド・上部の切り替えは後の PR（tasks PR4〜PR6）
 */
import { useCallback, useMemo, useReducer } from "react";
import { useParams } from "react-router-dom";
import Header from "../components/Header";
import AssistHeader from "../components/race/assist/AssistHeader";
import RoughCard from "../components/race/assist/RoughCard";
import RoughSheet from "../components/race/assist/RoughSheet";
import LensBar from "../components/race/assist/LensBar";
import RaceLaneBoard from "../components/race/assist/RaceLaneBoard";
import BetFooter from "../components/race/assist/BetFooter";
import MarkSheet from "../components/race/assist/MarkSheet";
import {
  THINKING_ASSIST_PUBLIC,
  isAnalogyFinderEnabled,
} from "../config/featureFlags";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { useThinkingAssistData } from "../hooks/useThinkingAssistData";
import {
  anyCell,
  boardModel,
  buildRacers,
  classLineup,
  roughCard,
  sameClassScope,
  similarSummary,
} from "../utils/assistModel";
import { compositeOdds, expandTickets } from "../utils/oddsMath";
import { formatObservedTime } from "../components/race/weatherInfo";
import { ASSIST_COPY } from "../data/thinkingAssistCopy";
import "../components/race/assist/ThinkingAssist.css";

const initialState = {
  lens: "axis",
  stage: null, // null＝DB の展示から決める既定（spec D-36 (1)）
  deep: null,
  metric: null,
  bets: { 1: new Set(), 2: new Set(), 3: new Set() },
  budget: "1000",
  mode: "equalPayout",
  sheet: null, // "mark" | "rough"
};

function reducer(state, action) {
  switch (action.type) {
    case "lens":
      return { ...state, lens: action.lens, metric: null };
    case "stage":
      return { ...state, stage: action.stage, metric: null };
    case "deep":
      return {
        ...state,
        deep: state.deep === action.boat ? null : action.boat,
        metric: null,
      };
    case "metric":
      return {
        ...state,
        deep: action.boat ?? state.deep,
        metric: state.metric === action.metric ? null : action.metric,
      };
    case "back":
      return { ...state, metric: null };
    case "toggleBet": {
      const next = new Set(state.bets[action.pos]);
      if (next.has(action.boat)) next.delete(action.boat);
      else next.add(action.boat);
      return { ...state, bets: { ...state.bets, [action.pos]: next } };
    }
    case "budget":
      return { ...state, budget: action.budget };
    case "mode":
      return { ...state, mode: action.mode };
    case "sheet":
      return { ...state, sheet: action.sheet };
    default:
      throw new Error(`思考アシスト: 知らない操作 ${action.type}`);
  }
}

export default function ThinkingAssistPage() {
  const { raceId } = useParams();
  useRobotsMeta(!THINKING_ASSIST_PUBLIC);
  const [state, dispatch] = useReducer(reducer, initialState);
  const data = useThinkingAssistData(raceId, { stage: state.stage });
  const race = data.racecard.data;
  const today = data.facts.data?.today ?? null;
  const v16Status = data.facts.data?.status ?? null;
  const v16Off = v16Status === "absent" || v16Status === "not_saved";
  const finalRound = Boolean(data.round);
  const trifecta = data.odds.data?.trifecta ?? null;

  const racers = useMemo(
    () =>
      buildRacers({
        players: race?.players ?? [],
        today,
        exhibition: data.exhibition.data,
        rates: data.rates.data,
      }),
    [race, today, data.exhibition.data, data.rates.data],
  );

  const model = useMemo(
    () =>
      boardModel({
        lens: state.lens,
        stage: data.stage,
        metric: state.metric,
        racers,
        trifecta,
        finalRound,
      }),
    [state.lens, state.metric, data.stage, racers, trifecta, finalRound],
  );

  const scope = useMemo(
    () =>
      v16Off
        ? null
        : sameClassScope({
            today,
            raceStage: race?.raceStage ?? null,
            scenarios: data.scenario.byKey,
          }),
    [v16Off, today, race, data.scenario.byKey],
  );
  const national = anyCell(data.scenario.na.data);
  const rough = roughCard(scope, national);
  const lineup = classLineup(today?.classes, 1);
  const similar = v16Off ? null : similarSummary(data.similar.data?.similar);

  const tickets = useMemo(
    () => expandTickets(state.bets, data.absentBoats),
    [state.bets, data.absentBoats],
  );
  const composite = trifecta
    ? compositeOdds(tickets.map((t) => trifecta[t]))
    : null;
  const oddsAt = formatObservedTime(data.odds.data?.capturedAt);

  const toggleBet = useCallback(
    (pos, boat) => dispatch({ type: "toggleBet", pos, boat }),
    [],
  );
  const closeSheet = useCallback(
    () => dispatch({ type: "sheet", sheet: null }),
    [],
  );

  const roughStatus =
    data.facts.status === "error" ||
    data.scenario.nc.status === "error" ||
    data.scenario.na.status === "error"
      ? "error"
      : data.facts.status === "ready" && !today
        ? "empty"
        : "loading";

  let body;
  if (data.racecard.status === "loading") {
    body = <p className="ta-status">{ASSIST_COPY.loading}</p>;
  } else if (data.racecard.status === "error") {
    body = <p className="ta-status">{ASSIST_COPY.fetchFailed}</p>;
  } else if (!race) {
    body = <p className="ta-status">{ASSIST_COPY.raceNotFound}</p>;
  } else {
    body = (
      <>
        <AssistHeader
          race={race}
          raceId={raceId}
          round={data.round}
          stage={data.stage}
          canPost={data.defaultStage === "post"}
          onStage={(stage) => dispatch({ type: "stage", stage })}
          oddsAt={oddsAt}
          showSonar={isAnalogyFinderEnabled()}
        >
          {v16Off ? (
            <p className="ta-note">
              {v16Status === "absent"
                ? ASSIST_COPY.stateAbsent
                : ASSIST_COPY.stateNotSaved}
            </p>
          ) : (
            <RoughCard
              rough={rough}
              scope={scope}
              lineup={lineup}
              status={roughStatus}
              onOpen={() => dispatch({ type: "sheet", sheet: "rough" })}
            />
          )}
        </AssistHeader>
        <LensBar
          lens={state.lens}
          onLens={(lens) => dispatch({ type: "lens", lens })}
        />
        <RaceLaneBoard
          model={model}
          lensLabel={ASSIST_COPY.lenses[state.lens].label}
          racers={racers}
          deep={state.deep}
          bets={state.bets}
          onDeep={(boat) => dispatch({ type: "deep", boat })}
          onMetric={(metric, boat) =>
            dispatch({ type: "metric", metric, boat })
          }
          onBack={() => dispatch({ type: "back" })}
          onToggleBet={toggleBet}
          onOpenSheet={() => dispatch({ type: "sheet", sheet: "mark" })}
        />
        <p className="ta-disclaimer">{ASSIST_COPY.disclaimer}</p>
        <BetFooter
          bets={state.bets}
          points={tickets.length}
          composite={composite}
          onOpen={() => dispatch({ type: "sheet", sheet: "mark" })}
        />
      </>
    );
  }

  const sheetOpen = state.sheet !== null;
  return (
    <>
      <title>{`${ASSIST_COPY.title}（${raceId}）`}</title>
      <Header />
      <main
        className="ta-page"
        aria-hidden={sheetOpen ? "true" : undefined}
        inert={sheetOpen ? true : undefined}
      >
        {body}
      </main>
      {state.sheet === "mark" && (
        <MarkSheet
          bets={state.bets}
          absentBoats={data.absentBoats}
          onToggle={toggleBet}
          onClose={closeSheet}
          points={tickets.length}
          tickets={tickets}
          trifecta={trifecta ?? {}}
          budget={state.budget}
          mode={state.mode}
          oddsAt={oddsAt}
          onBudget={(budget) => dispatch({ type: "budget", budget })}
          onMode={(mode) => dispatch({ type: "mode", mode })}
        />
      )}
      {state.sheet === "rough" && scope && national && (
        <RoughSheet
          scope={scope}
          national={national}
          similar={similar}
          racecardStage={data.similar.racecardStage}
          lineup={lineup}
          classes={today?.classes ?? null}
          onClose={closeSheet}
        />
      )}
    </>
  );
}
