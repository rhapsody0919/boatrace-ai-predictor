/**
 * 思考アシスト（BOA-430）。1レースの予想を、レースの図と4つの見方（軸・展開・機力・買い目）で組み立てるページ。
 * ja 専用（languages.js の isFullyTranslatedPath の例外）。公開まで noindex（spec D-36 (9)）。
 * 状態は useReducer 1つで、URL・localStorage に残さない（plan「状態」）。
 * 深掘り・セオリーカード・用語・会場の特徴・ガイド・上部の切り替えは後の PR（tasks PR4〜PR6）
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  roughState,
  sameClassScope,
  similarSummary,
} from "../utils/assistModel";
import { compositeOdds, expandTickets } from "../utils/oddsMath";
import { formatObservedTime } from "../components/race/weatherInfo";
import { isRaceCancelled } from "../utils/raceCancellation";
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

/**
 * 共通のヘッダー（.app-header、sticky・高さが変わる）の高さ。レンズの固定位置をその下にそろえる（N-1、Codex 依頼27 F08）
 */
function useAppHeaderHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const el = document.querySelector(".app-header");
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el); // observe した直後に1回呼ばれる
    return () => ro.disconnect();
  }, []);
  return height;
}

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

/** 候補から欠場の艇を外す（表示と点数用。状態の候補は残し、外したことを知らせる。D-38） */
const withoutBoats = (bets, boats) =>
  boats.length
    ? Object.fromEntries(
        [1, 2, 3].map((k) => [
          k,
          new Set([...bets[k]].filter((b) => !boats.includes(b))),
        ]),
      )
    : bets;

export default function ThinkingAssistPage() {
  const { raceId } = useParams();
  useRobotsMeta(!THINKING_ASSIST_PUBLIC);
  const [state, dispatch] = useReducer(reducer, initialState);
  const data = useThinkingAssistData(raceId, { stage: state.stage });
  const race = data.racecard.data;
  const today = data.facts.data?.today ?? null;
  const v16Status = data.facts.data?.status ?? null;
  // 欠場は v16 の状態と DB の展示の両方で見る（どちらかで分かれば v16 の部分を出さない。screens「欠場があった」、Codex 依頼27 F03）
  const absentKnown = v16Status === "absent" || data.absentBoats.length > 0;
  const v16Off = absentKnown || v16Status === "not_saved";
  const cancelled = isRaceCancelled(race);
  const headerHeight = useAppHeaderHeight();
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
        hasToday: today != null,
      }),
    [state.lens, state.metric, data.stage, racers, trifecta, finalRound, today],
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
  const venueAll = anyCell(data.scenario.va.data);
  const rough = roughCard(scope, national);
  const lineup = classLineup(today?.classes, 1);
  const similar = v16Off ? null : similarSummary(data.similar.data?.similar);
  const similarFailed = !v16Off && data.similar.status === "error";

  // 欠場の艇は候補から外して数える（D-38）。欠場が分かる前に組んだ組は外したことを1行で知らせる
  const bets = useMemo(
    () => withoutBoats(state.bets, data.absentBoats),
    [state.bets, data.absentBoats],
  );
  const tickets = useMemo(
    () => expandTickets(state.bets, data.absentBoats),
    [state.bets, data.absentBoats],
  );
  const removedBoats = data.absentBoats.filter((b) =>
    [1, 2, 3].some((k) => state.bets[k].has(b)),
  );
  const removedNote = removedBoats.length
    ? ASSIST_COPY.absentRemoved(
        removedBoats,
        expandTickets(state.bets).length - tickets.length,
      )
    : null;
  // オッズが無い: 取得の失敗と、発売前（取得が成功して空）を分ける（FR-11・screens「オッズが無い」、Codex 依頼27 F01）
  const oddsNote =
    data.odds.status === "error"
      ? ASSIST_COPY.partFailed(ASSIST_COPY.partOdds)
      : ASSIST_COPY.oddsNone;
  const partNotes = [
    data.exhibition.status === "error" && ASSIST_COPY.partExhibition,
    data.rates.status === "error" && ASSIST_COPY.partRates,
  ].filter(Boolean);
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

  const roughStatus = roughState({
    factsStatus: data.facts.status,
    today,
    ncStatus: data.scenario.nc.status,
    naStatus: data.scenario.na.status,
  });

  let body;
  if (data.racecard.status === "loading") {
    body = <p className="ta-status">{ASSIST_COPY.loading}</p>;
  } else if (data.racecard.status === "error") {
    body = <p className="ta-status">{ASSIST_COPY.fetchFailed}</p>;
  } else if (!race) {
    // 次に行ける所を1つ置く（ファン評価 3周目 指摘11）
    body = (
      <div className="ta-status">
        <p>{ASSIST_COPY.raceNotFound}</p>
        <Link className="ta-link" to="/">
          {ASSIST_COPY.backToRaces}
        </Link>
      </div>
    );
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
          {partNotes.map((part) => (
            <p key={part} className="ta-note">
              {ASSIST_COPY.partFailed(part)}
            </p>
          ))}
          {v16Off ? (
            <p className="ta-note">
              {absentKnown
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
        {cancelled && state.lens === "bet" ? (
          // 中止のレースは買い目レンズにこの1行だけ（D-38）
          <p className="ta-status">{ASSIST_COPY.cancelled}</p>
        ) : (
          <RaceLaneBoard
            model={model}
            lensLabel={ASSIST_COPY.lenses[state.lens].label}
            racers={racers}
            deep={state.deep}
            bets={bets}
            oddsNote={oddsNote}
            onDeep={(boat) => dispatch({ type: "deep", boat })}
            onMetric={(metric, boat) =>
              dispatch({ type: "metric", metric, boat })
            }
            onBack={() => dispatch({ type: "back" })}
            onToggleBet={toggleBet}
            onOpenSheet={() => dispatch({ type: "sheet", sheet: "mark" })}
          />
        )}
        <p className="ta-disclaimer">{ASSIST_COPY.disclaimer}</p>
        {!cancelled && (
          <BetFooter
            bets={bets}
            points={tickets.length}
            composite={composite}
            oddsNote={oddsNote}
            removedNote={removedNote}
            onOpen={() => dispatch({ type: "sheet", sheet: "mark" })}
          />
        )}
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
        style={{ "--ta-sticky-top": `${headerHeight}px` }}
        aria-hidden={sheetOpen ? "true" : undefined}
        inert={sheetOpen ? true : undefined}
      >
        {body}
      </main>
      {state.sheet === "mark" && (
        <MarkSheet
          bets={bets}
          removedNote={removedNote}
          oddsNote={oddsNote}
          absentBoats={data.absentBoats}
          onToggle={toggleBet}
          onClose={closeSheet}
          points={tickets.length}
          tickets={tickets}
          trifecta={trifecta ?? {}}
          budget={state.budget}
          mode={state.mode}
          oddsAt={oddsAt}
          finished={Boolean(race?.result?.finished)}
          onBudget={(budget) => dispatch({ type: "budget", budget })}
          onMode={(mode) => dispatch({ type: "mode", mode })}
        />
      )}
      {state.sheet === "rough" && scope && national && (
        <RoughSheet
          scope={scope}
          national={national}
          similar={similar}
          similarFailed={similarFailed}
          venueAll={venueAll}
          venueName={race?.venue ?? null}
          racecardStage={data.similar.racecardStage}
          lineup={lineup}
          classes={today?.classes ?? null}
          onClose={closeSheet}
        />
      )}
    </>
  );
}
