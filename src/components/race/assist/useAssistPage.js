/**
 * 思考アシストのページの hooks（セッションへの保存・GA4 へ送ってからの dispatch・艇ごとの材料・図・買い目・ガイド）。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）。呼ぶ順は ThinkingAssistBody が決める
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assistBetType,
  boardModel,
  buildRacers,
  sameClassScope,
} from "../../../utils/assistModel";
import {
  b1Usual,
  factChips,
  factsScope,
  hintForms,
  hintSummary,
} from "../../../utils/assistSummary";
import { assistEventOf } from "../../../utils/assistEvents";
import { trackEvent } from "../../../utils/analytics";
import { expandTickets } from "../../../utils/oddsMath";
import { saveAssistSession } from "../../../utils/assistSession";
import { withoutBoats } from "../../../pure/predictionAssistState";
import { buildMarks } from "./assistPageSummary";

/**
 * 共通のヘッダー（.app-header、sticky・高さが変わる）の高さ。レンズの固定位置をその下にそろえる（N-1、Codex 依頼27 F08）
 */
export function useAppHeaderHeight() {
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

// 買い目・予算・配分の方式・着順・レンズを同じタブの中に残す（2026-10-11 ユーザーの不具合報告）
export function useAssistSessionSave(raceId, state) {
  useEffect(() => {
    saveAssistSession(raceId, state);
    // 残す項目が変わったときだけ書く（深掘り・シートの開閉では書かない）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    raceId,
    state.bets,
    state.betType,
    state.budget,
    state.mode,
    state.target,
    state.lens,
    state.placeAxis,
  ]);
}

// 操作を GA4 に送ってから状態を変える。送るかどうかは押す前の状態で決める（docs/design/thinking-assist/events.md）。
// シート・ガイドの memo の中からも呼ぶので、状態は描画のたびに ref へ移して act 自体は作り直さない
export function useAssistAct(raceId, state, dispatch) {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const act = useCallback(
    (action) => {
      const ev = assistEventOf(stateRef.current, action);
      if (ev) trackEvent(ev.name, { race_id: raceId, ...ev.params });
      dispatch(action);
    },
    [raceId, dispatch],
  );
  const onTarget = useCallback(
    (target) => act({ type: "target", target }),
    [act],
  );
  return { act, onTarget };
}

function useAssistRacers(data, race, today) {
  return useMemo(
    () =>
      buildRacers({
        players: race?.players ?? [],
        today,
        exhibition: data.exhibition.data,
        rates: data.rates.data,
      }),
    [race, today, data.exhibition.data, data.rates.data],
  );
}

// 艇ごとの差がつく材料（範囲は v16 の既定、優勝戦・準優勝戦の日は同じラウンド。D-37）。1着だけ
// （軸は1着の問い。2着以内・3着以内は相手レンズ、買い目の「過去の〇〇」は pastWin。spec D-46）
function useAssistWinFacts(data, b) {
  const { factsAll, today, v16Exhibition, post, finalRound } = b;
  return useMemo(
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
}

// 買い目レンズの「過去の{着順}」（艇ごとの範囲。6艇で比べない。着順の切り替えは買い目だけ）
function usePastWin(boatFacts, target) {
  return useMemo(
    () =>
      new Map(
        boatFacts
          .map((f, i) => [i + 1, b1Usual(f.scope, i + 1, target)])
          .filter(([, u]) => u),
      ),
    [boatFacts, target],
  );
}

// 相手レンズの各艇の2着以内・3着以内（艇ごとの範囲。軸・買い目の切り替えに関わらない。spec D-46）
function usePlaceRates(winFacts) {
  return useMemo(
    () =>
      new Map(
        winFacts
          .map((f, i) => [
            i + 1,
            {
              t2: b1Usual(f.scope, i + 1, 2),
              t3: b1Usual(f.scope, i + 1, 3),
            },
          ])
          .filter(([, p]) => p.t2 || p.t3),
      ),
    [winFacts],
  );
}

export function useAssistFacts(state, data, b) {
  const racers = useAssistRacers(data, b.race, b.today);
  const winFacts = useAssistWinFacts(data, b);
  const boatFacts = winFacts;
  const pastWin = usePastWin(boatFacts, state.target);
  const placeRates = usePlaceRates(winFacts);
  return { racers, winFacts, boatFacts, pastWin, placeRates };
}

export function useAssistFlow(state, ncScenario, today) {
  const hints = useMemo(
    () => (ncScenario ? hintSummary(ncScenario, today) : null),
    [ncScenario, today],
  );
  // 今日当てはまる形（率の高い順）と選んでいる形（承認モック v2 ④）。選んだ形が無くなったら先頭
  const flowForms = useMemo(
    () => hintForms(ncScenario, today),
    [ncScenario, today],
  );
  const flowHint =
    flowForms.find((f) => f.form === state.flowForm) ?? flowForms[0] ?? null;
  return { hints, flowForms, flowHint };
}

export function useAssistBoard(state, data, c) {
  const { boatFacts, flowHint, post, racers, maintenanceRows } = c;
  const { trifecta, finalRound, today, pastWin, placeRates, v16Status } = c;
  // 図の印（screens「レンズごとの図 C」の印）
  const marks = useMemo(
    () =>
      buildMarks({
        lens: state.lens,
        boatFacts,
        flowHint,
        post,
        racers,
        maintenanceRows,
      }),
    [state.lens, boatFacts, flowHint, post, racers, maintenanceRows],
  );

  const model = useMemo(
    () =>
      boardModel({
        lens: state.lens,
        stage: data.stage,
        metric: state.metric,
        racers,
        // 図の「1着人気」は券種によらず、締切前は3連単の合成、締切後は公式の単勝の締切時オッズ（finalWin）。
        // 券種のタブで順位が動かない（BOA-990、2026-10-28 オーナー決定）
        trifecta,
        // 締切後は公式の単勝の締切時オッズ（2026-10-28 オーナー決定）
        finalWin: data.odds.data?.finalWin ?? null,
        finalRound,
        hasToday: today != null,
        pastWin,
        placeRates,
        target: state.target,
        stBasis: state.stBasis,
        stMissing: data.facts.status === "ready" && v16Status === "not_saved",
      }),
    [
      state.lens,
      state.metric,
      data.stage,
      racers,
      trifecta,
      data.odds.data?.finalWin,
      finalRound,
      today,
      pastWin,
      placeRates,
      state.target,
      state.stBasis,
      data.facts.status,
      v16Status,
    ],
  );
  return { marks, model };
}

export function useAssistScope(data, b) {
  const { v16Off, today, race } = b;
  return useMemo(
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
}

export function useAssistBets(state, data) {
  // 欠場の艇は候補から外して数える（D-38）。欠場が分かる前に組んだ組は外したことを1行で知らせる
  const bets = useMemo(
    () => withoutBoats(state.bets, data.absentBoats),
    [state.bets, data.absentBoats],
  );
  const betType = assistBetType(state.betType);
  const tickets = useMemo(
    () =>
      expandTickets(
        state.bets,
        data.absentBoats,
        betType.legs,
        betType.ordered,
      ),
    [state.bets, data.absentBoats, betType.legs, betType.ordered],
  );
  return { bets, betType, tickets };
}

export function useAssistSheetActs(dispatch) {
  const toggleBet = useCallback(
    (pos, boat) => dispatch({ type: "toggleBet", pos, boat }),
    [dispatch],
  );
  const closeSheet = useCallback(
    () => dispatch({ type: "sheet", sheet: null }),
    [dispatch],
  );
  return { toggleBet, closeSheet };
}

export function useAssistGuide(act, steps) {
  const sheetApi = useMemo(
    () => ({
      openTerm: (term) => act({ type: "sheet", sheet: { type: "term", term } }),
      openTheory: (id, boat = null) =>
        act({ type: "sheet", sheet: { type: "theory", id, boat } }),
    }),
    [act],
  );
  const onGuideStep = useCallback(
    (step) =>
      act({
        type: "guide",
        step,
        lens: step == null ? null : steps[step].lens,
      }),
    // steps のレンズは段ごとに固定（中身の文だけがレースで変わる）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [act],
  );
  return { sheetApi, onGuideStep };
}
