/**
 * 思考アシストのページの本体で組む値（hooks なし）。データ・状態から、ヘッダー・買い目・オッズ・シート・案内の段の値を出す。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）。utils と文言を読むので src/pure ではなくここに置く
 */
import { isInCautionEnabled } from "../../../config/featureFlags";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import {
  ASSIST_BET_TYPES,
  ROUND_LABEL,
  anyCell,
  betForm,
  betTypeComposite,
  classLineup,
  restClassCounts,
  roughCard,
  roughState,
  roughWithInCaution,
  similarSummary,
} from "../../../utils/assistModel";
import {
  b1Usual,
  factsScopeLabel,
  partsChangedBoats,
  winFollowers,
} from "../../../utils/assistSummary";
import { guideSteps, theoryCard } from "../../../utils/assistTheory";
import { expandTickets } from "../../../utils/oddsMath";
import { isRaceCancelled } from "../../../utils/raceCancellation";
import { formatObservedTime } from "../../../utils/weatherInfo";
import {
  trueWindDirection,
  windRelation,
} from "../../../utils/windDirection.js";
import {
  assistV16Of,
  buildBetSummary,
  courseByBoatOf,
  placeAxisOf,
} from "../../../pure/predictionAssistState";

/** 券種で比べる（同じ候補）の行（承認モック 画面1） */
function buildCompareRows(state, data, bets) {
  return ASSIST_BET_TYPES.map((t) => {
    const tk = expandTickets(state.bets, data.absentBoats, t.legs, t.ordered);
    const o = data.odds.data?.byType?.[t.id]?.odds ?? null;
    return {
      id: t.id,
      form: betForm(bets, t.legs, t.ordered),
      points: tk.length,
      priced: o ? tk.filter((k) => o[k] != null && o[k] > 0).length : tk.length,
      composite: betTypeComposite(t, o, tk),
    };
  });
}

function windOf(race, data) {
  return {
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
  };
}

/** セオリーカードの材料（utils/assistTheory.theoryCard） */
function buildTheoryCtx(c) {
  const { post, venueName, data, ncScenario, v16Off, today, v16Exhibition } = c;
  const { courseByBoat, boatFacts, racers, vaKey, factsAll, race } = c;
  const { maintenanceRows } = c;
  const exhRank = (() => {
    const t = racers[0]?.exhTime;
    if (t == null) return null;
    return 1 + racers.filter((r) => r.exhTime != null && r.exhTime < t).length;
  })();
  return {
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
    wind: windOf(race, data),
    partsBoats: maintenanceRows ? partsChangedBoats(maintenanceRows) : null,
    b1Exh:
      exhRank != null
        ? { text: racers[0].exhTime.toFixed(2), rank: exhRank }
        : null,
    scopeLabelOf: (sc, boat) =>
      factsScopeLabel(sc, venueName, boat, today?.classes?.[boat - 1]),
  };
}

// 欠場で外した組の知らせ・オッズが無いときの文・取得に失敗した部分の知らせ
function betNotes(state, data, betType, tickets) {
  // 欠場の艇は候補から外して数える（D-38）。欠場が分かる前に組んだ組は外したことを1行で知らせる
  const removedBoats = data.absentBoats.filter((b) =>
    [1, 2, 3].slice(0, betType.legs).some((k) => state.bets[k].has(b)),
  );
  const removedNote = removedBoats.length
    ? ASSIST_COPY.absentRemoved(
        removedBoats,
        expandTickets(state.bets, [], betType.legs, betType.ordered).length -
          tickets.length,
      )
    : null;
  // オッズが無い: 取得の失敗と、発売前（取得が成功して空）を分ける（FR-11・screens「オッズが無い」、Codex 依頼27 F01）
  const oddsNote =
    data.odds.status === "error"
      ? ASSIST_COPY.partFailed(ASSIST_COPY.partOdds)
      : data.odds.data?.byType &&
          Object.keys(data.odds.data.byType).length > 0 &&
          !data.odds.data.byType[betType.id]
        ? ASSIST_COPY.oddsTypeMissing(ASSIST_COPY.betTypeLabels[betType.id])
        : ASSIST_COPY.oddsNone;
  const partNotes = [
    data.exhibition.status === "error" && ASSIST_COPY.partExhibition,
    data.rates.status === "error" && ASSIST_COPY.partRates,
  ].filter(Boolean);
  return { removedNote, oddsNote, partNotes };
}

// データから素直に取り出せる値（hooks なし）
export function assistBase(data) {
  const race = data.racecard.data;
  const post = data.stage === "post";
  const maintenanceRows =
    post && data.maintenance.status === "ready"
      ? (data.maintenance.data?.rows ?? null)
      : null;
  return {
    ...assistV16Of(data),
    race,
    cancelled: isRaceCancelled(race),
    finalRound: Boolean(data.round),
    trifecta: data.odds.data?.trifecta ?? null,
    post,
    maintenanceRows,
  };
}

