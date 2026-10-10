/**
 * 思考アシスト（BOA-430）。1レースの予想を、レースの図と4つの見方（軸・展開・機力・買い目）で組み立てるページ。
 * ja 専用（languages.js の isFullyTranslatedPath の例外）。公開まで noindex（spec D-36 (9)）。
 * 状態は useReducer 1つで、URL・localStorage に残さない（plan「状態」）。
 * レンズの要約・図の印・深掘りは PR4。セオリーカード・用語・会場の特徴・ガイドは PR5。上部の切り替え（AssistViewSwitch）は PR6
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
import LensSummary from "../components/race/assist/LensSummary";
import BoatDeepDive from "../components/race/assist/BoatDeepDive";
import TheorySheet from "../components/race/assist/TheorySheet";
import GlossarySheet from "../components/race/assist/GlossarySheet";
import VenueSheet from "../components/race/assist/VenueSheet";
import GuideOverlay from "../components/race/assist/GuideOverlay";
import { AssistSheetContext } from "../components/race/assist/assistSheetContext";
import {
  THINKING_ASSIST_PUBLIC,
  isAnalogyFinderEnabled,
  isThinkingAssistEnabled,
} from "../config/featureFlags";
import AssistViewSwitch from "../components/race/assist/AssistViewSwitch";
import { useRobotsMeta } from "../hooks/useRobotsMeta";
import { useThinkingAssistData } from "../hooks/useThinkingAssistData";
import {
  ROUND_LABEL,
  anyCell,
  baseVerdict,
  boardModel,
  buildRacers,
  classLineup,
  restClassCounts,
  roughCard,
  roughState,
  sameClassScope,
  similarSummary,
} from "../utils/assistModel";
import {
  HINT_BOAT,
  b1Usual,
  boardFactMark,
  factChips,
  factsScope,
  factsScopeLabel,
  hintSummary,
  partsChangedBoats,
  tiltOutliers,
} from "../utils/assistSummary";
import { ATTACK_BOAT } from "../utils/analogyScenario";
import { guideSteps, theoryCard } from "../utils/assistTheory";
import {
  compositeOdds,
  expandTickets,
  popularityRanks,
} from "../utils/oddsMath";
import { formatObservedTime } from "../components/race/weatherInfo";
import { isRaceCancelled } from "../utils/raceCancellation";
import { ASSIST_COPY } from "../data/thinkingAssistCopy";
import { trueWindDirection, windRelation } from "../utils/windDirection.js";
import "../components/race/assist/ThinkingAssist.css";

const initialState = {
  lens: "axis",
  stage: null, // null＝DB の展示から決める既定（spec D-36 (1)）
  deep: null,
  metric: null,
  // 展開レンズの展示前の平均ST（BOA-815 案A）
  stBasis: "course",
  bets: { 1: new Set(), 2: new Set(), 3: new Set() },
  budget: "1000",
  mode: "equalPayout",
  // "mark" | "rough" | "venue" | {type: "theory", id, boat} | {type: "term", term}
  sheet: null,
  guide: null, // ガイドの段（0〜4）。null は閉じている
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
      // 値を押したら図を6艇比較に変えるだけ。深掘りは開かない（開くと深掘りへ送られて比べた図が見えない。BOA-808 1）
      return {
        ...state,
        metric: state.metric === action.metric ? null : action.metric,
      };
    case "back":
      return { ...state, metric: null };
    case "stBasis":
      return { ...state, stBasis: action.basis, metric: null };
    case "closeDeep":
      return { ...state, deep: null, metric: null };
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
    case "guide":
      // ガイドの段に合わせてレンズを切り替え、深掘りを閉じる。閉じても買い目・レンズは残す（FR-10）
      return action.step == null
        ? { ...state, guide: null }
        : {
            ...state,
            guide: action.step,
            lens: action.lens,
            deep: null,
            metric: null,
          };
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
  const [showViewSwitch] = useState(isThinkingAssistEnabled);
  const data = useThinkingAssistData(raceId, {
    stage: state.stage,
    deep: state.deep,
    venueOpen: state.sheet === "venue",
  });
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
  const post = data.stage === "post";
  const factsAll = v16Off ? null : (data.facts.data?.facts ?? null);
  const v16Exhibition = data.facts.data?.exhibition ?? null;
  const ncScenario = v16Off ? null : (data.scenario.nc.data?.scenario ?? null);
  const maintenanceRows =
    post && data.maintenance.status === "ready"
      ? (data.maintenance.data?.rows ?? null)
      : null;

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

  // 艇ごとの差がつく材料（範囲は v16 の既定、優勝戦・準優勝戦の日は同じラウンド。D-37）
  const boatFacts = useMemo(
    () =>
      [1, 2, 3, 4, 5, 6].map((boat) => {
        const scope = factsScope(factsAll, today, boat, data.round);
        return {
          scope,
          chips: factChips({
            scope,
            today,
            exhibition: v16Exhibition,
            boat,
            // 展示タイムの札は v16 の展示後の段の値があるときだけ（無いと全艇「—」になる。ファン評価 PR4 1周目 指摘4）
            post: post && Array.isArray(v16Exhibition?.exh_time),
            finalRound,
          }),
        };
      }),
    [factsAll, today, data.round, v16Exhibition, post, finalRound],
  );
  // 買い目レンズの「過去の1着」（艇ごとの範囲。6艇で比べない）
  const pastWin = useMemo(
    () =>
      new Map(
        boatFacts
          .map((f, i) => [i + 1, b1Usual(f.scope, i + 1)])
          .filter(([, u]) => u),
      ),
    [boatFacts],
  );
  const hints = useMemo(
    () => (ncScenario ? hintSummary(ncScenario, today) : null),
    [ncScenario, today],
  );

  // 図の印（screens「レンズごとの図 C」の印）
  const marks = useMemo(() => {
    const out = new Map();
    const add = (boat, mark) => out.set(boat, [...(out.get(boat) ?? []), mark]);
    if (state.lens === "axis")
      boatFacts.forEach((f, i) => {
        const c = boardFactMark(f.chips);
        if (c)
          add(i + 1, {
            text: ASSIST_COPY.factMark(
              ASSIST_COPY.factNames[c.key],
              ASSIST_COPY.factWords[c.good],
            ),
            hit: true,
            theory: `TC-F:${i + 1}:${c.key}`,
          });
      });
    if (state.lens === "flow" && hints?.top) {
      const top = hints.top;
      const boat = HINT_BOAT[top.id];
      if (boat)
        add(boat, {
          text: ASSIST_COPY.hintMark(
            ASSIST_COPY.formNames[top.form],
            Math.round((top.hit[0] / top.hit[1]) * 100),
          ),
          hit: true,
          theory: `TC-H:${top.id}`,
        });
      const attacker = ATTACK_BOAT[top.form];
      if (attacker)
        add(attacker, {
          text: ASSIST_COPY.attackMark(ASSIST_COPY.formNames[top.form]),
          hit: false,
          theory: `TC-S:${top.form}`,
        });
    }
    if (state.lens === "power" && post) {
      // 1号艇の展示タイムの偏り（TC-X1）。展示の値があるときだけ
      if (racers[0]?.exhTime != null)
        add(1, { text: ASSIST_COPY.exhBiasMark, hit: false, theory: "TC-X1" });
      for (const [boat, tilt] of tiltOutliers(racers))
        add(boat, {
          text: ASSIST_COPY.tiltMark(tilt),
          hit: false,
          theory: "TC-T5",
        });
      for (const boat of partsChangedBoats(maintenanceRows))
        add(boat, {
          text: ASSIST_COPY.partsMark,
          hit: false,
          theory: "TC-T6",
        });
    }
    return out;
  }, [state.lens, boatFacts, hints, post, racers, maintenanceRows]);

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
        pastWin,
        stBasis: state.stBasis,
        stMissing: data.facts.status === "ready" && v16Status === "not_saved",
      }),
    [
      state.lens,
      state.metric,
      data.stage,
      racers,
      trifecta,
      finalRound,
      today,
      pastWin,
      state.stBasis,
      data.facts.status,
      v16Status,
    ],
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

  const venueName = race?.venue ?? null;
  const courseByBoat = maintenanceRows
    ? [1, 2, 3, 4, 5, 6].map(
        (b) =>
          maintenanceRows.find((r) => r.boat_number === b)?.exhibition_course ??
          null,
      )
    : null;
  const vaKey = today?.scope_keys?.["1"]?.VA;
  const motorFact = boatFacts[0].chips.find(
    (c) => c.key === "motor_2" && c.hit && c.level === "large",
  );
  const b1u = b1Usual(boatFacts[0].scope);
  const betSummary = {
    tickets,
    trifecta: trifecta ?? {},
    budget: state.budget,
    mode: state.mode,
    oddsAt,
    oddsNote,
    finished: Boolean(race?.result?.finished),
    onBudget: (budget) => dispatch({ type: "budget", budget }),
    onMode: (mode) => dispatch({ type: "mode", mode }),
  };
  const summary = {
    axis: factsAll
      ? {
          scope: boatFacts[0].scope,
          chips: boatFacts[0].chips,
          venue: venueName,
          headerScope: scope,
          vaFacts: vaKey ? factsAll[vaKey] : null,
          vaCell: venueAll,
          classes: today?.classes ?? null,
          round: data.round,
          post,
        }
      : null,
    flow: {
      scenario: ncScenario,
      today,
      post,
      v16Exhibition,
      courseByBoat,
      similar,
      racecardStage: data.similar.racecardStage,
      reflecting: v16Status === "exhibition_reflecting",
      round: data.round,
    },
    power: {
      post,
      racers,
      maintenance: maintenanceRows,
      original:
        data.original.data?.state === "published" ? data.original.data : null,
      venue: venueName,
      motorChip:
        motorFact && b1u && racers[0].motor2 != null
          ? {
              top: motorFact.bucket === 1,
              value: racers[0].motor2,
              rate: Math.round(motorFact.rate * 100),
              base: Math.round((b1u.k / b1u.n) * 100),
              // どのレースから出した割合か（271 の指摘の型）
              scope: ASSIST_COPY.scopeChip(
                factsScopeLabel(
                  boatFacts[0].scope,
                  venueName,
                  1,
                  today?.classes?.[0],
                ),
                boatFacts[0].scope.n,
              ),
            }
          : null,
    },
    bet: {
      bet: {
        points: tickets.length,
        summary: betSummary,
        ranks: popularityRanks(trifecta ?? {}),
        oddsAt,
        finished: Boolean(race?.result?.finished),
      },
      scope,
      national,
      similar,
      sim: data.similar.data?.similar ?? null,
      venueAll,
      venue: venueName,
      classes: today?.classes ?? null,
    },
  };
  const deepBoat = state.deep;
  const deepRunsReady =
    data.runs.racerId != null &&
    data.runs.racerId === racers[(deepBoat ?? 1) - 1]?.racerId;

  // セオリーカードの材料（utils/assistTheory.theoryCard）
  const exhRank = (() => {
    const t = racers[0]?.exhTime;
    if (t == null) return null;
    return 1 + racers.filter((r) => r.exhTime != null && r.exhTime < t).length;
  })();
  const theoryCtx = {
    post,
    venue: venueName,
    round: data.round,
    roundLabel: data.round ? ROUND_LABEL[data.round] : null,
    scenario: ncScenario,
    today: v16Off ? null : today,
    v16Exhibition,
    courseByBoat,
    boatFacts,
    racers,
    vaFacts: vaKey && factsAll ? factsAll[vaKey] : null,
    wind: {
      speed: race?.weather?.windSpeed ?? null,
      dir: trueWindDirection(
        race?.weather?.windDirection,
        data.parsed?.venueCode,
      ),
      rel: windRelation(
        race?.weather?.windDirection,
        data.parsed?.venueCode,
        race?.weather?.windSpeed,
      ),
      wave: race?.weather?.waveHeight ?? null,
    },
    partsBoats: maintenanceRows ? partsChangedBoats(maintenanceRows) : null,
    b1Exh:
      exhRank != null
        ? { text: racers[0].exhTime.toFixed(2), rank: exhRank }
        : null,
    scopeLabelOf: (sc, boat) =>
      factsScopeLabel(sc, venueName, boat, today?.classes?.[boat - 1]),
  };
  const sheetCard =
    state.sheet?.type === "theory"
      ? theoryCard(state.sheet.id, { ...theoryCtx, boat: state.sheet.boat })
      : null;
  const steps = guideSteps({ post, rough, hintTop: hints?.top ?? null });
  const sheetApi = useMemo(
    () => ({
      openTerm: (term) =>
        dispatch({ type: "sheet", sheet: { type: "term", term } }),
      openTheory: (id, boat = null) =>
        dispatch({ type: "sheet", sheet: { type: "theory", id, boat } }),
    }),
    [],
  );
  const onGuideStep = useCallback(
    (step) =>
      dispatch({
        type: "guide",
        step,
        lens: step == null ? null : steps[step].lens,
      }),
    // steps のレンズは段ごとに固定（中身の文だけがレースで変わる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const restCounts = restClassCounts(today?.classes, 1);

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
          venueCode={data.parsed?.venueCode}
          raceId={raceId}
          round={data.round}
          stage={data.stage}
          canPost={data.defaultStage === "post"}
          onStage={(stage) => dispatch({ type: "stage", stage })}
          oddsAt={oddsAt}
          showSonar={isAnalogyFinderEnabled()}
          waterType={data.venueInfo.data?.waterType ?? null}
          onVenue={() => dispatch({ type: "sheet", sheet: "venue" })}
        >
          {post && v16Status === "exhibition_reflecting" && (
            <p className="ta-note">{ASSIST_COPY.stateReflecting}</p>
          )}
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
              classes={today?.classes ?? null}
              status={roughStatus}
              onOpen={() => dispatch({ type: "sheet", sheet: "rough" })}
            />
          )}
        </AssistHeader>
        <LensBar
          lens={state.lens}
          onLens={(lens) => dispatch({ type: "lens", lens })}
          guideOn={state.guide !== null}
          onGuide={() => onGuideStep(state.guide === null ? 0 : null)}
        />
        {/* PC（1024px 以上）は図を左・押して変わる結果を右に（BOA-801 5・BOA-820、龍神ソナーの PC 表示 BOA-813 と同じ決まり）。
            狭い画面では囲みが無いのと同じ（display: contents） */}
        <div className="ta-split">
          <div className="ta-split-fig">
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
                onBasis={(basis) => dispatch({ type: "stBasis", basis })}
                onToggleBet={toggleBet}
                onOpenSheet={() => dispatch({ type: "sheet", sheet: "mark" })}
                // 軸・展開の印は v16 が無ければ材料が空なので出ない。機力のチルト・交換は DB の展示なので欠場でも出す
                marks={marks}
              />
            )}
          </div>
          <div className="ta-split-side">
            {deepBoat && (
              <BoatDeepDive
                key={deepBoat}
                boat={deepBoat}
                racer={racers[deepBoat - 1]}
                venue={venueName}
                raceId={raceId}
                today={v16Off ? null : today}
                post={post}
                finalRound={finalRound}
                round={data.round}
                scope={boatFacts[deepBoat - 1].scope}
                chips={boatFacts[deepBoat - 1].chips}
                runs={
                  racers[deepBoat - 1]?.racerId == null
                    ? // 選手の登録番号が無い艇は走を取れない。読み込み中に残さない
                      { status: "none", data: null }
                    : deepRunsReady
                      ? data.runs
                      : { status: "loading", data: null }
                }
                technique={
                  data.technique.status === "ready"
                    ? ((data.technique.data ?? []).find(
                        (r) => r.boat_number === deepBoat,
                      ) ?? null)
                    : null
                }
                pretest={
                  data.motor.status === "ready"
                    ? ((data.motor.data?.rows ?? []).find(
                        (r) => r.boat_number === deepBoat,
                      ) ?? null)
                    : null
                }
                weight={
                  (maintenanceRows ?? []).find(
                    (r) => r.boat_number === deepBoat,
                  )?.today_weight ?? null
                }
                course={courseByBoat?.[deepBoat - 1] ?? deepBoat}
                onMetric={(metric, boat) =>
                  dispatch({ type: "metric", metric, boat })
                }
                onClose={() => dispatch({ type: "closeDeep" })}
              />
            )}
            {!(cancelled && state.lens === "bet") && (
              <LensSummary
                lens={state.lens}
                axis={summary.axis}
                flow={summary.flow}
                power={summary.power}
                bet={summary.bet}
              />
            )}
          </div>
        </div>
        <p className="ta-disclaimer">{ASSIST_COPY.disclaimer}</p>
        {!cancelled && (
          <BetFooter
            bets={bets}
            points={tickets.length}
            composite={composite}
            oddsNote={oddsNote}
            removedNote={removedNote}
            onOpen={() => dispatch({ type: "sheet", sheet: "mark" })}
            hidden={
              state.guide !== null && steps[state.guide].target !== "foot"
            }
          />
        )}
      </>
    );
  }

  const sheetOpen = state.sheet !== null;
  return (
    <AssistSheetContext.Provider value={sheetApi}>
      <title>{`${ASSIST_COPY.title}（${raceId}）`}</title>
      <Header />
      {/* 上部の切り替え（PR6、D-22）。フラグがあるときだけ。レース詳細と同じ位置（サイトのヘッダーの直下） */}
      {showViewSwitch && <AssistViewSwitch current="assist" raceId={raceId} />}
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
          similarTri={similar?.tri ?? null}
          similarN={similar?.n ?? null}
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
          similarConditions={data.similar.data?.similar?.conditions ?? null}
          lineup={lineup}
          classes={today?.classes ?? null}
          onClose={closeSheet}
        />
      )}
      {sheetCard && <TheorySheet card={sheetCard} onClose={closeSheet} />}
      {state.sheet?.type === "term" && (
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
      )}
      {state.sheet === "venue" && venueName && data.parsed && (
        <VenueSheet
          venue={venueName}
          venueCode={data.parsed.venueCode}
          info={data.venueInfo}
          tech={data.venueTech}
          vaB1={
            theoryCtx.vaFacts ? b1Usual({ facts: theoryCtx.vaFacts }) : null
          }
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
      )}
      {state.guide !== null && race && !sheetOpen && (
        <GuideOverlay
          steps={steps}
          index={state.guide}
          onStep={onGuideStep}
          topOffset={headerHeight}
        />
      )}
    </AssistSheetContext.Provider>
  );
}