// 札・案内・ラフ度まわりの値（hooks なし）
export function assistRoughOf(c) {
  const { state, data, race, today, v16Off, scope } = c;
  const national = anyCell(data.scenario.na.data);
  const vaScenario = data.scenario.va.data?.scenario ?? null;
  // 最初に選ばれている軸の艇（spec D-48 (6)）: 前に選んだ艇（同じタブ・同じレースの保存）→ 1着の候補が1艇だけならその艇 → 1号艇
  const { placeAuto, placeAxis } = placeAxisOf(state, data.absentBoats);
  const placeF = winFollowers(vaScenario, placeAxis);
  const venueAll = anyCell(data.scenario.va.data);
  // BOA-822（機能フラグの側）: 1着のバーはイン崩れ注意度の裏返し。案内（guideSteps）・カード・シートで同じ値を使う
  const inCautionMode = isInCautionEnabled();
  const inCaution = inCautionMode ? (race?.inCaution ?? null) : null;
  const rough = inCautionMode
    ? roughWithInCaution(roughCard(scope, national), inCaution)
    : roughCard(scope, national);
  const lineup = classLineup(today?.classes, 1);
  const similar = v16Off ? null : similarSummary(data.similar.data?.similar);
  const similarFailed = !v16Off && data.similar.status === "error";
  return {
    national,
    vaScenario,
    placeAuto,
    placeAxis,
    placeF,
    venueAll,
    inCautionMode,
    inCaution,
    rough,
    lineup,
    similar,
    similarFailed,
  };
}

// 買い目・オッズまわりの値（hooks なし）
export function assistOddsOf(c) {
  const { state, data, betType, tickets, bets, act } = c;
  const { removedNote, oddsNote, partNotes } = betNotes(
    state,
    data,
    betType,
    tickets,
  );
  // 選んでいる券種のオッズ（締切時オッズがあればその値。BOA-990）。図・ヘッダー・よく出た3連単は3連単のまま
  const typeOdds = data.odds.data?.byType?.[betType.id] ?? null;
  const betOdds = typeOdds?.odds ?? null;
  // 拡連複は合成オッズを出さない（betTypeComposite。BOA-990 ③）
  const composite = betTypeComposite(betType, betOdds, tickets);
  const oddsAt = formatObservedTime(data.odds.data?.capturedAt);
  const betOddsAt = formatObservedTime(typeOdds?.capturedAt);
  const compareRows = buildCompareRows(state, data, bets);
  const onBetType = (id, from) => act({ type: "betType", betType: id, from });
  return {
    removedNote,
    oddsNote,
    partNotes,
    typeOdds,
    betOdds,
    composite,
    oddsAt,
    betOddsAt,
    compareRows,
    onBetType,
  };
}

// 場名・コース・買い目の要約など（hooks なし）
export function assistLabelsOf(c) {
  const { data, state, race, today, maintenanceRows, winFacts } = c;
  const roughStatus = roughState({
    factsStatus: data.facts.status,
    today,
    ncStatus: data.scenario.nc.status,
    naStatus: data.scenario.na.status,
  });
  const venueName = race?.venue ?? null;
  const courseByBoat = courseByBoatOf(maintenanceRows);
  const vaKey = today?.scope_keys?.["1"]?.VA;
  const motorFact = winFacts[0].chips.find(
    (f) => f.key === "motor_2" && f.hit && f.level === "large",
  );
  const b1u = b1Usual(winFacts[0].scope);
  const betSummary = buildBetSummary({
    tickets: c.tickets,
    betOdds: c.betOdds,
    typeOdds: c.typeOdds,
    betType: c.betType,
    data,
    state,
    betOddsAt: c.betOddsAt,
    oddsNote: c.oddsNote,
    race,
    dispatch: c.dispatch,
  });
  return {
    roughStatus,
    venueName,
    courseByBoat,
    vaKey,
    motorFact,
    b1u,
    betSummary,
  };
}

// シート・深掘り・案内の段まわりの値（hooks なし）
export function assistSheetOf(c) {
  const { state, data, racers, today } = c;
  const deepBoat = state.deep;
  const deepRunsReady =
    data.runs.racerId != null &&
    data.runs.racerId === racers[(deepBoat ?? 1) - 1]?.racerId;
  const theoryCtx = buildTheoryCtx(c);
  const sheetCard =
    state.sheet?.type === "theory"
      ? theoryCard(state.sheet.id, { ...theoryCtx, boat: state.sheet.boat })
      : null;
  const steps = guideSteps({
    post: c.post,
    rough: c.rough,
    hintTop: c.hints?.top ?? null,
  });
  const restCounts = restClassCounts(today?.classes, 1);
  const sheetOpen = state.sheet !== null;
  return {
    deepBoat,
    deepRunsReady,
    theoryCtx,
    sheetCard,
    steps,
    restCounts,
    sheetOpen,
  };
}
